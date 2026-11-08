using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace DshFrozenSetup
{
    internal static class Program
    {
        private const string Magic = "DSHFZ7P1";
        private static string _installDir;
        private static bool _silent;
        private static bool _noLaunch;
        private static bool _noRegister;

        public static string InstallDir { get { return _installDir; } }

        [STAThread]
        private static int Main(string[] args)
        {
            foreach (var raw in args)
            {
                var a = raw.Trim();
                if (a.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase))
                    _installDir = a.Substring(6).Trim('"');
                else if (a.Equals("--silent", StringComparison.OrdinalIgnoreCase)) _silent = true;
                else if (a.Equals("--nolaunch", StringComparison.OrdinalIgnoreCase)) _noLaunch = true;
                else if (a.Equals("--noregister", StringComparison.OrdinalIgnoreCase)) _noRegister = true;
            }

            if (string.IsNullOrEmpty(_installDir))
                _installDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "DeepSeekHarnessFrozen");
            _installDir = Path.GetFullPath(_installDir);

            string outer;
            long exeOff, exeLen, arcOff, arcLen;
            try
            {
                outer = Process.GetCurrentProcess().MainModule.FileName;
                ReadFooter(outer, out exeOff, out exeLen, out arcOff, out arcLen);
            }
            catch (Exception ex)
            {
                return Fatal("安装包损坏：" + ex.Message);
            }

            if (_silent)
            {
                string temp = null;
                try
                {
                    temp = PrepareTemp(outer, exeOff, exeLen, arcOff, arcLen);
                    Run7za(Path.Combine(temp, "7za.exe"), Path.Combine(temp, "payload.7z"), _installDir, null);
                    var code = RunInstaller(_installDir);
                    if (code != 0) return code;
                    if (!_noLaunch) Launch(_installDir);
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteLog("FATAL: " + ex);
                    return 1;
                }
                finally
                {
                    TryDelete(temp);
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var form = new InstallForm())
            {
                form.Shown += (s, e) =>
                {
                    var t = new Thread(() =>
                    {
                        string temp = null;
                        try
                        {
                            form.SetStatus("正在准备解压引擎…");
                            temp = PrepareTemp(outer, exeOff, exeLen, arcOff, arcLen);
                            form.SetStatus("正在解压安装文件…");
                            Run7za(Path.Combine(temp, "7za.exe"), Path.Combine(temp, "payload.7z"), _installDir, form.SetStatus);
                            form.SetStatus("正在写入配置、快捷方式与卸载登记…");
                            var code = RunInstaller(_installDir);
                            form.Invoke((Action)(() => form.Finish(code == 0, code == 0 ? null : "安装脚本返回 " + code + "，详见日志。")));
                        }
                        catch (Exception ex)
                        {
                            WriteLog("FATAL: " + ex);
                            form.Invoke((Action)(() => form.Finish(false, ex.Message)));
                        }
                        finally
                        {
                            TryDelete(temp);
                        }
                    });
                    t.IsBackground = true;
                    t.Start();
                };
                Application.Run(form);
            }
            return 0;
        }

        private static int Fatal(string message)
        {
            try
            {
                MessageBox.Show(message, "DeepSeek Harness 冻结版", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { }
            return 1;
        }

        private static void ReadFooter(string outer, out long exeOff, out long exeLen, out long arcOff, out long arcLen)
        {
            using (var fs = new FileStream(outer, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (fs.Length < 40) throw new InvalidDataException("文件过短");
                fs.Seek(-40, SeekOrigin.End);
                var buf = new byte[40];
                ReadExact(fs, buf, 0, 40);
                if (Encoding.ASCII.GetString(buf, 0, 8) != Magic)
                    throw new InvalidDataException("未找到尾部标记");
                exeOff = BitConverter.ToInt64(buf, 8);
                exeLen = BitConverter.ToInt64(buf, 16);
                arcOff = BitConverter.ToInt64(buf, 24);
                arcLen = BitConverter.ToInt64(buf, 32);
                if (exeOff <= 0 || exeLen <= 0 || arcOff <= 0 || arcLen <= 0 || arcOff + arcLen > fs.Length)
                    throw new InvalidDataException("负载偏移非法");
            }
        }

        private static string PrepareTemp(string outer, long exeOff, long exeLen, long arcOff, long arcLen)
        {
            var temp = Path.Combine(Path.GetTempPath(), "dsh-frozen-" + Guid.NewGuid().ToString("N").Substring(0, 10));
            Directory.CreateDirectory(temp);
            CopySegment(outer, exeOff, exeLen, Path.Combine(temp, "7za.exe"));
            CopySegment(outer, arcOff, arcLen, Path.Combine(temp, "payload.7z"));
            return temp;
        }

        private static void CopySegment(string outer, long offset, long length, string dest)
        {
            using (var input = new FileStream(outer, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20))
            {
                input.Seek(offset, SeekOrigin.Begin);
                var buf = new byte[1 << 20];
                long remain = length;
                while (remain > 0)
                {
                    var want = (int)Math.Min(buf.Length, remain);
                    var n = input.Read(buf, 0, want);
                    if (n <= 0) throw new EndOfStreamException();
                    output.Write(buf, 0, n);
                    remain -= n;
                }
            }
        }

        private static int Run7za(string exe, string archive, string dir, Action<string> status)
        {
            Directory.CreateDirectory(dir);
            var args = "x \"" + archive + "\" -o\"" + dir + "\" -y -bb1 -bsp0 -bso1";
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(exe)
            };
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            using (var p = new Process { StartInfo = psi })
            {
                p.OutputDataReceived += (s, e) =>
                {
                    if (status == null || e.Data == null) return;
                    var line = e.Data.Trim();
                    if (line.Length == 0) return;
                    var dash = line.IndexOf(" - ", StringComparison.Ordinal);
                    status(dash > 0 ? line.Substring(0, dash) : line);
                };
                p.Start();
                p.BeginOutputReadLine();
                var err = p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode != 0)
                {
                    WriteLog("7za failed (" + p.ExitCode + "): " + err);
                    throw new InvalidOperationException("解压失败，7-Zip 返回 " + p.ExitCode + "。");
                }
                return p.ExitCode;
            }
        }

        private static int RunInstaller(string dir)
        {
            var script = Path.Combine(dir, "install.ps1");
            if (!File.Exists(script))
                throw new FileNotFoundException("安装脚本缺失", script);

            var log = Path.Combine(Path.GetTempPath(), "dsh-frozen-setup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
            var args = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -InstallDir \"" + dir + "\" -NoLaunch -Quiet";
            if (_noRegister) args += " -NoRegister";

            var psi = new ProcessStartInfo("powershell.exe", args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = dir
            };
            using (var p = Process.Start(psi))
            using (var writer = new StreamWriter(log, true, new UTF8Encoding(false)))
            {
                writer.WriteLine("=== " + DateTime.Now.ToString("o") + " ===");
                writer.WriteLine(args);
                p.OutputDataReceived += (s, e) => { if (e.Data != null) writer.WriteLine(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) writer.WriteLine("ERR: " + e.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                writer.Flush();
                return p.ExitCode;
            }
        }

        private static void Launch(string dir)
        {
            var exe = Path.Combine(dir, "DeepSeek Harness.exe");
            if (File.Exists(exe))
                Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = dir, UseShellExecute = true });
        }

        private static void TryDelete(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return;
            try { Directory.Delete(dir, true); } catch { }
        }

        private static void WriteLog(string text)
        {
            try
            {
                File.AppendAllText(Path.Combine(Path.GetTempPath(), "dsh-frozen-setup.log"),
                    DateTime.Now.ToString("o") + " " + text + Environment.NewLine);
            }
            catch { }
        }

        private static void ReadExact(Stream s, byte[] buf, int off, int count)
        {
            while (count > 0)
            {
                var n = s.Read(buf, off, count);
                if (n <= 0) throw new EndOfStreamException();
                off += n;
                count -= n;
            }
        }
    }

    internal sealed class InstallForm : Form
    {
        private readonly Label _status;
        private readonly ProgressBar _bar;
        private readonly Label _detail;

        public InstallForm()
        {
            Text = "DeepSeek Harness 冻结版 · 安装";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(560, 190);
            BackColor = Color.FromArgb(24, 24, 28);
            ForeColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9F);

            var title = new Label
            {
                Text = "DeepSeek Harness 冻结版",
                Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(24, 20)
            };
            _status = new Label
            {
                Text = "准备安装…",
                AutoSize = false,
                Location = new Point(26, 62),
                Size = new Size(508, 22)
            };
            _bar = new ProgressBar
            {
                Location = new Point(26, 90),
                Size = new Size(508, 18),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 30
            };
            _detail = new Label
            {
                Text = "",
                AutoSize = false,
                Location = new Point(26, 118),
                Size = new Size(508, 40),
                ForeColor = Color.FromArgb(170, 170, 178)
            };
            Controls.Add(title);
            Controls.Add(_status);
            Controls.Add(_bar);
            Controls.Add(_detail);
        }

        public void SetStatus(string text)
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => SetStatus(text))); return; }
            _detail.Text = text;
        }

        public void Finish(bool ok, string error)
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => Finish(ok, error))); return; }
            _bar.Style = ProgressBarStyle.Continuous;
            _bar.Value = 100;
            Hide();
            if (ok)
            {
                var answer = MessageBox.Show(this,
                    "安装完成。\n\n程序：DeepSeek Harness 冻结版\n配置：%USERPROFILE%\\.dsh\n\n是否立即启动？",
                    "DeepSeek Harness 冻结版", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (answer == DialogResult.Yes)
                {
                    var dir = Program.InstallDir;
                    try
                    {
                        Process.Start(new ProcessStartInfo(Path.Combine(dir, "DeepSeek Harness.exe"))
                        {
                            WorkingDirectory = dir,
                            UseShellExecute = true
                        });
                    }
                    catch { }
                }
            }
            else
            {
                MessageBox.Show(this, "安装失败：" + error + "\n\n日志：%TEMP%\\dsh-frozen-setup-*.log",
                    "DeepSeek Harness 冻结版", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            Close();
        }
    }
}

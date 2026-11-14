#!/usr/bin/env node
/**
 * 清理 DeepSeek Harness 桌面版累积的 dsh-auth-* cookie。
 *
 * 背景：桌面壳每次启动都用随机端口起宿主（dsh web --port 0），Web 认证 cookie
 * 的名字按「host:port」哈希生成（dsh-auth-<sha256(authority)>），有效期 30 天。
 * Chromium 对 127.0.0.1 不区分端口地保存并发送这些 cookie，于是每启动一次就多一个；
 * 累积到 Cookie 请求头 + 常规浏览器头超过 Node http 解析上限（约 16KB）后，
 * 宿主对每次请求都回 431 Request Header Fields Too Large，
 * 桌面壳把它当作 "desktop welcome: Web authentication failed" 弹「应用无法启动」。
 *
 * 用法（先完全退出 DeepSeek Harness，包括托盘）：
 *   node scripts/prune-stale-dsh-cookies.mjs [--dry-run] [--db <Cookies 路径>]
 *
 * 该脚本只删除 host_key=127.0.0.1 且 name 以 dsh-auth- 开头的行，其余 cookie 不动；
 * 修改前会在同目录留一份 Cookies.bak-<时间戳> 备份。
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dbIndex = args.indexOf("--db");
const dbPath =
  dbIndex >= 0 && args[dbIndex + 1]
    ? args[dbIndex + 1]
    : join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "@deepseek-ai", "dsh-desktop", "Network", "Cookies");

if (!existsSync(dbPath)) {
  console.error(`找不到 cookie 数据库：${dbPath}`);
  process.exit(1);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  console.error("当前 Node 没有 node:sqlite（需要 Node >= 22.5）。请用冻结版自带的 node.exe 运行：");
  console.error(
    "  \"<安装根>\\resources\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe\" scripts\\prune-stale-dsh-cookies.mjs"
  );
  process.exit(1);
}

const select = "select count(*) from cookies where host_key='127.0.0.1' and name like 'dsh-auth-%'";

let db;
try {
  db = new DatabaseSync(dbPath, { timeout: 2000, readOnly: dryRun });
} catch (error) {
  console.error(`打开 cookie 数据库失败（DeepSeek Harness 还在运行？先完全退出再试）：${error.message}`);
  process.exit(1);
}

try {
  const before = db.prepare(select).get();
  const total = db.prepare("select count(*) as n from cookies").get();
  console.log(`数据库：${dbPath}`);
  console.log(`dsh-auth cookie：${before["count(*)"]} 个（全部 cookie ${total.n} 个）`);

  if (dryRun) {
    console.log("--dry-run：不修改。");
  } else if (before["count(*)"] > 0) {
    const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}`;
    copyFileSync(dbPath, backup);
    console.log(`已备份到：${backup}`);
    const result = db.prepare("delete from cookies where host_key='127.0.0.1' and name like 'dsh-auth-%'").run();
    console.log(`已删除 ${result.changes} 个 dsh-auth cookie。`);
    const after = db.prepare(select).get();
    console.log(`剩余 dsh-auth cookie：${after["count(*)"]} 个。`);
  } else {
    console.log("无需清理。");
  }
} finally {
  db.close();
}

/**
 * dsh-plugin-scope — 按工作区开关插件（host 侧）
 *
 * 提供 `/pluginscope` 命令，读写 `<工作区>/.dsh/plugins.json`：
 *   /pluginscope                    查看当前工作区的配置
 *   /pluginscope status             同上
 *   /pluginscope trellis off        本工作区关掉 trellis
 *   /pluginscope gitnexus on        本工作区打开 gitnexus
 *   /pluginscope codegraph autoinit-off
 *   /pluginscope all off            本工作区全关（写 "*": {"enabled": false}）
 *   /pluginscope reset              删除工作区配置（回到 profile 全局）
 *
 * 优先级（插件运行时读取）：工作区文件 > profile.workspaces 路径前缀 > profile 全局。
 * 全局总开关仍在 profile；这里只做工作区级别的「再开/再关」。
 *
 * 只依赖 node: 内置模块；写文件走「临时文件 + 改名」，不会写出半个 JSON。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const name = 'plugin-scope';

/** 需要 commands 服务。 */
const inject = ['commands'];

/** 可以按工作区开关的插件（键名与插件里 resolveScope 的 key 一致）。 */
const PLUGINS = ['trellis', 'gitnexus', 'codegraph'];

const ACTIONS = new Set(['on', 'off', 'autoinit-on', 'autoinit-off']);

function scopeFile(root) {
  return join(root, '.dsh', 'plugins.json');
}

function readScope(root) {
  const file = scopeFile(root);
  try {
    const raw = readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    return data !== null && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** 原子写：先写 .tmp 再 rename；JSON 不带 BOM（插件侧 JSON.parse 会拒绝 BOM）。 */
function writeScope(root, data) {
  const file = scopeFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return file;
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 解析工作区根：优先 workingDirectory 服务，退回进程 cwd。 */
async function resolveRoot(ctx, agent, signal) {
  try {
    const workingDirectory = ctx.get?.('workingDirectory');
    if (workingDirectory !== undefined) {
      const cwd = await workingDirectory.ensure(agent, signal);
      if (typeof cwd === 'string' && cwd.length > 0 && isDir(cwd)) return resolve(cwd);
    }
  } catch {
    /* ignore */
  }
  try {
    const workspace = ctx.get?.('workspace');
    if (typeof workspace?.cwd === 'string' && workspace.cwd.length > 0 && isDir(workspace.cwd)) return resolve(workspace.cwd);
  } catch {
    /* ignore */
  }
  const cwd = process.cwd();
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

function describe(data) {
  const keys = Object.keys(data);
  if (keys.length === 0) return '（无工作区配置，全部继承 profile 全局）';
  return keys.map((key) => {
    const value = data[key] ?? {};
    const parts = [];
    if (value.enabled !== undefined) parts.push(`enabled=${value.enabled}`);
    if (value.autoInit !== undefined) parts.push(`autoInit=${value.autoInit}`);
    return `${key}: ${parts.length > 0 ? parts.join(' ') : '(空)'}`;
  }).join('\n');
}

function parseInput(rawInput) {
  const tokens = String(rawInput ?? '').trim().split(/\s+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return { kind: 'status' };
  const head = tokens[0].toLowerCase();
  if (head === 'status') return { kind: 'status' };
  if (head === 'reset') return { kind: 'reset' };
  const plugin = head === 'all' ? '*' : head;
  if (plugin !== '*' && !PLUGINS.includes(plugin)) {
    return { kind: 'error', text: `未知插件：${head}（可用：${PLUGINS.join(' / ')} / all）` };
  }
  const action = (tokens[1] ?? '').toLowerCase();
  if (!ACTIONS.has(action)) {
    return { kind: 'error', text: `未知动作：${action || '(空)'}（可用：on / off / autoinit-on / autoinit-off）` };
  }
  return { kind: 'set', plugin, action };
}

function applyEntry(data, plugin, action) {
  const current = data[plugin];
  const entry = current !== null && typeof current === 'object' ? { ...current } : {};
  if (action === 'on') entry.enabled = true;
  if (action === 'off') entry.enabled = false;
  if (action === 'autoinit-on') entry.autoInit = true;
  if (action === 'autoinit-off') entry.autoInit = false;
  data[plugin] = entry;
  return data;
}

/** 端口占用探测：600ms 内连上就认为面板已在跑。 */
function panelAlive(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.destroy(); } catch { /* ignore */ } resolve(v); } };
    socket.setTimeout(600);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * 确保本地面板在跑：宿主（无论怎么启动）boot 时都会调用这里，
 * 不再依赖 Launch.ps1 —— 之前直接双击 exe 启动时面板没起来，Tab 就是黑屏。
 */
async function ensurePanel(ctx, config) {
  const script = config.panelScript;
  const nodePath = config.nodePath;
  if (typeof script !== 'string' || typeof nodePath !== 'string') return;
  if (!existsSync(script) || !existsSync(nodePath)) return;
  const port = Number.isFinite(config.panelPort) ? Number(config.panelPort) : 8799;
  if (await panelAlive(port)) return;
  try {
    const child = spawn(nodePath, [script, '--no-open', '--port', String(port)], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    ctx.logger?.info?.(`plugin-scope: 本地面板已启动 http://127.0.0.1:${port}/`);
  } catch (error) {
    ctx.logger?.warn?.('plugin-scope: 面板启动失败 %o', error);
  }
}

function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  void ensurePanel(ctx, config);

  ctx.commands.register({
    name: 'pluginscope',
    description: '按工作区开关 trellis / gitnexus / codegraph（写 <工作区>/.dsh/plugins.json）',
    input: {
      hint: '[status|reset|<trellis|gitnexus|codegraph|all> <on|off|autoinit-on|autoinit-off>]',
    },
    handler: async (invocation) => {
      try {
        const root = await resolveRoot(ctx, invocation.agent, invocation.signal);
        const parsed = parseInput(invocation.rawInput);

        if (parsed.kind === 'error') return { kind: 'error', text: parsed.text };

        if (parsed.kind === 'status') {
          const data = readScope(root);
          return {
            kind: 'success',
            text: `工作区：${root}\n文件：${scopeFile(root)}${existsSync(scopeFile(root)) ? '' : '（不存在）'}\n\n${describe(data)}`,
          };
        }

        if (parsed.kind === 'reset') {
          const file = scopeFile(root);
          if (!existsSync(file)) return { kind: 'success', text: `工作区没有配置文件，无需重置：${root}` };
          writeScope(root, {});
          return { kind: 'success', text: `已重置工作区配置（清空）：${file}` };
        }

        const data = applyEntry(readScope(root), parsed.plugin, parsed.action);
        const file = writeScope(root, data);
        return {
          kind: 'success',
          text: `已更新：${file}\n\n${describe(data)}\n\n下一次进入本工作区的会话生效。`,
        };
      } catch (error) {
        try { ctx.logger?.warn?.('plugin-scope command failed: %o', error); } catch { /* ignore */ }
        return { kind: 'error', text: `plugin-scope 失败：${error?.message ?? error}` };
      }
    },
  });
}

export { apply, inject, name };

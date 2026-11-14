#!/usr/bin/env node
// dsh-codex-cua — MCP stdio server that exposes the Codex Desktop computer-use engine.
//
// Engine provenance (extracted from Codex Desktop 26.1013.4894.0):
//   @oai/sky 0.7.8  (dist/project/cua/sky_js/src)  -> AX tree, clicks, typing, screenshots
//   bin/windows/codex-computer-use.exe             -> native helper, JSON-Lines over stdio
//   codex.exe app-server (external, detected)      -> app/window enumeration + auth token
//
// The upstream launcher (node_repl.exe) is deliberately NOT used: its worker filters
// process env down to NODE_REPL_UNTRUSTED_ENV_ALLOWLIST and denies child-process spawn,
// which breaks the helper transport. Running @oai/sky in a normal Node process with a
// ~20-line `globalThis.nodeRepl` shim is the supported shape of this package.

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR_SKY = path.join(ROOT, 'vendor', '@oai', 'sky');
const SKY_INDEX = pathToFileURL(path.join(VENDOR_SKY, 'dist', 'project', 'cua', 'sky_js', 'src', 'index.js')).href;
const SKY_SERVICE = pathToFileURL(path.join(VENDOR_SKY, 'dist', 'project', 'cua', 'sky_js', 'src', 'service.js')).href;
const HELPER = path.join(VENDOR_SKY, 'bin', 'windows', 'codex-computer-use.exe');
const STATE_DIR = path.join(ROOT, 'state');
const AUDIT_FILE = path.join(STATE_DIR, 'approvals.jsonl');
const SKY_CONFIG = path.join(STATE_DIR, 'sky-options.json');
const SERVER_VERSION = '0.1.0';

// stdout is the MCP channel. Everything diagnostic goes to stderr.
for (const level of ['log', 'info', 'debug', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => process.stderr.write(`[cua] ${args.map(String).join(' ')}\n`);
  void original;
}

const CFG = {
  approval: (process.env.CUA_APPROVAL || 'auto').toLowerCase(), // auto | deny
  requestTimeoutMs: Number(process.env.CUA_REQUEST_TIMEOUT_MS || 30000),
  maxTextChars: Number(process.env.CUA_MAX_TEXT_CHARS || 24000),
  codexCli: process.env.CUA_CODEX_CLI || '',
  codexHome: process.env.CODEX_HOME || '',
};

function ensureStateDir() {
  try { mkdirSync(STATE_DIR, { recursive: true }); } catch {}
}

function audit(entry) {
  try {
    ensureStateDir();
    if (existsSync(AUDIT_FILE) && statSync(AUDIT_FILE).size > 1024 * 1024) writeFileSync(AUDIT_FILE, '');
    appendFileSync(AUDIT_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {}
}

function detectCodexCli() {
  const explicit = CFG.codexCli.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try {
    if (existsSync(root)) {
      const candidates = [];
      for (const name of readdirSync(root)) {
        const exe = path.join(root, name, 'codex.exe');
        if (existsSync(exe)) candidates.push({ exe, mtime: statSync(exe).mtimeMs });
      }
      candidates.sort((a, b) => b.mtime - a.mtime);
      if (candidates.length) return candidates[0].exe;
    }
  } catch {}
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const exe = path.join(dir, 'codex.exe');
    try { if (existsSync(exe)) return exe; } catch {}
  }
  return '';
}

const CODEX_CLI = detectCodexCli();
if (CODEX_CLI) process.env.CODEX_CLI_PATH = CODEX_CLI;
process.env.CODEX_HOME = CFG.codexHome || process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex');
process.env.OAI_SKY_WINDOWS_BIN = HELPER;
ensureStateDir();
writeFileSync(SKY_CONFIG, JSON.stringify({ target: 'windows', timeoutMs: CFG.requestTimeoutMs }), 'utf8');
process.env.OAI_SKY_CONFIG_PATH = SKY_CONFIG;

// ── node_repl shim ────────────────────────────────────────────────────────────
// sky.js: if globalThis.nodeRepl.rpc is a function it drives the Sky service over RPC;
// helper_transport.js resolves the approval handler as
//   n ?? (globalThis.nodeRepl?.config == null ? undefined : globalThis.nodeRepl)?.createElicitation
// so BOTH `config` (non-null) and a root-level `createElicitation` are required — a missing
// `config` makes it look like no approval UI exists and every screen read throws.
const emittedImages = [];
globalThis.nodeRepl = {
  env: { ...process.env },
  platform: process.platform,
  pid: process.pid,
  requestMeta: {},
  config: {},
  async rpc(_service, request) {
    const mod = await import(SKY_SERVICE);
    return mod.handleRpc(request);
  },
  async createElicitation(request) {
    const decision = CFG.approval === 'deny' ? 'deny' : 'accept';
    audit({ kind: 'elicitation', decision, message: request?.message ?? null, meta: request?.meta ?? null });
    return { action: decision };
  },
  async emitImage(url) { emittedImages.push(url); },
  withSuspendedTimeout(fn) { return Promise.resolve().then(fn); },
};

let skyPromise;
function sky() {
  if (!skyPromise) skyPromise = import(SKY_INDEX).then((m) => m.sky);
  return skyPromise;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function windowRef(input) {
  const app = typeof input.app === 'string' && input.app.trim() ? input.app.trim() : undefined;
  const raw = input.window_id ?? input.windowId ?? input.id;
  let id;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`window_id 必须是非负整数，收到 ${JSON.stringify(raw)}`);
    id = n;
  }
  if (app && id !== undefined) return { app, id };
  return { app, id };
}

async function resolveWindow(input) {
  const direct = windowRef(input ?? {});
  if (direct.app && direct.id !== undefined) return direct;
  const s = await sky();
  if (direct.id !== undefined) {
    const wins = await s.list_windows();
    const hit = wins.find((w) => w.id === direct.id);
    if (!hit) throw new Error(`找不到 window_id=${direct.id} 的窗口；先用 list_windows 取当前窗口清单。`);
    return hit;
  }
  if (direct.app) {
    const wins = await s.list_windows();
    const hit = wins.find((w) => w.app === direct.app) ?? wins.find((w) => String(w.app).includes(direct.app));
    if (!hit) throw new Error(`应用 ${direct.app} 当前没有可操作窗口。`);
    return hit;
  }
  throw new Error('需要 app 或 window_id；先调用 list_windows。');
}

function clip(text, limit = CFG.maxTextChars) {
  const value = String(text ?? '');
  if (value.length <= limit) return { text: value, truncated: false, originalLength: value.length };
  return { text: `${value.slice(0, limit)}\n… [truncated ${value.length - limit} chars]`, truncated: true, originalLength: value.length };
}

function imageContent(url) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(url ?? ''));
  if (!match) return null;
  return { type: 'image', mimeType: match[1], data: match[2] };
}

function textContent(text) { return { type: 'text', text: String(text) }; }

function ok(content) { return { content: Array.isArray(content) ? content : [content] }; }
function fail(message) { return { content: [textContent(`错误：${message}`)], isError: true }; }

// ── tool surface ─────────────────────────────────────────────────────────────
const WINDOW_PROPS = {
  app: { type: 'string', description: '应用 id（list_apps 返回的 id，例如 process:C:\\\\...\\\\app.exe 或 Chrome）' },
  window_id: { type: 'integer', description: '窗口 id（list_windows 返回的 id）' },
};

const TOOLS = [
  {
    name: 'health',
    description: '检查 computer-use 引擎状态：helper 是否存在、codex CLI 路径、审批模式、窗口数量。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_apps',
    description: '列出可操作的应用及其窗口（含 displayName、是否运行中、窗口标题）。',
    inputSchema: {
      type: 'object',
      properties: {
        include_windows: { type: 'boolean', description: '是否带上每个应用的窗口列表（默认 true）' },
        running_only: { type: 'boolean', description: '只返回正在运行的应用（默认 true）' },
      },
    },
  },
  {
    name: 'list_windows',
    description: '列出当前所有可操作窗口（app + window_id + title）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_window_state',
    description: '读取窗口的 UI Automation 树（带元素编号）与截图。点击/输入前先用它拿元素编号和最新坐标。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WINDOW_PROPS,
        include_text: { type: 'boolean', description: '返回 AX 树文本（默认 true）' },
        include_screenshot: { type: 'boolean', description: '返回截图（默认 true）' },
        max_chars: { type: 'integer', description: 'AX 树最大字符数（默认 24000）' },
      },
    },
  },
  {
    name: 'screenshot',
    description: '只取窗口截图（不返回 AX 树），适合确认视觉状态。',
    inputSchema: { type: 'object', properties: { ...WINDOW_PROPS } },
  },
  {
    name: 'click',
    description: '点击元素（element_index）或窗口内坐标（x, y）。坐标必须来自同一窗口的最新截图。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WINDOW_PROPS,
        element_index: { type: 'integer', description: 'AX 树中的元素编号' },
        x: { type: 'number', description: '窗口内 X 坐标（截图坐标系）' },
        y: { type: 'number', description: '窗口内 Y 坐标（截图坐标系）' },
        click_count: { type: 'integer', description: '点击次数（默认 1，2=双击，3=三击）' },
        mouse_button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标键（默认 left）' },
      },
    },
  },
  {
    name: 'type_text',
    description: '向窗口当前焦点输入文本。',
    inputSchema: { type: 'object', properties: { ...WINDOW_PROPS, text: { type: 'string', description: '要输入的文本' } }, required: ['text'] },
  },
  {
    name: 'press_key',
    description: '发送按键或组合键，例如 "Enter"、"Ctrl+S"、"Alt+F4"。',
    inputSchema: { type: 'object', properties: { ...WINDOW_PROPS, key: { type: 'string', description: '按键组合' } }, required: ['key'] },
  },
  {
    name: 'scroll',
    description: '在窗口坐标处滚动。scrollY 为正向下，负向上；scrollX 为正向右。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WINDOW_PROPS,
        x: { type: 'number' },
        y: { type: 'number' },
        scrollX: { type: 'number', description: '水平滚动量' },
        scrollY: { type: 'number', description: '垂直滚动量' },
      },
      required: ['x', 'y', 'scrollX', 'scrollY'],
    },
  },
  {
    name: 'drag',
    description: '从窗口坐标 (from_x, from_y) 拖到 (to_x, to_y)。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WINDOW_PROPS,
        from_x: { type: 'number' }, from_y: { type: 'number' },
        to_x: { type: 'number' }, to_y: { type: 'number' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
  },
  {
    name: 'set_value',
    description: '直接设置元素的值（不模拟键盘，适合输入框）。',
    inputSchema: {
      type: 'object',
      properties: { ...WINDOW_PROPS, element_index: { type: 'integer' }, value: { type: 'string' } },
      required: ['element_index', 'value'],
    },
  },
  {
    name: 'secondary_action',
    description: '执行元素的次要动作（AX 树里 "Secondary Actions:" 列出的名字，例如 Raise、Expand、Collapse）。',
    inputSchema: {
      type: 'object',
      properties: { ...WINDOW_PROPS, element_index: { type: 'integer' }, action: { type: 'string' } },
      required: ['element_index', 'action'],
    },
  },
  {
    name: 'activate_window',
    description: '把窗口切到前台并聚焦。',
    inputSchema: { type: 'object', properties: { ...WINDOW_PROPS } },
  },
  {
    name: 'launch_app',
    description: '启动应用（app 为 list_apps 中的应用 id）。',
    inputSchema: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
  },
];

async function callTool(name, args) {
  const s = await sky();
  switch (name) {
    case 'health': {
      const report = {
        engine: '@oai/sky',
        serverVersion: SERVER_VERSION,
        helper: HELPER,
        helperExists: existsSync(HELPER),
        codexCli: CODEX_CLI || null,
        codexCliExists: Boolean(CODEX_CLI && existsSync(CODEX_CLI)),
        codexHome: process.env.CODEX_HOME,
        approval: CFG.approval,
        requestTimeoutMs: CFG.requestTimeoutMs,
        node: process.version,
      };
      try {
        const wins = await s.list_windows();
        report.windowCount = wins.length;
        report.ok = true;
      } catch (error) {
        report.ok = false;
        report.error = error?.message ?? String(error);
      }
      return ok(textContent(JSON.stringify(report, null, 2)));
    }
    case 'list_apps': {
      const apps = await s.list_apps();
      const includeWindows = args?.include_windows !== false;
      const runningOnly = args?.running_only !== false;
      const rows = (apps ?? [])
        .filter((a) => !runningOnly || a.isRunning !== false)
        .map((a) => ({
          id: a.id,
          displayName: a.displayName ?? null,
          isRunning: a.isRunning ?? null,
          lastUsedDate: a.lastUsedDate ?? null,
          ...(includeWindows ? { windows: (a.windows ?? []).map((w) => ({ window_id: w.id, title: w.title ?? null })) } : {}),
        }));
      return ok(textContent(JSON.stringify(rows, null, 2)));
    }
    case 'list_windows': {
      const wins = await s.list_windows();
      return ok(textContent(JSON.stringify((wins ?? []).map((w) => ({ app: w.app, window_id: w.id, title: w.title ?? null })), null, 2)));
    }
    case 'get_window_state': {
      const win = await resolveWindow(args ?? {});
      const includeText = args?.include_text !== false;
      const includeScreenshot = args?.include_screenshot !== false;
      if (!includeText && !includeScreenshot) throw new Error('include_text 与 include_screenshot 不能同时为 false');
      emittedImages.length = 0;
      const state = await s.get_window_state({ window: win, include_text: includeText, include_screenshot: includeScreenshot });
      const content = [];
      const tree = clip(state?.accessibility?.tree ?? '', Number(args?.max_chars) || CFG.maxTextChars);
      const meta = {
        window: state?.window ?? win,
        screenshots: (state?.screenshots ?? []).map((s2) => ({ id: s2.id, width: s2.width, height: s2.height, originX: s2.originX, originY: s2.originY })),
        focused_element: state?.accessibility?.focused_element ?? null,
        selected_text: state?.accessibility?.selected_text ?? null,
        truncated: tree.truncated,
        originalLength: tree.originalLength,
      };
      content.push(textContent(`${JSON.stringify(meta, null, 2)}\n\n${tree.text}`));
      for (const shot of state?.screenshots ?? []) {
        const image = imageContent(shot.url);
        if (image) content.push(image);
      }
      return ok(content);
    }
    case 'screenshot': {
      const win = await resolveWindow(args ?? {});
      emittedImages.length = 0;
      const state = await s.get_window_state({ window: win, include_text: false, include_screenshot: true });
      const content = [textContent(JSON.stringify({ window: state?.window ?? win, screenshots: (state?.screenshots ?? []).length }))];
      for (const shot of state?.screenshots ?? []) {
        const image = imageContent(shot.url);
        if (image) content.push(image);
      }
      return ok(content);
    }
    case 'click': {
      const win = await resolveWindow(args ?? {});
      const payload = { window: win };
      if (args?.element_index !== undefined) payload.element_index = args.element_index;
      else {
        if (!Number.isFinite(args?.x) || !Number.isFinite(args?.y)) throw new Error('click 需要 element_index 或 x/y 坐标');
        payload.x = args.x; payload.y = args.y;
      }
      if (args?.click_count !== undefined) payload.click_count = args.click_count;
      if (args?.mouse_button) payload.mouse_button = args.mouse_button;
      await s.click(payload);
      return ok(textContent(`已点击 ${JSON.stringify(payload.element_index !== undefined ? { element_index: payload.element_index } : { x: payload.x, y: payload.y })}`));
    }
    case 'type_text': {
      const win = await resolveWindow(args ?? {});
      if (typeof args?.text !== 'string') throw new Error('text 必填');
      await s.type_text({ window: win, text: args.text });
      return ok(textContent(`已输入 ${args.text.length} 个字符`));
    }
    case 'press_key': {
      const win = await resolveWindow(args ?? {});
      if (!args?.key) throw new Error('key 必填');
      await s.press_key({ window: win, key: args.key });
      return ok(textContent(`已发送按键 ${args.key}`));
    }
    case 'scroll': {
      const win = await resolveWindow(args ?? {});
      await s.scroll({ window: win, x: args.x, y: args.y, scrollX: args.scrollX ?? 0, scrollY: args.scrollY ?? 0 });
      return ok(textContent(`已滚动 dx=${args.scrollX ?? 0} dy=${args.scrollY ?? 0}`));
    }
    case 'drag': {
      const win = await resolveWindow(args ?? {});
      await s.drag({ window: win, from_x: args.from_x, from_y: args.from_y, to_x: args.to_x, to_y: args.to_y });
      return ok(textContent('已拖拽'));
    }
    case 'set_value': {
      const win = await resolveWindow(args ?? {});
      await s.set_value({ window: win, element_index: args.element_index, value: args.value });
      return ok(textContent(`已设置元素 ${args.element_index} 的值`));
    }
    case 'secondary_action': {
      const win = await resolveWindow(args ?? {});
      await s.secondary_action({ window: win, element_index: args.element_index, action: args.action });
      return ok(textContent(`已对元素 ${args.element_index} 执行 ${args.action}`));
    }
    case 'activate_window': {
      const win = await resolveWindow(args ?? {});
      await s.activate_window({ window: win });
      return ok(textContent(`已激活窗口 ${win.id}`));
    }
    case 'launch_app': {
      if (!args?.app) throw new Error('app 必填');
      await s.launch_app({ app: args.app });
      return ok(textContent(`已启动 ${args.app}`));
    }
    default:
      throw new Error(`未知工具 ${name}`);
  }
}

// ── MCP stdio loop ───────────────────────────────────────────────────────────
const PROTOCOL_VERSION = '2024-11-05';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize':
        return send({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'dsh-codex-cua', version: SERVER_VERSION },
            instructions: 'Codex Desktop computer-use engine. Prefer list_windows -> get_window_state -> click(element_index) and re-read state after each action.',
          },
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        return send({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'resources/list':
        return send({ jsonrpc: '2.0', id, result: { resources: [] } });
      case 'prompts/list':
        return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments ?? {};
        try {
          const result = await callTool(name, args);
          return send({ jsonrpc: '2.0', id, result });
        } catch (error) {
          return send({ jsonrpc: '2.0', id, result: fail(error?.message ?? String(error)) });
        }
      }
      default:
        if (!isRequest) return;
        return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (error) {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: error?.message ?? String(error) } });
  }
}

async function selfTest() {
  const report = { version: SERVER_VERSION, helper: existsSync(HELPER), codexCli: CODEX_CLI || null };
  try {
    const s = await sky();
    const wins = await s.list_windows();
    report.windowCount = wins.length;
    report.sample = wins.slice(0, 5);
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error?.message ?? String(error);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index === -1) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      void handle(message);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.on('uncaughtException', (error) => process.stderr.write(`[cua] uncaught: ${error?.stack ?? error}\n`));
  process.on('unhandledRejection', (error) => process.stderr.write(`[cua] unhandled: ${error?.stack ?? error}\n`));
  process.stderr.write(`[cua] server ready (helper=${existsSync(HELPER)}, codexCli=${CODEX_CLI || 'none'})\n`);
}

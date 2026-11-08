#!/usr/bin/env node
/**
 * DeepSeek Harness · 按工作区开关插件（本地面板）
 *
 *   node plugin-scope-ui.mjs [--port 8799] [--home <DSH_HOME>] [--no-open]
 *
 * 只读写 <工作区>/.dsh/plugins.json，不碰宿主进程、不改 profile。
 * 面板列出 profile 里**所有已安装插件**；其中带 lib/scope.js 的插件原生支持工作区作用域，
 * 其余插件只能记录配置（插件本身还没实现作用域读取），UI 会标出来，避免误解。
 *
 * 路由：
 *   GET  /                 面板
 *   GET  /api/state        工作区 × 插件 状态
 *   POST /api/set          { root, plugin, patch:{enabled,autoInit} }
 *   POST /api/reset        { root }
 *   GET  /usage?range=30d  Token 用量仪表盘（复用 tools/usage-report.mjs）
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const DSH_HOME = resolve(argOf('home', process.env.DSH_HOME ?? join(homedir(), '.dsh')));
const PORT = Number(argOf('port', '8799'));
const OPEN = !args.includes('--no-open');
const TOKEN = randomBytes(9).toString('hex');
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'desktop');
const PROFILE = join(PROFILE_DIR, 'package.json');
const USAGE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'usage-report.mjs');

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function scopeFile(root) { return join(root, '.dsh', 'plugins.json'); }

/* ───────── 工作区发现 ───────── */
function workspaces() {
  const set = new Map();
  const add = (p) => {
    if (typeof p !== 'string' || p.trim().length === 0) return;
    let abs; try { abs = resolve(p); } catch { return; }
    if (!existsSync(abs)) return;
    try { if (!statSync(abs).isDirectory()) return; } catch { return; }
    set.set(abs.toLowerCase(), abs);
  };
  const ws = readJson(join(DSH_HOME, 'storages', 'workspace.json'), null);
  if (ws) {
    const walk = (v) => {
      if (typeof v === 'string') add(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => { if (typeof x === 'string' && /[\\/]/.test(x)) add(x); else walk(x); });
    };
    walk(ws);
  }
  const cacheDir = join(DSH_HOME, 'storages', 'session_projcache', 'sessions');
  try {
    for (const name of readdirSync(cacheDir)) {
      if (!name.endsWith('.json')) continue;
      const doc = readJson(join(cacheDir, name), null);
      add(doc?.record?.identity?.cwd);
    }
  } catch { /* ignore */ }
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

/* ───────── 插件枚举 ───────── */
function readEntryFlags(text, targets) {
  const lines = String(text).split(/\r?\n/u);
  const flags = {};
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*-\s*id:\s*['"]?([\w@./-]+)['"]?\s*$/u.exec(lines[i]);
    if (m === null) continue;
    if (!targets.includes(m[1])) continue;
    const baseIndent = lines[i].length - lines[i].trimStart().length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= baseIndent && /^\s*-\s/u.test(line)) break;
      const f = /^\s*(enabled|autoInit)\s*:\s*(true|false)\s*$/u.exec(line);
      if (f !== null && flags[f[1]] === undefined) flags[f[1]] = f[2] === 'true';
    }
  }
  return flags;
}

function pluginDirs() {
  const map = new Map();
  const add = (dir) => {
    if (!existsSync(dir)) return;
    const pkg = readJson(join(dir, 'package.json'), null);
    if (pkg === null || typeof pkg.name !== 'string') return;
    map.set(pkg.name, { name: pkg.name, version: pkg.version ?? '', dir, pkg });
  };
  try {
    for (const name of readdirSync(join(PROFILE_DIR, 'node_modules'))) {
      if (name.startsWith('.') || name.startsWith('@')) continue;
      add(join(PROFILE_DIR, 'node_modules', name));
    }
    const at = join(PROFILE_DIR, 'node_modules', '@deepseek-ai');
    if (existsSync(at)) for (const name of readdirSync(at)) add(join(at, name));
  } catch { /* ignore */ }
  return map;
}

function listPlugins() {
  const pkg = readJson(PROFILE, null);
  const bundles = new Set(pkg?.dsh?.profile?.bundles ?? []);
  const dirs = pluginDirs();
  const rows = [];
  for (const name of bundles) {
    if (name.startsWith('@deepseek-ai/')) continue;           // 宿主自带，不在工作区维度里管
    const info = dirs.get(name);
    const dir = info?.dir ?? join(PROFILE_DIR, 'node_modules', name);
    let globalEnabled = true;
    for (const patch of [join(dir, 'cordis.patch.yml')]) {
      if (!existsSync(patch)) continue;
      let text = '';
      try { text = readFileSync(patch, 'utf8'); } catch { /* ignore */ }
      const flags = readEntryFlags(text, [name, name.replace(/^dsh-/, ''), 'mobile-access', 'mcp-gitnexus', 'mcp-codegraph'].filter(Boolean));
      if (flags.enabled !== undefined) globalEnabled = flags.enabled;
    }
    rows.push({
      name,
      version: info?.version ?? '',
      globalEnabled,
      supportsScope: existsSync(join(dir, 'lib', 'scope.js')),
      installed: info !== undefined || existsSync(dir),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/* ───────── 状态 ───────── */
function state() {
  const plugins = listPlugins();
  const rows = workspaces().map((root) => {
    const data = readJson(scopeFile(root), {});
    return {
      root,
      hasFile: existsSync(scopeFile(root)),
      overrides: Object.fromEntries(plugins.map((p) => {
        const v = data?.[p.name] ?? {};
        return [p.name, { enabled: v.enabled ?? null, autoInit: v.autoInit ?? null }];
      })),
      star: data?.['*'] ?? null,
    };
  });
  return { dshHome: DSH_HOME, plugins, generatedAt: new Date().toISOString(), workspaces: rows };
}

const PLUGIN_NAME = /^(@[\w.-]+\/)?[\w.-]+$/u;

function writeState(root, plugin, patch) {
  const abs = resolve(root);
  if (!existsSync(abs)) throw new Error(`工作区不存在：${abs}`);
  if (plugin !== 'all' && !PLUGIN_NAME.test(String(plugin ?? ''))) throw new Error('插件名不合法');
  if (plugin === '.' || plugin === '..') throw new Error('插件名不合法');
  if (plugin === 'all' && patch && patch.__reset === true) {
    const file = scopeFile(abs);
    mkdirSync(dirname(file), { recursive: true });
    const tmp0 = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp0, '{}\n', 'utf8');
    renameSync(tmp0, file);
    return file;
  }
  const file = scopeFile(abs);
  const data = readJson(file, {});
  const key = plugin === 'all' ? '*' : plugin;
  const entry = { ...(data[key] ?? {}) };
  if (patch.enabled !== undefined) entry.enabled = patch.enabled;
  if (patch.autoInit !== undefined) entry.autoInit = patch.autoInit;
  if (Object.keys(entry).length === 0) delete data[key]; else data[key] = entry;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return file;
}

/* ───────── 页面 ───────── */
function page() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>DSH · 按工作区开关插件</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--fg:#e7eaf0;--muted:#8b93a7;--accent:#4F7CFF}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 "Microsoft YaHei UI",system-ui,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:22px 20px 60px}
h1{font-size:20px;margin:0 0 6px}.sub{color:var(--muted);font-size:12px}
.bar{display:flex;gap:10px;align-items:center;margin:14px 0 6px;flex-wrap:wrap}
input[type=search]{flex:1;min-width:240px;background:var(--panel);border:1px solid var(--line);color:var(--fg);border-radius:10px;padding:9px 12px;font:inherit}
input[type=search]:focus{outline:none;border-color:var(--accent)}
.chip{border:1px solid var(--line);border-radius:999px;padding:5px 11px;color:var(--muted);cursor:pointer;font-size:12px;background:transparent}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.ws{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.path{font-family:Consolas,monospace;font-size:12px;color:var(--muted);word-break:break-all;margin-bottom:8px}
.row{display:grid;grid-template-columns:220px 1fr 1fr 150px;gap:10px;align-items:center;padding:6px 0;border-top:1px dashed var(--line)}
.name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 5px;margin-left:6px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{background:transparent;color:var(--muted);border:0;padding:4px 9px;cursor:pointer;font:inherit;font-size:12px}
.seg button.on{background:var(--accent);color:#fff}
.seg button.off{background:#3a1d22;color:#ffb4bd}
.state{font-size:12px;color:var(--muted)}
button.act{background:transparent;border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:5px 10px;cursor:pointer;font:inherit;font-size:12px}
button.act:hover{border-color:var(--accent)}
.toast{position:fixed;right:18px;bottom:18px;background:#12351f;border:1px solid #22C55E;color:#c7f5d6;padding:9px 14px;border-radius:10px;opacity:0;transition:.2s}
.toast.show{opacity:1}
.none{color:var(--muted);padding:18px 4px}
</style></head><body><div class="wrap">
<h1>按工作区开关插件</h1>
<div class="sub">写入 &lt;工作区&gt;\\.dsh\\plugins.json　·　与插件运行时同一份数据　·　DSH_HOME: <span id="home"></span></div>
<div class="sub" style="margin-top:6px">带 <b>作用域</b> 标记的插件会真正按工作区生效；没有标记的插件只是记录配置（它还没实现工作区读取）。全局总开关仍在插件页。</div>
<div class="bar">
  <input type="search" id="q" placeholder="搜索插件名或工作区路径…">
  <span class="chip on" data-filter="all" id="f-all">全部</span>
  <span class="chip" data-filter="scope" id="f-scope">只看支持作用域</span>
  <span class="tag" id="count"></span>
</div>
<div id="list"></div>
<div class="toast" id="toast"></div>
</div>
<script>
const TOKEN = ${JSON.stringify(TOKEN)};
let DATA = null, QUERY = '', FILTER = 'all';
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
const toast = (m) => { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); };
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-scope-token': TOKEN }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function seg(value, onChange, inheritLabel) {
  const wrap = el('span', 'seg');
  const mk = (text, v, cls) => { const b = el('button', value === v ? cls : '', text); b.onclick = () => onChange(v); return b; };
  wrap.append(mk('开', true, 'on'), mk('关', false, 'off'), mk(inheritLabel || '继承', null, ''));
  return wrap;
}
function matches(pluginName, wsPath) {
  if (FILTER === 'scope' && !(DATA.plugins.find((p) => p.name === pluginName)?.supportsScope)) return false;
  if (!QUERY) return true;
  return pluginName.toLowerCase().includes(QUERY) || wsPath.toLowerCase().includes(QUERY);
}
function render(data) {
  DATA = data;
  document.getElementById('home').textContent = data.dshHome;
  const list = document.getElementById('list');
  list.innerHTML = '';
  let shown = 0;
  for (const ws of data.workspaces) {
    const plugins = data.plugins.filter((p) => matches(p.name, ws.root));
    if (plugins.length === 0) continue;
    shown += 1;
    const card = el('div', 'ws');
    card.append(el('div', 'path', ws.root + (ws.hasFile ? '' : '  （无配置，继承 profile）')));
    for (const p of plugins) {
      const ov = ws.overrides[p.name] || { enabled: null, autoInit: null };
      const row = el('div', 'row');
      const nameCell = el('div', 'name');
      nameCell.append(document.createTextNode(p.name));
      if (p.supportsScope) nameCell.append(el('span', 'badge', '作用域'));
      if (!p.globalEnabled) nameCell.append(el('span', 'badge', '全局关'));
      row.append(nameCell);
      row.append(seg(ov.enabled, async (v) => { await api('/api/set', { root: ws.root, plugin: p.name, patch: { enabled: v } }); toast(p.name + ' → ' + (v === null ? '继承' : v ? '开' : '关')); reload(); }, '继承(' + (p.globalEnabled ? '开' : '关') + ')'));
      row.append(p.supportsScope
        ? seg(ov.autoInit, async (v) => { await api('/api/set', { root: ws.root, plugin: p.name, patch: { autoInit: v } }); toast(p.name + ' autoInit → ' + (v === null ? '继承' : v ? '开' : '关')); reload(); }, '继承')
        : el('span', 'state', '—'));
      const eff = ov.enabled === null ? p.globalEnabled : ov.enabled;
      row.append(el('div', 'state', (p.supportsScope ? '生效：' : '记录：') + (eff ? '开' : '关')));
      card.append(row);
    }
    const foot = el('div', 'row');
    const allOff = el('button', 'act', '全部关闭（*）');
    allOff.onclick = async () => { await api('/api/set', { root: ws.root, plugin: 'all', patch: { enabled: false } }); toast('已写 "*": enabled=false'); reload(); };
    const reset = el('button', 'act', '清空本工作区配置');
    reset.onclick = async () => { await api('/api/reset', { root: ws.root }); toast('已清空'); reload(); };
    foot.append(el('div', 'name', '批量'), el('div', '', ''), el('div', '', ''), el('div', '', ''));
    foot.children[1].append(allOff); foot.children[2].append(reset);
    card.append(foot);
    list.append(card);
  }
  document.getElementById('count').textContent = shown + ' 个工作区 / ' + data.plugins.length + ' 个插件';
  if (shown === 0) list.append(el('div', 'none', '没有匹配的工作区或插件。'));
}
async function reload() { try { render(await api('/api/state')); } catch (e) { toast(String(e)); } }
document.getElementById('q').addEventListener('input', (e) => { QUERY = e.target.value.trim().toLowerCase(); render(DATA); });
for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
    chip.classList.add('on'); FILTER = chip.dataset.filter; render(DATA);
  });
}
reload();
</script></body></html>`;
}

/* ───────── HTTP ───────── */
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu;
const RANGES = ['1h', '6h', '24h', '7d', '30d', '90d', '1y', 'all'];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const originAllowed = origin.length > 0 && LOCAL_ORIGIN.test(origin);
  const headers = (extra = {}) => ({
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    // 只对本机来源回显 ACAO；任意网站拿不到响应体，也就读不到 token
    ...(originAllowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    // iframe 需要被 DSH 页面（另一个本机端口）嵌入
    'content-security-policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
    ...extra,
  });
  const send = (code, type, body) => { res.writeHead(code, headers({ 'content-type': type })); res.end(body); };

  if (req.method === 'OPTIONS') {
    if (!originAllowed) { res.writeHead(403, headers()); res.end(); return undefined; }
    res.writeHead(204, headers({
      'access-control-allow-headers': 'content-type, x-scope-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-max-age': '600',
    }));
    res.end();
    return undefined;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(200, 'text/html; charset=utf-8', page());
  if (req.method === 'GET' && url.pathname === '/api/state') return send(200, 'application/json; charset=utf-8', JSON.stringify(state()));

  if (req.method === 'GET' && url.pathname === '/usage') {
    const asked = url.searchParams.get('range') ?? '30d';
    const range = RANGES.includes(asked) ? asked : '30d';
    const out = join(tmpdir(), `dsh-usage-${process.pid}-${randomBytes(4).toString('hex')}.html`);
    try {
      execFileSync(process.execPath, [USAGE_SCRIPT, '--range', range, '--out', out, '--home', DSH_HOME], { stdio: 'ignore', timeout: 60000 });
      const html = readFileSync(out, 'utf8');
      try { unlinkSync(out); } catch { /* ignore */ }
      return send(200, 'text/html; charset=utf-8', html);
    } catch {
      return send(500, 'text/plain; charset=utf-8', '生成用量报告失败，请查看面板日志。');
    }
  }

  if (req.method === 'POST' && (url.pathname === '/api/set' || url.pathname === '/api/reset')) {
    if (origin.length > 0 && !originAllowed) return send(403, 'text/plain; charset=utf-8', 'forbidden');
    if (req.headers['x-scope-token'] !== TOKEN) return send(403, 'text/plain; charset=utf-8', 'forbidden');

    // 声明超限就直接 413，不读 body、不 destroy（destroy 会 RST，把已入队的 413 丢掉）
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > 1e6) {
      res.writeHead(413, headers({ 'content-type': 'text/plain; charset=utf-8', connection: 'close' }));
      res.end('payload too large');
      req.resume();
      return undefined;
    }

    let body = '';
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      body += chunk;
      if (body.length > 1e6) {
        aborted = true;
        res.writeHead(413, headers({ 'content-type': 'text/plain; charset=utf-8', connection: 'close' }));
        res.end('payload too large');
        // 不 destroy：让剩余字节被读出并丢弃，客户端能完整收到 413
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const data = JSON.parse(body || '{}');
        if (typeof data.root !== 'string') throw new Error('missing root');
        if (url.pathname === '/api/reset') {
          writeState(data.root, 'all', { __reset: true });
          return send(200, 'application/json', JSON.stringify({ ok: true }));
        }
        const file = writeState(data.root, data.plugin, data.patch ?? {});
        send(200, 'application/json', JSON.stringify({ ok: true, file }));
      } catch {
        send(400, 'text/plain; charset=utf-8', '请求不合法');
      }
    });
    return undefined;
  }
  return send(404, 'text/plain; charset=utf-8', 'not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`plugin-scope UI: ${url}`);
  console.log(`DSH_HOME: ${DSH_HOME}`);
  console.log(`usage: ${url}usage?range=30d`);
  if (OPEN) execFile('cmd', ['/c', 'start', '', url], () => {});
});
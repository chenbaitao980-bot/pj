// huatu 客户端脚本测试：node --test .agents/skills/huatu/tests/bridge.test.mjs
// 以子进程运行脚本，对接本地假后端（127.0.0.1 临时端口）。无第三方依赖。
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const BRIDGE_URL = pathToFileURL(path.join(SCRIPTS, 'bridge.mjs')).href;
const TOKEN = 'SECRET-TOKEN-0123456789abcdef-XYZ';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 启动假后端，记录请求；行为由 behavior 对象控制。 */
function startServer(host = '127.0.0.1') {
  const state = {
    requests: [],
    behavior: {},
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
      state.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const b = state.behavior;
      const send = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(data === undefined ? '' : (typeof data === 'string' ? data : JSON.stringify(data)));
      };
      if (b.redirectTo) return send(302, '', { Location: b.redirectTo });
      if (req.method === 'GET' && req.url === '/api/canvas-bridge/v1/targets') {
        return send(b.targetsStatus ?? 200, b.targetsBody ?? { targets: [{ document_id: 'd1', page_id: 'p1', version: 'v7' }] });
      }
      if (req.method === 'POST' && req.url === '/api/canvas-bridge/v1/commands') {
        return send(b.postStatus ?? 202, b.postBody ?? { id: 'cmd-1', status: 'queued' });
      }
      const m = /^\/api\/canvas-bridge\/v1\/commands\/([^?]+)\?wait=(\d+)$/.exec(req.url);
      if (req.method === 'GET' && m) {
        if (b.pollDelayMs) await new Promise((r) => setTimeout(r, b.pollDelayMs));
        const poll = typeof b.poll === 'function' ? b.poll(m[1], state) : (b.poll ?? { status: 'succeeded', result: { echo: 'ok' } });
        return send(b.pollStatus ?? 200, poll);
      }
      return send(404, { error: 'not_found' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve({ server, state, port: server.address().port, host }));
  });
}

const close = (s) => new Promise((r) => { s.server.closeAllConnections?.(); s.server.close(() => r()); });

let srv;
let tmp;
let root;
let tokenFile;
let counter = 0;

function writeRuntimeState(value) {
  const f = path.join(root, 'data', 'config', 'runtime-state.json');
  fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value));
}

/** 运行脚本；自动断言令牌绝不出现在 stdout/stderr。 */
function run(script, args = [], extraEnv = {}, { inputToken = TOKEN } = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('PM_')) delete env[k];
  Object.assign(env, { PM_WORKSTATION_ROOT: root, PM_CANVAS_BRIDGE_TOKEN_FILE: tokenFile }, extraEnv);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(SCRIPTS, script), ...args], { cwd: tmp, env, timeout: 60000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      if (inputToken) {
        assert.ok(!stdout.includes(inputToken), `token leaked to stdout of ${script}`);
        assert.ok(!stderr.includes(inputToken), `token leaked to stderr of ${script}`);
      }
      resolve({ code, stdout, stderr });
    });
  });
}

/** 内联 ESM 子进程（用于 parseArgs / runCommand 超时等无 CLI 旋钮的路径）。 */
function runInline(code, argv = [], extraEnv = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('PM_')) delete env[k];
  Object.assign(env, extraEnv);
  return new Promise((resolve) => {
    execFile(process.execPath, ['--input-type=module', '-e', code, ...argv], { cwd: tmp, env, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr });
    });
  });
}

const errJson = (r) => JSON.parse(r.stderr.trim().split('\n').pop());

function opsFile(content = [{ op: 'add_node', id: 'n1' }]) {
  counter += 1;
  const f = path.join(tmp, `ops-${counter}.json`);
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  return f;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huatu-test-'));
  srv = await startServer();
});
after(async () => {
  await close(srv);
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  srv.state.requests.length = 0;
  srv.state.behavior = {};
  root = path.join(tmp, `ws-${++counter}`);
  fs.mkdirSync(path.join(root, 'data', 'config'), { recursive: true });
  tokenFile = path.join(root, 'data', 'config', 'canvas-bridge-token');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`);
  writeRuntimeState({ ports: { backend: srv.port } });
});

// ---------------- 令牌 / 配置 ----------------

test('token read from file (trimmed) and sent as Bearer; never printed', async () => {
  const r = await run('targets.mjs');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(srv.state.requests.length, 1);
  assert.equal(srv.state.requests[0].auth, `Bearer ${TOKEN}`);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test('tool client relays one action with its target, version and idempotency key', async () => {
  const action = opsFile({ op: 'save_component', name: '盈利判断', ids: ['a'] });
  const result = await run('tool.mjs', ['--request', action, '--doc', 'd1', '--page', 'p1', '--base-version', 'v7', '--key', 'save-key']);
  assert.equal(result.code, 0, result.stderr);
  const submitted = srv.state.requests.find((request) => request.method === 'POST').body;
  assert.deepEqual(submitted, { type: 'tool', idempotency_key: 'save-key', target: { document_id: 'd1', page_id: 'p1' }, base_version: 'v7', ops: [{ op: 'save_component', name: '盈利判断', ids: ['a'] }] });
});

test('tool client rejects a partial target before contacting the backend', async () => {
  const result = await run('tool.mjs', ['--request', opsFile({ op: 'panel', panel: 'shapes', open: true }), '--doc', 'd1']);
  assert.notEqual(result.code, 0);
  assert.equal(srv.state.requests.length, 0);
});

test('token never leaks on any script/outcome (success and failures)', async () => {
  const ops = opsFile();
  await run('targets.mjs');
  await run('catalog.mjs');
  await run('read.mjs', ['--doc', 'd1', '--page', 'p1']);
  await run('apply.mjs', ['--create', 'x', '--ops', ops]);
  srv.state.behavior = { targetsStatus: 401, targetsBody: { error: 'unauthorized' }, postStatus: 401, postBody: { error: 'unauthorized' } };
  await run('targets.mjs');
  await run('catalog.mjs');
  srv.state.behavior = { targetsStatus: 500, postStatus: 500 };
  await run('targets.mjs');
  await run('read.mjs', ['--doc', 'd1', '--page', 'p1']);
  srv.state.behavior = { poll: { status: 'failed', error: { code: 'x' } } };
  await run('read.mjs', ['--doc', 'd1', '--page', 'p1']);
  // run() asserts no leak on every call; ensure the token was actually used
  assert.ok(srv.state.requests.every((q) => q.auth === `Bearer ${TOKEN}`));
});

test('token leakage on connection failure message', async () => {
  const dead = await startServer();
  const deadPort = dead.port;
  await close(dead);
  const r = await run('targets.mjs', ['--base', `http://127.0.0.1:${deadPort}`]);
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /无法连接/);
});

test('empty token file rejected before any request', async () => {
  fs.writeFileSync(tokenFile, '  \n');
  const r = await run('targets.mjs');
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /为空/);
  assert.equal(srv.state.requests.length, 0);
});

test('missing token file gives clear error, no request', async () => {
  fs.rmSync(tokenFile);
  const r = await run('targets.mjs');
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /找不到命令桥令牌文件/);
  assert.equal(srv.state.requests.length, 0);
});

test('PM_CANVAS_BRIDGE_TOKEN_FILE overrides default token location', async () => {
  fs.rmSync(tokenFile);
  const other = path.join(tmp, `other-token-${++counter}`);
  fs.writeFileSync(other, 'OTHER-TOKEN-VALUE');
  const r = await run('targets.mjs', [], { PM_CANVAS_BRIDGE_TOKEN_FILE: other }, { inputToken: 'OTHER-TOKEN-VALUE' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(srv.state.requests[0].auth, 'Bearer OTHER-TOKEN-VALUE');
});

test('default token path under workstation root data/config/canvas-bridge-token', async () => {
  const r = await run('targets.mjs', [], { PM_CANVAS_BRIDGE_TOKEN_FILE: undefined });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(srv.state.requests[0].auth, `Bearer ${TOKEN}`);
});

test('runtime-state.json backend port is picked up', async () => {
  const r = await run('targets.mjs');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(srv.state.requests[0].url, '/api/canvas-bridge/v1/targets');
});

test('PM_BRIDGE_BASE and --base work; --base wins over env', async () => {
  writeRuntimeState({ ports: { backend: 1 } });
  let r = await run('targets.mjs', [], { PM_BRIDGE_BASE: `http://127.0.0.1:${srv.port}/` });
  assert.equal(r.code, 0, r.stderr);
  const dead = await startServer();
  const deadPort = dead.port;
  await close(dead);
  r = await run('targets.mjs', ['--base', `http://localhost:${srv.port}`], { PM_BRIDGE_BASE: `http://127.0.0.1:${deadPort}` });
  assert.equal(r.code, 0, r.stderr);
});

for (const [label, state] of [
  ['port 0', { ports: { backend: 0 } }],
  ['port 70000', { ports: { backend: 70000 } }],
  ['port negative', { ports: { backend: -5 } }],
  ['port non-integer', { ports: { backend: 80.5 } }],
  ['port string garbage', { ports: { backend: 'abc' } }],
  ['port missing', { ports: {} }],
  ['no ports', {}],
  ['malformed JSON', '{not json'],
]) {
  test(`invalid runtime-state (${label}) rejected without any request`, async () => {
    writeRuntimeState(state);
    const r = await run('targets.mjs');
    assert.equal(r.code, 1);
    assert.match(errJson(r).error, /无法确定后端地址/);
    assert.equal(srv.state.requests.length, 0);
  });
}

test('missing runtime-state.json -> no backend address error', async () => {
  fs.rmSync(path.join(root, 'data', 'config', 'runtime-state.json'));
  const r = await run('targets.mjs');
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /无法确定后端地址/);
});

// ---------------- 回环限制 ----------------

let evil;
let evilAvailable = true;
test('setup: second server on 127.0.0.2 (not in loopback allowlist)', async () => {
  try { evil = await startServer('127.0.0.2'); } catch { evilAvailable = false; }
});

const BAD_BASES = [
  'http://evil.com',
  'http://127.0.0.1.evil.com',
  'http://localhost.evil.com',
  'http://localhost@evil.com',
  'http://127.0.0.1@evil.com',
  'http://evil.com#@127.0.0.1',
  'http://evil.com/?x=127.0.0.1',
  'http://0.0.0.0:8080',
  'http://[::2]:8080',
  'not a url',
];
for (const bad of BAD_BASES) {
  for (const via of ['--base', 'env']) {
    test(`non-loopback base rejected (${via}): ${bad}`, async () => {
      const r = via === '--base'
        ? await run('targets.mjs', ['--base', bad])
        : await run('targets.mjs', [], { PM_BRIDGE_BASE: bad });
      assert.equal(r.code, 1, r.stderr);
      assert.match(errJson(r).error, /回环地址/);
      assert.equal(srv.state.requests.length, 0);
    });
  }
}

test('non-loopback base rejected for read/catalog/apply too (no request)', async () => {
  const ops = opsFile();
  const base = 'http://evil.com';
  for (const [script, args] of [
    ['read.mjs', ['--doc', 'd', '--page', 'p']],
    ['catalog.mjs', []],
    ['apply.mjs', ['--create', 'n', '--ops', ops]],
  ]) {
    const r = await run(script, [...args, '--base', base]);
    assert.equal(r.code, 1, script);
    assert.match(errJson(r).error, /回环地址/);
  }
  assert.equal(srv.state.requests.length, 0);
});

test('127.0.0.2 server (non-allowlisted host) is never contacted', async (t) => {
  if (!evilAvailable) return t.skip('127.0.0.2 not bindable on this OS');
  evil.state.requests.length = 0;
  const r = await run('targets.mjs', ['--base', `http://127.0.0.2:${evil.port}`]);
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /回环地址/);
  assert.equal(evil.state.requests.length, 0);
  const r2 = await run('targets.mjs', [], { PM_BRIDGE_BASE: `http://localhost@127.0.0.2:${evil.port}` });
  assert.equal(r2.code, 1);
  assert.equal(evil.state.requests.length, 0);
});

test('IPv6 loopback [::1] passes host check (connection refused is not a host rejection)', async () => {
  const r = await run('targets.mjs', ['--base', 'http://[::1]:1']);
  assert.equal(r.code, 1);
  assert.doesNotMatch(errJson(r).error, /回环地址/);
});

test('cross-origin redirect from loopback backend does not forward Authorization', async (t) => {
  if (!evilAvailable) return t.skip('127.0.0.2 not bindable');
  evil.state.requests.length = 0;
  srv.state.behavior = { redirectTo: `http://127.0.0.2:${evil.port}/api/canvas-bridge/v1/targets` };
  await run('targets.mjs');
  const leaked = evil.state.requests.filter((q) => q.auth);
  assert.equal(leaked.length, 0, 'Authorization header forwarded across origins on redirect');
});

// ---------------- 退出码 ----------------

test('503 -> exit 2 with clear message (targets)', async () => {
  srv.state.behavior = { targetsStatus: 503, targetsBody: { error: 'no_live_editor' } };
  const r = await run('targets.mjs');
  assert.equal(r.code, 2);
  const e = errJson(r);
  assert.equal(e.ok, false);
  assert.match(e.error, /没有在线的工作站主窗口/);
  assert.match(e.error, /无需手动打开画布/);
  assert.equal(e.detail.error, 'no_live_editor');
});

test('503 on command submit -> exit 2 (catalog/read)', async () => {
  srv.state.behavior = { postStatus: 503, postBody: { error: 'no_live_editor' } };
  for (const [s, a] of [['catalog.mjs', []], ['read.mjs', ['--doc', 'd', '--page', 'p']]]) {
    const r = await run(s, a);
    assert.equal(r.code, 2, s);
    assert.match(errJson(r).error, /没有在线的工作站主窗口/);
    assert.match(errJson(r).error, /无需手动打开画布/);
  }
});

test('401 -> exit 3; 403 -> exit 3', async () => {
  for (const status of [401, 403]) {
    srv.state.behavior = { targetsStatus: status, targetsBody: { error: 'unauthorized' } };
    const r = await run('targets.mjs');
    assert.equal(r.code, 3);
    assert.match(errJson(r).error, /令牌无效/);
  }
});

test('other HTTP errors -> exit 4 (targets, submit, poll)', async () => {
  srv.state.behavior = { targetsStatus: 500 };
  assert.equal((await run('targets.mjs')).code, 4);
  srv.state.behavior = { postStatus: 400, postBody: { error: 'bad' } };
  assert.equal((await run('catalog.mjs')).code, 4);
  srv.state.behavior = { pollStatus: 404, poll: { error: 'gone' } };
  assert.equal((await run('catalog.mjs')).code, 4);
});

test('non-JSON error body does not crash (exit 4)', async () => {
  srv.state.behavior = { targetsStatus: 502, targetsBody: '<html>bad gateway</html>' };
  const r = await run('targets.mjs');
  assert.equal(r.code, 4);
  assert.match(errJson(r).detail.raw, /bad gateway/);
});

test('failed command -> exit 5 with error code in output', async () => {
  srv.state.behavior = { poll: { status: 'failed', error: { code: 'version_conflict', message: 'stale' } } };
  const r = await run('read.mjs', ['--doc', 'd1', '--page', 'p1']);
  assert.equal(r.code, 5);
  assert.match(r.stderr, /version_conflict/);
  assert.equal(errJson(r).detail.status, 'failed');
});

test('queued then succeeded: polls until terminal, prints merged result', async () => {
  let n = 0;
  srv.state.behavior = { poll: () => (++n < 3 ? { status: 'running' } : { status: 'succeeded', result: { v: 1 } }) };
  const r = await run('catalog.mjs');
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.id, 'cmd-1');
  assert.deepEqual(out.result, { v: 1 });
  const polls = srv.state.requests.filter((q) => q.method === 'GET');
  assert.equal(polls.length, 3);
  assert.ok(polls.every((q) => q.url === '/api/canvas-bridge/v1/commands/cmd-1?wait=25'));
});

test('long-poll timeout -> exit 6 with id in detail (runCommand timeoutSeconds, via inline module)', async () => {
  srv.state.behavior = { poll: { status: 'queued' }, pollDelayMs: 50 };
  const code = `
    import { resolveConfig, runCommand } from ${JSON.stringify(BRIDGE_URL)};
    const cfg = resolveConfig({});
    await runCommand(cfg, { type: 'catalog' }, { timeoutSeconds: 0.3 });
    console.log('unexpected success');`;
  const r = await runInline(code, [], {
    PM_WORKSTATION_ROOT: root, PM_CANVAS_BRIDGE_TOKEN_FILE: tokenFile,
  });
  assert.equal(r.code, 6, r.stderr + r.stdout);
  assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN));
  const e = JSON.parse(r.stderr.trim().split('\n').pop());
  assert.match(e.error, /结果未知/);
  assert.equal(e.detail.id, 'cmd-1');
});

test('no CLI timeout knob exists (documented): CLI scripts cannot be driven to exit 6 quickly', () => {
  for (const f of ['read.mjs', 'catalog.mjs', 'apply.mjs', 'targets.mjs']) {
    assert.ok(!/timeout/i.test(fs.readFileSync(path.join(SCRIPTS, f), 'utf8')), f);
  }
});

// ---------------- apply.mjs 参数校验 ----------------

test('apply: missing --ops / --ops without value', async () => {
  for (const args of [['--create', 'x'], ['--create', 'x', '--ops']]) {
    const r = await run('apply.mjs', args);
    assert.equal(r.code, 1);
    assert.match(errJson(r).error, /需要 --ops/);
  }
  assert.equal(srv.state.requests.length, 0);
});

test('apply: unreadable / invalid JSON ops file', async () => {
  let r = await run('apply.mjs', ['--create', 'x', '--ops', path.join(tmp, 'nope.json')]);
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /无法读取 ops 文件/);
  r = await run('apply.mjs', ['--create', 'x', '--ops', opsFile('{bad')]);
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /无法读取 ops 文件/);
});

test('apply: ops must be non-empty array', async () => {
  for (const c of [{ op: 'x' }, [], 'null', '"str"', 5]) {
    const r = await run('apply.mjs', ['--create', 'x', '--ops', opsFile(typeof c === 'string' ? c : JSON.stringify(c))]);
    assert.equal(r.code, 1);
    assert.match(errJson(r).error, /非空数组/);
  }
  assert.equal(srv.state.requests.length, 0);
});

test('apply: --create with --doc or --page rejected', async () => {
  const ops = opsFile();
  for (const extra of [['--doc', 'd'], ['--page', 'p'], ['--doc', 'd', '--page', 'p']]) {
    const r = await run('apply.mjs', ['--create', 'x', '--ops', ops, ...extra]);
    assert.equal(r.code, 1);
    assert.match(errJson(r).error, /不能同时使用/);
  }
  assert.equal(srv.state.requests.length, 0);
});

test('apply: existing target requires --doc and --page', async () => {
  const ops = opsFile();
  for (const extra of [[], ['--doc', 'd'], ['--page', 'p']]) {
    const r = await run('apply.mjs', ['--ops', ops, '--base-version', '3', ...extra]);
    assert.equal(r.code, 1);
    assert.match(errJson(r).error, /需要 --doc 与 --page/);
  }
});

test('apply: existing target without --base-version rejected (also valueless flag)', async () => {
  const ops = opsFile();
  for (const extra of [[], ['--base-version']]) {
    const r = await run('apply.mjs', ['--doc', 'd1', '--page', 'p1', '--ops', ops, ...extra]);
    assert.equal(r.code, 1);
    assert.match(errJson(r).error, /--base-version/);
  }
  assert.equal(srv.state.requests.length, 0);
});

test('apply: bare --create (no name) falls through to existing-target validation', async () => {
  const r = await run('apply.mjs', ['--create', '--ops', opsFile()]);
  assert.equal(r.code, 1);
  assert.match(errJson(r).error, /需要 --doc 与 --page/);
});

test('apply: valid create builds target {create:{name}} with no base_version', async () => {
  const ops = [{ op: 'add_node', id: 'n1' }, { op: 'add_edge', id: 'e1' }];
  const r = await run('apply.mjs', ['--create', '采购流程', '--ops', opsFile(ops)]);
  assert.equal(r.code, 0, r.stderr);
  const post = srv.state.requests.find((q) => q.method === 'POST');
  assert.equal(post.body.type, 'apply');
  assert.deepEqual(post.body.target, { create: { name: '采购流程' } });
  assert.ok(!('base_version' in post.body));
  assert.deepEqual(post.body.ops, ops);
  assert.equal(post.auth, `Bearer ${TOKEN}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.idempotency_key, post.body.idempotency_key);
});

test('apply: valid existing builds target + base_version', async () => {
  const r = await run('apply.mjs', ['--doc', 'd1', '--page', 'p1', '--base-version', 'v7', '--ops', opsFile()]);
  assert.equal(r.code, 0, r.stderr);
  const post = srv.state.requests.find((q) => q.method === 'POST');
  assert.deepEqual(post.body.target, { document_id: 'd1', page_id: 'p1' });
  assert.equal(post.body.base_version, 'v7');
  assert.ok(!('create' in post.body.target));
});

test('apply: --key forwarded as idempotency_key', async () => {
  const r = await run('apply.mjs', ['--create', 'x', '--ops', opsFile(), '--key', 'my-key-1']);
  assert.equal(r.code, 0, r.stderr);
  const post = srv.state.requests.find((q) => q.method === 'POST');
  assert.equal(post.body.idempotency_key, 'my-key-1');
  assert.equal(JSON.parse(r.stdout).idempotency_key, 'my-key-1');
});

test('apply: auto idempotency key is a uuid and differs per run', async () => {
  const keys = [];
  for (let i = 0; i < 2; i += 1) {
    const r = await run('apply.mjs', ['--create', 'x', '--ops', opsFile()]);
    assert.equal(r.code, 0, r.stderr);
    keys.push(srv.state.requests.filter((q) => q.method === 'POST').pop().body.idempotency_key);
  }
  assert.match(keys[0], UUID_RE);
  assert.match(keys[1], UUID_RE);
  assert.notEqual(keys[0], keys[1]);
});

test('apply: valueless --key falls back to auto uuid', async () => {
  const r = await run('apply.mjs', ['--create', 'x', '--ops', opsFile(), '--key']);
  assert.equal(r.code, 0, r.stderr);
  const post = srv.state.requests.find((q) => q.method === 'POST');
  assert.match(post.body.idempotency_key, UUID_RE);
});

// ---------------- read / catalog / targets ----------------

test('read: requires --doc and --page (no request otherwise)', async () => {
  for (const args of [[], ['--doc', 'd1'], ['--page', 'p1'], ['--doc', '--page', 'p1']]) {
    const r = await run('read.mjs', args);
    assert.equal(r.code, 1, JSON.stringify(args));
    assert.match(errJson(r).error, /需要 --doc 与 --page/);
  }
  assert.equal(srv.state.requests.length, 0);
});

test('read: valid builds read command with target', async () => {
  const r = await run('read.mjs', ['--doc', 'd1', '--page', 'p1']);
  assert.equal(r.code, 0, r.stderr);
  const post = srv.state.requests.find((q) => q.method === 'POST');
  assert.equal(post.body.type, 'read');
  assert.deepEqual(post.body.target, { document_id: 'd1', page_id: 'p1' });
  assert.match(post.body.idempotency_key, UUID_RE);
});

test('catalog: sends catalog command and prints ok result', async () => {
  const r = await run('catalog.mjs');
  assert.equal(r.code, 0, r.stderr);
  const post = srv.state.requests.find((q) => q.method === 'POST');
  assert.equal(post.body.type, 'catalog');
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test('targets: prints server targets merged with ok:true', async () => {
  const r = await run('targets.mjs');
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.targets[0].version, 'v7');
});

// ---------------- parseArgs 边界 ----------------

test('parseArgs edge cases', async () => {
  const code = `
    import { parseArgs } from ${JSON.stringify(BRIDGE_URL)};
    const cases = JSON.parse(process.argv[1]);
    console.log(JSON.stringify(cases.map((c) => parseArgs(c))));`;
  const cases = [
    [],
    ['--a', '--b', 'x'],
    ['pos', '--k', 'v'],
    ['--k'],
    ['--k', '-5'],
    ['--a=b'],
    ['--k', 'v', 'extra', '--z', 'w'],
    ['--'],
    ['--k', 'a', '--k', 'b'],
    ['--k', ''],
    ['-x', 'y'],
  ];
  const r = await runInline(code, [JSON.stringify(cases)]);
  assert.equal(r.code, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(got, [
    {},
    { a: true, b: 'x' },
    { k: 'v' },
    { k: true },
    { k: '-5' },
    { 'a=b': true },
    { k: 'v', z: 'w' },
    { '': true },
    { k: 'b' },
    { k: '' },
    {},
  ]);
});

test('fail() writes JSON to stderr with exit code and optional detail', async () => {
  const code = `
    import { fail } from ${JSON.stringify(BRIDGE_URL)};
    fail('boom', 7, { a: 1 });`;
  const r = await runInline(code);
  assert.equal(r.code, 7);
  assert.deepEqual(JSON.parse(r.stderr), { ok: false, error: 'boom', detail: { a: 1 } });
  assert.equal(r.stdout, '');
});

test('printJson pretty-prints to stdout', async () => {
  const code = `
    import { printJson } from ${JSON.stringify(BRIDGE_URL)};
    printJson({ a: [1] });`;
  const r = await runInline(code);
  assert.equal(r.stdout, '{\n  "a": [\n    1\n  ]\n}\n');
});

after(async () => { if (evil) await close(evil); });

// huatu 公共客户端：定位工作站、读取令牌、发送命令并等待结果。无第三方依赖（Node 18+）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function findWorkstationRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'data', 'config', 'runtime-state.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveConfig(args = {}) {
  const root = process.env.PM_WORKSTATION_ROOT || findWorkstationRoot();
  let base = args.base || process.env.PM_BRIDGE_BASE;
  if (!base && root) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config', 'runtime-state.json'), 'utf8'));
      const port = Number(state?.ports?.backend);
      if (Number.isInteger(port) && port > 0 && port < 65536) base = `http://127.0.0.1:${port}`;
    } catch { /* 工作站未运行：下面报错 */ }
  }
  const tokenFile = process.env.PM_CANVAS_BRIDGE_TOKEN_FILE || (root ? path.join(root, 'data', 'config', 'canvas-bridge-token') : null);
  if (!base) fail('无法确定后端地址：请先启动工作站，或用 --base / PM_BRIDGE_BASE 指定。');
  if (!tokenFile || !fs.existsSync(tokenFile)) fail(`找不到命令桥令牌文件（${tokenFile ?? '未知路径'}）：工作站后端需先运行一次。`);
  let host = '';
  try { host = new URL(base).hostname.replace(/^\[|\]$/g, ''); } catch { /* 下面报错 */ }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) fail('后端地址必须是回环地址（127.0.0.1/localhost），拒绝把令牌发往其他主机。');
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  if (!token) fail('命令桥令牌文件为空：请重启工作站后端以重新生成。');
  return { base: base.replace(/\/$/, ''), token };
}

export function fail(message, code = 1, detail) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message, ...(detail ? { detail } : {}) })}\n`);
  process.exit(code);
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next === undefined || next.startsWith('--') ? true : next;
    if (out[key] !== true) i += 1;
  }
  return out;
}

async function http(config, method, route, body) {
  let response;
  try {
    response = await fetch(`${config.base}/api/canvas-bridge${route}`, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(`无法连接工作站后端 ${config.base}：${error.message}`);
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: response.status, data };
}

export async function listTargets(config) {
  const { status, data } = await http(config, 'GET', '/v1/targets');
  if (status === 503) fail('没有在线的工作站主窗口：请启动工作站；如已启动，请刷新或重启主窗口以加载新版命令桥，无需手动打开画布。', 2, data);
  if (status === 401 || status === 403) fail('令牌无效或被拒绝。', 3, data);
  if (status !== 200) fail(`读取目标失败（HTTP ${status}）`, 4, data);
  return data;
}

/** 提交命令并等待终态；超时仍未完成则报告而不是假设成功。 */
export async function runCommand(config, command, { timeoutSeconds = 90 } = {}) {
  const body = { idempotency_key: command.idempotency_key || crypto.randomUUID(), ...command };
  const submitted = await http(config, 'POST', '/v1/commands', body);
  if (submitted.status === 503) fail('没有在线的工作站主窗口：请启动工作站；如已启动，请刷新或重启主窗口以加载新版命令桥，无需手动打开画布。', 2, submitted.data);
  if (![200, 202].includes(submitted.status)) fail(`提交命令失败（HTTP ${submitted.status}）`, 4, submitted.data);
  const id = submitted.data.id;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const polled = await http(config, 'GET', `/v1/commands/${id}?wait=25`);
    if (polled.status !== 200) fail(`查询命令失败（HTTP ${polled.status}）`, 4, polled.data);
    if (polled.data.status === 'succeeded') return { id, idempotency_key: body.idempotency_key, ...polled.data };
    if (polled.data.status === 'failed') fail(`命令失败：${JSON.stringify(polled.data.error)}`, 5, polled.data);
  }
  fail(`等待超过 ${timeoutSeconds} 秒仍未完成：结果未知，请先 targets/read 核对再决定是否重试（沿用同一 --key 可避免重复写入）。`, 6, { id });
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

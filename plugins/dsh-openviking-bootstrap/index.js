import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-openviking-bootstrap';
export const inject = ['llm', 'agentDefaultModel'];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVER_PORT = 1933;
const DEFAULT_BRIDGE_PORT = 8082;
const HEALTH_PATHS = ['/health', '/healthz', '/api/health', '/v1/health'];

function log(root, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    if (root) {
      mkdirSync(path.join(root, 'logs'), { recursive: true });
      appendFileSync(path.join(root, 'logs', 'bootstrap.log'), line, 'utf8');
    }
  } catch {
    // Logging must never prevent the host from starting.
  }
  console.log(`[openviking-bootstrap] ${message}`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean).map((item) => path.resolve(item)))];
}

function candidateRoots() {
  const roots = [];
  if (process.env.OPENVIKING_RUNTIME_ROOT) roots.push(process.env.OPENVIKING_RUNTIME_ROOT);

  const pointer = path.join(os.homedir(), '.openviking', 'dsh-runtime.json');
  const pointerData = readJson(pointer);
  if (pointerData?.root) roots.push(pointerData.root);

  // Installed from the repository: <repo>/plugins/dsh-openviking-bootstrap.
  roots.push(path.resolve(HERE, '..', '..', 'runtime', 'openviking'));
  roots.push('E:\\claude\\project4\\pj\\runtime\\openviking');
  return unique(roots);
}

function resolveRoot() {
  for (const root of candidateRoots()) {
    if (existsSync(path.join(root, 'runtime.json')) || existsSync(path.join(root, 'config.json'))) {
      return root;
    }
  }
  return null;
}

function serviceSpec(root, raw, defaults) {
  const host = raw?.host ?? defaults.host ?? '127.0.0.1';
  const port = Number(raw?.port ?? defaults.port);
  const cwd = path.resolve(root, raw?.cwd ?? defaults.cwd ?? '.');
  const command = raw?.command ?? defaults.command;
  const args = raw?.args ?? defaults.args ?? null;
  return {
    host,
    port,
    cwd,
    command,
    args,
    baseUrl: raw?.baseUrl ?? `http://${host}:${port}`,
    healthPath: raw?.healthPath ?? defaults.healthPath ?? null,
    startupTimeoutMs: Number(raw?.startupTimeoutMs ?? defaults.startupTimeoutMs ?? 60000),
    logFile: raw?.logFile ?? defaults.logFile,
    env: raw?.env ?? {},
    attachOnly: raw?.attachOnly === true,
    enabled: raw?.enabled !== false,
  };
}

function readRuntime(root) {
  const runtime = readJson(path.join(root, 'runtime.json')) ?? {};
  const config = readJson(path.join(root, 'config.json')) ?? {};

  const server = serviceSpec(root, runtime, {
    host: '127.0.0.1',
    port: DEFAULT_SERVER_PORT,
    cwd: '.',
    command: path.join('venv', 'Scripts', 'openviking-server.exe'),
    args: null,
    healthPath: '/health',
    startupTimeoutMs: 180000,
    logFile: path.join(root, 'logs', 'server.log'),
  });

  const bridgeRaw = runtime.bridge ?? config.bridge ?? null;
  const bridgeEnabled = bridgeRaw?.enabled ?? bridgeRaw !== null;
  const bridgeHost = bridgeRaw?.host ?? '127.0.0.1';
  const bridgePort = Number(bridgeRaw?.port ?? DEFAULT_BRIDGE_PORT);
  const bridge = bridgeEnabled
    ? {
        enabled: true,
        host: bridgeHost,
        port: bridgePort,
        baseUrl: `http://${bridgeHost}:${bridgePort}`,
      }
    : null;

  return {
    root,
    server,
    bridge,
    host: server.host,
    port: server.port,
    baseUrl: server.baseUrl,
    healthPath: server.healthPath,
    startupTimeoutMs: server.startupTimeoutMs,
    attachOnly: server.attachOnly,
    logFile: server.logFile,
  };
}

function httpStatus(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(0);
    });
    request.on('error', () => resolve(0));
  });
}

async function healthy(service) {
  const paths = service.healthPath ? [service.healthPath] : HEALTH_PATHS;
  for (const suffix of paths) {
    const status = await httpStatus(`${service.baseUrl}${suffix}`);
    if (status >= 200 && status < 400) return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : String(content);
}

function bridgeMessage(role, content, selection) {
  const text = textOf(content);
  if (role === 'system') {
    return {
      role: 'system',
      id: randomUUID(),
      content: text ? [{ type: 'text', text }] : [],
      source: { kind: 'system-prompt' },
    };
  }
  if (role === 'assistant') {
    return {
      role: 'assistant',
      id: randomUUID(),
      content: text ? [{ type: 'text', text }] : [],
      source: { kind: 'model', provider: selection.provider, model: selection.model },
    };
  }
  return {
    role: 'user',
    id: randomUUID(),
    content: text ? [{ type: 'text', text }] : [],
    source: { kind: 'bridge' },
  };
}

async function bridgeCompletion(ctx, selection, body) {
  const messages = (Array.isArray(body.messages) ? body.messages : []).map((message) =>
    bridgeMessage(message?.role === 'assistant' ? 'assistant' : message?.role === 'system' ? 'system' : 'user', message?.content, selection),
  );
  let text = '';
  let failure = null;
  const stream = ctx.llm.stream({
    provider: selection.provider,
    model: selection.model,
    messages,
    sessionId: 'openviking-memory-bridge',
    ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    maxTokens: Number(body.max_tokens ?? body.max_completion_tokens ?? 4096),
    temperature: Number(body.temperature ?? 0.1),
  });
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text;
    } else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      failure = chunk.reason.failure;
    } else if (chunk?.type === 'finish' && chunk.reason?.kind === 'aborted') {
      failure = chunk.reason.failure ?? new Error('aborted');
    }
  }
  if (failure) throw new Error(failure.message ?? String(failure));
  if (!text.trim()) throw new Error('empty model response');
  return text;
}

function currentSelectionOrNull(ctx) {
  try {
    return ctx?.agentDefaultModel?.currentSelection() ?? null;
  } catch {
    return null;
  }
}

function startBridge(ctx, root, bridge) {
  if (!bridge?.enabled) return null;
  const existing = globalThis.__DSH_OPENVIKING_BRIDGE__;
  if (existing?.server) {
    // A fresh apply rebinds the live server to the new context; leaving it on
    // a disposed context made agentDefaultModel throw "inactive context",
    // which took the whole host down.
    existing.ctx = ctx;
    existing.active = true;
    if (!existing.server.listening) {
      existing.server.listen(bridge.port, bridge.host, () => {
        log(root, `bridge ready at http://${bridge.host}:${bridge.port}/v1`);
      });
    }
    return existing;
  }
  if (!ctx?.llm || typeof ctx.llm.stream !== 'function') {
    log(root, 'bridge: llm service unavailable');
    return null;
  }

  const state = { ctx, active: true, server: null, baseUrl: `http://${bridge.host}:${bridge.port}` };
  const server = http.createServer(async (request, response) => {
    try {
      if (!state.active) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'bridge disposed', type: 'bridge_unavailable' } }));
        return;
      }
      const url = new URL(request.url ?? '/', state.baseUrl);
      if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', healthy: true }));
        return;
      }
      const isModels = request.method === 'GET' && url.pathname === '/v1/models';
      const isChat = request.method === 'POST' && url.pathname === '/v1/chat/completions';
      if (!isModels && !isChat) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'not found', type: 'invalid_request_error' } }));
        return;
      }
      const selection = currentSelectionOrNull(state.ctx);
      if (!selection?.model) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'model selection unavailable (context inactive)', type: 'bridge_unavailable' } }));
        return;
      }
      if (isModels) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          object: 'list',
          data: [{ id: selection.model, object: 'model', owned_by: selection.provider }],
        }));
        return;
      }

      const body = JSON.parse(await readRequestBody(request));
      const text = await bridgeCompletion(state.ctx, selection, body);
      const payload = {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: selection.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        response.write(`data: ${JSON.stringify({ ...payload, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...payload, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        response.write('data: [DONE]\n\n');
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(root, `bridge request failed: ${message}`);
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: { message, type: 'bridge_error' } }));
    }
  });

  server.on('error', (error) => log(root, `bridge server error: ${error.message}`));
  server.on('clientError', (error, socket) => {
    log(root, `bridge client error: ${error.message}`);
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } catch {
      // ignore
    }
  });
  server.listen(bridge.port, bridge.host, () => {
    log(root, `bridge ready at http://${bridge.host}:${bridge.port}/v1`);
  });
  state.server = server;
  globalThis.__DSH_OPENVIKING_BRIDGE__ = state;
  ctx.on?.('dispose', () => {
    if (state.ctx !== ctx) return;
    state.active = false;
    try {
      server.closeAllConnections?.();
    } catch {
      // ignore
    }
    try {
      server.close();
    } catch {
      // ignore
    }
  });
  return state;
}

function resolveCommand(root, service) {
  if (!service.command) return null;
  const command = path.isAbsolute(service.command)
    ? service.command
    : path.join(root, service.command);
  return existsSync(command) ? command : service.command;
}

function defaultArgs(command, service, isPython) {
  if (service.args) return service.args.map(String);
  const config = path.join(service.cwd, 'ov.conf');
  if (isPython) {
    return ['-m', 'openviking.server', '--config', config, '--host', service.host, '--port', String(service.port)];
  }
  return ['--config', config, '--host', service.host, '--port', String(service.port)];
}

function stopChild(child, root, label) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
    log(root, `stopped ${label} pid=${child.pid}`);
  } catch (error) {
    log(root, `stop ${label} failed pid=${child.pid}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function startService(root, service, label) {
  if (!service || !service.enabled) return null;
  const command = resolveCommand(root, service);
  if (!command) {
    log(root, `${label}: command not found: ${service.command ?? '<none>'}`);
    return null;
  }
  mkdirSync(path.dirname(service.logFile), { recursive: true });
  const logFd = openSync(service.logFile, 'a');
  const isPython = command.toLowerCase().endsWith('python.exe') || command.toLowerCase().endsWith('python');
  const args = service.args
    ? service.args.map(String)
    : defaultArgs(command, service, isPython);
  const env = {
    ...process.env,
    ...service.env,
    PYTHONIOENCODING: 'utf-8',
    OPENVIKING_HOST: service.host,
    OPENVIKING_PORT: String(service.port),
    OPENVIKING_DATA_DIR: service.env?.OPENVIKING_DATA_DIR ?? path.join(root, 'data'),
  };
  log(root, `starting ${label}: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd: service.cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.on('error', (error) => log(root, `${label} spawn error: ${error.message}`));
  child.on('exit', (code, signal) => log(root, `${label} exited code=${code} signal=${signal}`));
  return child;
}

async function waitHealthy(root, service, child, label) {
  const deadline = Date.now() + service.startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await healthy(service)) {
      log(root, `${label} ready at ${service.baseUrl}${service.healthPath ?? ''}`);
      return true;
    }
    if (child && child.exitCode !== null) break;
    await sleep(700);
  }
  log(root, `${label} not healthy within ${service.startupTimeoutMs}ms; see ${service.logFile}`);
  return false;
}

export async function apply(ctx) {
  const root = resolveRoot();
  if (!root) {
    log(null, 'runtime root not found; set OPENVIKING_RUNTIME_ROOT or ~/.openviking/dsh-runtime.json');
    return;
  }
  const runtime = readRuntime(root);
  const bridge = startBridge(ctx, root, runtime.bridge);
  if (bridge) {
    globalThis.__DSH_OPENVIKING_BRIDGE__ = bridge;
    log(root, `bridge listening at ${bridge.baseUrl}/v1`);
  }

  const current = globalThis.__DSH_OPENVIKING_RUNTIME__;
  if (current?.status === 'ready') return;

  globalThis.__DSH_OPENVIKING_RUNTIME__ = {
    root,
    baseUrl: runtime.baseUrl,
    status: 'checking',
    bridgeBaseUrl: bridge?.baseUrl ?? null,
  };

  const children = [];
  ctx.on?.('dispose', () => {
    for (const item of children) stopChild(item.child, root, item.label);
  });

  if (await healthy(runtime.server)) {
    globalThis.__DSH_OPENVIKING_RUNTIME__.status = 'ready';
    globalThis.__DSH_OPENVIKING_RUNTIME__.managed = false;
    log(root, `already healthy at ${runtime.baseUrl}`);
    return;
  }
  if (runtime.attachOnly) {
    globalThis.__DSH_OPENVIKING_RUNTIME__.status = 'unavailable';
    log(root, `not healthy and attachOnly=true: ${runtime.baseUrl}`);
    return;
  }

  const child = startService(root, runtime.server, 'server');
  if (!child) {
    globalThis.__DSH_OPENVIKING_RUNTIME__.status = 'unavailable';
    log(root, 'no openviking-server/python found under runtime/venv');
    return;
  }
  children.push({ child, label: 'server' });
  globalThis.__DSH_OPENVIKING_RUNTIME__.pid = child.pid;

  if (await waitHealthy(root, runtime.server, child, 'server')) {
    globalThis.__DSH_OPENVIKING_RUNTIME__.status = 'ready';
    globalThis.__DSH_OPENVIKING_RUNTIME__.managed = true;
  } else {
    globalThis.__DSH_OPENVIKING_RUNTIME__.status = 'unavailable';
  }
}

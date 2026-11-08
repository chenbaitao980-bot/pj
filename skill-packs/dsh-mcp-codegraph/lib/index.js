/**
 * dsh-mcp-codegraph — CodeGraph 代码知识图谱 MCP 的「自动调用 + 自动初始化」侧。
 *
 * 三件事：
 *  1. MCP 服务由同目录 `cordis.patch.yml` 注册（serverName: codegraph）；
 *  2. 插件启用时，会话第一步注入「先 codegraph_explore，再决定要不要 Read」的约束；
 *  3. 插件启用且项目里没有 `.codegraph/` 时，**自动在后台跑 `codegraph init -y`** 建索引，
 *     并把「正在建索引」告诉模型；插件不启用则完全不动。
 *
 * 与 dsh-mcp-gitnexus 分工：
 *  - CodeGraph：单次调用拿到某个符号/文件的逐字源码 + 调用路径 + 爆炸半径摘要（替代 grep+Read 循环）；
 *  - GitNexus：跨仓库/流程级的影响面、路由与形状校验、提交前变更分析。
 *
 * 设计约束同 dsh-mcp-gitnexus：只用 node: 内置模块、异常吞掉、每会话一次每项目一次、
 * 关闭开关 DSH_CODE_INTEL_HOOKS=0 / DSH_CODEGRAPH_GUIDE=0 / DSH_CODE_INTEL_AUTOINIT=0。
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveScope } from './scope.js';

const name = 'mcp-codegraph';

const SOURCE_KIND = 'codegraph-usage-guidance';
const DEFAULT_MAX_CHARS = 6000;
const MAX_WALK_UP = 12;

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pnpm-workspace.yaml',
  'pom.xml',
  'build.gradle',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  '.sln',
];

const GUIDANCE = `CodeGraph MCP 已启用（工具：\`codegraph_explore\`，随冻结版内置、离线可用）。

用法约定 —— 一次调用顶一轮搜索：
- 参数 \`query\` 可以是自然语言问题（"这个请求怎么走到数据库"），也可以是符号/文件名清单（"AuthService loginUser session-manager"）。
- 返回的是**逐字带行号的源码** + 符号之间的调用路径 + blast radius 摘要。拿到后不要再 Read 同一批文件（视为已读）。
- 需要第二个代码库时传 \`projectPath\`。
- 典型场景：改代码前先摸清符号全貌、定位实现位置、理解跨文件调用链、确认某函数还有没有别的调用方。
- 与 GitNexus 配合：CodeGraph 拿源码与局部路径，GitNexus 拿影响面与流程级结论。
索引由插件自动维护：项目缺 \`.codegraph/\` 时插件会在后台跑 \`codegraph init\`；建索引期间必要时用 grep/Read 兜底。`;

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function createContextMessage(text) {
  return deepFreeze(structuredClone({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: SOURCE_KIND,
      form: 'snapshot',
      sections: [{ name: SOURCE_KIND, text }],
    },
  }));
}

function escapeReminder(text) {
  return String(text).replaceAll('</system-reminder>', '<\\/system-reminder>');
}

function frameContext(body) {
  return `<system-reminder>\nCodeGraph guidance（dsh-mcp-codegraph 自动注入；不是用户消息）。\n\n${escapeReminder(body)}\n</system-reminder>`;
}

function off(config) {
  const offSet = new Set(['0', 'false', 'off']);
  return config.enabled === false
    || offSet.has(String(process.env.DSH_CODE_INTEL_HOOKS ?? '').toLowerCase())
    || offSet.has(String(process.env.DSH_CODEGRAPH_GUIDE ?? '').toLowerCase());
}

function autoInitDisabled(config) {
  const offSet = new Set(['0', 'false', 'off']);
  return config.autoInit === false
    || offSet.has(String(process.env.DSH_CODE_INTEL_AUTOINIT ?? '').toLowerCase());
}

function clamp(text, maxChars) {
  const body = String(text ?? '').trim();
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars - 24)}…（已按上限截断）`;
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function findProjectRoot(cwd) {
  let current;
  try {
    current = resolve(cwd);
  } catch {
    return undefined;
  }
  if (!isDir(current)) return undefined;
  let fallback;
  for (let depth = 0; depth < MAX_WALK_UP && current; depth += 1) {
    let entries = [];
    try {
      entries = readdirSync(current);
    } catch {
      return fallback;
    }
    if (entries.includes('.git')) return current;
    if (fallback === undefined && entries.some((entry) => PROJECT_MARKERS.includes(entry))) fallback = current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return fallback;
}

function visibleInjection(session) {
  try {
    const nodes = session?.surface?.nodes;
    if (nodes === undefined || typeof session?.eventAt !== 'function') return false;
    const list = typeof nodes.toReversed === 'function' ? nodes.toReversed() : [...nodes].reverse();
    for (const seq of list) {
      const event = session.eventAt(seq);
      if (event?.type !== 'user/message') continue;
      if (event.data?.source?.kind === SOURCE_KIND) return true;
    }
  } catch {
    /* 结构变化时降级到内存去重 */
  }
  return false;
}

async function resolveCwd(ctx, agent, signal) {
  try {
    const workingDirectory = ctx.get?.('workingDirectory');
    if (workingDirectory !== undefined) {
      const cwd = await workingDirectory.ensure(agent, signal);
      if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    }
  } catch {
    /* 服务不可用时退回进程 cwd */
  }
  try {
    const workspace = ctx.get?.('workspace');
    if (typeof workspace?.cwd === 'string' && workspace.cwd.length > 0) return workspace.cwd;
  } catch {
    /* ignore */
  }
  return process.cwd();
}

function isSubagent(agent) {
  try {
    const meta = agent?.session?.meta ?? agent?.meta;
    if (meta === undefined || meta === null) return false;
    return meta.origin === 'subagent' || typeof meta.parentSession === 'string';
  } catch {
    return false;
  }
}

/* ────────────────────────── 自动建索引 ────────────────────────── */

const indexAttempted = new Set();

function vendorDirOf(config) {
  return config.vendorDir ?? process.env.DSH_FROZEN_VENDOR ?? '';
}

function nodeOf(config) {
  return config.nodePath ?? process.env.DSH_FROZEN_NODE ?? 'node';
}

/**
 * 后台跑 `codegraph init -y`，不阻塞会话。
 * @returns {{started: boolean, logPath?: string, reason?: string}}
 */
function startIndexing(config, root) {
  const vendor = vendorDirOf(config);
  if (!vendor) return { started: false, reason: 'no-vendor-dir' };
  const shim = join(vendor, 'codegraph', 'npm-shim.js');
  if (!existsSync(shim)) return { started: false, reason: 'missing-cli' };

  const hash = createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 10);
  const logPath = join(tmpdir(), `dsh-codegraph-index-${hash}.log`);

  let fd = -1;
  try {
    fd = openSync(logPath, 'a');
  } catch {
    fd = -1;
  }
  const stdio = fd >= 0 ? ['ignore', fd, fd] : 'ignore';

  const args = [shim, 'init', '-y', root];
  const child = spawn(nodeOf(config), args, {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio,
    env: { ...process.env, NO_COLOR: '1', CI: '1' },
  });
  child.unref();
  if (fd >= 0) {
    try { closeSync(fd); } catch { /* ignore */ }
  }
  return { started: true, logPath };
}

function apply(ctx, config = {}) {
  if (off(config)) return;

  const maxChars = Number.isFinite(config.maxChars) ? Number(config.maxChars) : DEFAULT_MAX_CHARS;
  const body = clamp(config.guidance ?? GUIDANCE, maxChars);
  if (body.length === 0) return;
  if (typeof ctx?.on !== 'function') return;

  const injected = new WeakMap();

  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next();
    try {
      if (decision?.kind === 'reject' || signal?.aborted === true) return decision;
      if (step !== 1) return decision;
      if (agent === undefined) return decision;
      if (config.skipSubagents !== false && isSubagent(agent)) return decision;
      if (injected.has(agent.session) || visibleInjection(agent.session)) return decision;

      const cwd = await resolveCwd(ctx, agent, signal);
      const root = findProjectRoot(cwd);
      if (root === undefined) {
        injected.set(agent.session, true);
        return decision;
      }

      // 按工作区决定是否启用：工作区 .dsh/plugins.json > profile.workspaces > 全局
      const scope = resolveScope(root, config, 'codegraph');
      if (scope.enabled === false) {
        injected.set(agent.session, true);
        return decision;
      }

      let notice = '';
      const key = root.toLowerCase();
      if (scope.autoInit && !autoInitDisabled(config) && !isDir(join(root, '.codegraph')) && !indexAttempted.has(key)) {
        indexAttempted.add(key);
        const started = startIndexing(config, root);
        if (started.started) {
          notice = `CodeGraph 索引不存在：已在后台启动 \`codegraph init\`（项目 ${root}，日志 ${started.logPath}）。本轮必要时先用 grep/Read；索引就绪后优先用 codegraph_explore。`;
        } else if (started.reason !== 'no-vendor-dir') {
          notice = `CodeGraph 索引不存在，且后台建索引未能启动（${started.reason}）。需要时在项目根执行 \`codegraph init\`，或先用 grep/Read。`;
        }
      }

      injected.set(agent.session, true);
      const scopeLine = `作用域：本工作区已启用（来源 ${scope.source}${scope.autoInit ? '' : '，autoInit=off'}）。`;
      const text = [scopeLine, notice, body].filter((part) => typeof part === 'string' && part.length > 0).join('\n\n');
      return { ...decision, messages: [...(decision.messages ?? []), createContextMessage(frameContext(text))] };
    } catch (error) {
      try {
        ctx.logger?.warn?.('codegraph guidance injection failed: %o', error);
      } catch {
        /* ignore logger failures */
      }
      return decision;
    }
  }, { prepend: true });
}

export { apply, name };

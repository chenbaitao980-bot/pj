/**
 * dsh-mcp-gitnexus — GitNexus 代码图谱 MCP 的「自动调用 + 自动初始化」侧。
 *
 * 三件事：
 *  1. MCP 服务由同目录 `cordis.patch.yml` 注册（name: @deepseek-ai/dsh-mcp-client，
 *     serverName: gitnexus，command/args 由安装器替换 __FROZEN_NODE__ / __FROZEN_VENDOR__）；
 *  2. 插件启用时，会话第一步把「什么时候必须用图谱、先查再改」的约束注入模型历史。
 *     没有这段，MCP 工具只是躺在工具表里，模型大概率继续 grep + 逐个 Read；
 *  3. 插件启用且项目里没有 `.gitnexus/` 时，**自动在后台跑 `gitnexus analyze`** 建索引，
 *     并把「正在建索引」告诉模型；插件不启用则完全不动（连监听都不注册）。
 *
 * 设计约束（与 dsh-skill-trellis 一致）：
 *  - 只用 node: 内置模块，不 import 任何 @deepseek-ai/*（第三方插件目录解析不到宿主包）；
 *  - 任何异常都吞掉并降级，绝不阻断会话；
 *  - 同一会话只注入一次（按可见历史 + WeakMap 双重去重）；
 *  - 同一项目根每个进程只尝试建索引一次；
 *  - 关闭开关：DSH_CODE_INTEL_HOOKS=0 / DSH_GITNEXUS_GUIDE=0 / 配置 autoInit: false。
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveScope } from './scope.js';

const name = 'mcp-gitnexus';

/** 注入来源标记，用于恢复会话时判断「本会话已注入过」。 */
const SOURCE_KIND = 'gitnexus-usage-guidance';

const DEFAULT_MAX_CHARS = 6000;
const MAX_WALK_UP = 12;

/** 认为是「代码项目」的标记，命中任意一个才注入/建索引。 */
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

const GUIDANCE = `GitNexus MCP 已启用（工具以 \`mcp__gitnexus__\` 开头，随冻结版内置、离线可用）。

何时必须用它 —— 不要用 grep/Read 循环代替：
- 「这段代码怎么工作 / 架构是什么 / X 在哪」→ 先 \`query\`（自然语言，按执行流返回）或 \`context\`（精确符号的调用方/被调方/所属流程）。
- 「改这个符号会炸什么 / 谁在依赖它」→ 改之前必须跑 \`impact\`（direction: upstream），报告 risk、callers、processes；risk 为 HIGH/CRITICAL 要先说明，risk 为 UNKNOWN 不等于安全，必须补一次文本搜索确认。
- 「A 到 B 怎么连起来的」→ \`trace\`；「这条路由谁在用、返回结构对得上吗」→ \`route_map\` / \`shape_check\` / \`api_impact\`。
- 改完代码、提交前 → \`detect_changes\`（scope: all）；partial/truncated 不算干净通过。
- 要改名的符号 → 用 \`rename\`（理解调用图），不要 find-and-replace。

顺序：图谱定位 → 精确 Read → 修改 → impact/detect_changes 复验。
索引由插件自动维护：项目缺 \`.gitnexus/\` 时插件会在后台建；建索引期间可以先用 grep/Read，就绪后以图谱为准。`;

/* ────────────────────────── 基础设施 ────────────────────────── */

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
  return `<system-reminder>\nGitNexus guidance（dsh-mcp-gitnexus 自动注入；不是用户消息）。\n\n${escapeReminder(body)}\n</system-reminder>`;
}

function off(config) {
  const offSet = new Set(['0', 'false', 'off']);
  return config.enabled === false
    || offSet.has(String(process.env.DSH_CODE_INTEL_HOOKS ?? '').toLowerCase())
    || offSet.has(String(process.env.DSH_GITNEXUS_GUIDE ?? '').toLowerCase());
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

/** 从 cwd 向上找项目根：优先带 .git 的目录，其次带构建标记的目录。 */
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

/** 本进程已经尝试过建索引的项目根（小写）。 */
const indexAttempted = new Set();

function vendorDirOf(config) {
  return config.vendorDir ?? process.env.DSH_FROZEN_VENDOR ?? '';
}

function nodeOf(config) {
  return config.nodePath ?? process.env.DSH_FROZEN_NODE ?? 'node';
}

/**
 * 后台跑 `gitnexus analyze --index-only`，不阻塞会话。
 * @returns {{started: boolean, logPath?: string, reason?: string}}
 */
function startIndexing(config, root) {
  const vendor = vendorDirOf(config);
  if (!vendor) return { started: false, reason: 'no-vendor-dir' };
  const cli = join(vendor, 'gitnexus', 'dist', 'cli', 'index.js');
  if (!existsSync(cli)) return { started: false, reason: 'missing-cli' };

  const hash = createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 10);
  const logPath = join(tmpdir(), `dsh-gitnexus-index-${hash}.log`);

  let fd = -1;
  try {
    fd = openSync(logPath, 'a');
  } catch {
    fd = -1;
  }
  const stdio = fd >= 0 ? ['ignore', fd, fd] : 'ignore';

  const args = [cli, 'analyze', '--index-only', '--skip-agents-md', root];
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

/* ────────────────────────── 插件入口 ────────────────────────── */

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
      const scope = resolveScope(root, config, 'gitnexus');
      if (scope.enabled === false) {
        injected.set(agent.session, true);
        return decision;
      }

      let notice = '';
      const key = root.toLowerCase();
      if (scope.autoInit && !autoInitDisabled(config) && !isDir(join(root, '.gitnexus')) && !indexAttempted.has(key)) {
        indexAttempted.add(key);
        const started = startIndexing(config, root);
        if (started.started) {
          notice = `GitNexus 索引不存在：已在后台启动 \`gitnexus analyze\`（项目 ${root}，日志 ${started.logPath}）。本轮先按需 grep/Read；索引就绪后优先用 mcp__gitnexus__*。等索引完成再回答「谁调用 / 改动影响」这类问题。`;
        } else if (started.reason !== 'no-vendor-dir') {
          notice = `GitNexus 索引不存在，且后台建索引未能启动（${started.reason}）。需要时在项目根执行 \`gitnexus analyze\`，或先用 grep/Read。`;
        }
      }

      injected.set(agent.session, true);
      const scopeLine = `作用域：本工作区已启用（来源 ${scope.source}${scope.autoInit ? '' : '，autoInit=off'}）。`;
      const text = [scopeLine, notice, body].filter((part) => typeof part === 'string' && part.length > 0).join('\n\n');
      return { ...decision, messages: [...(decision.messages ?? []), createContextMessage(frameContext(text))] };
    } catch (error) {
      try {
        ctx.logger?.warn?.('gitnexus guidance injection failed: %o', error);
      } catch {
        /* ignore logger failures */
      }
      return decision;
    }
  }, { prepend: true });
}

export { apply, name };

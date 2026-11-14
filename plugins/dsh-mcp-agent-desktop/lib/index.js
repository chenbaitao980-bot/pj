/**
 * dsh-mcp-agent-desktop — agent-desktop（vercel-labs）MCP 的「使用约束注入」侧。
 *
 * 两件事：
 *  1. MCP 服务由同目录 `cordis.patch.yml` 注册（serverName: agent-desktop，
 *     命令是 `<vendor>/agent-desktop/bin/agent-desktop-win32-x64.exe mcp`）；
 *  2. 插件启用时，会话第一步注入「快照 → 引用 → 操作 → 再快照」的约束，
 *     并说明与内置 windows_computer_use_* 的分工。插件不启用则完全不动。
 *
 * 与 dsh-mcp-codegraph / dsh-mcp-gitnexus 同构：只用 node: 内置模块、异常吞掉、
 * 每会话一次；关闭开关 DSH_AGENT_DESKTOP_GUIDE=0 或 config.enabled=false。
 */
import { randomUUID } from 'node:crypto';

const name = 'mcp-agent-desktop';

const SOURCE_KIND = 'agent-desktop-usage-guidance';
const DEFAULT_MAX_CHARS = 4000;

const GUIDANCE = `agent-desktop MCP 已启用（工具：\`mcp__agent-desktop__desktop_*\`，随冻结版内置、离线可用）。

用法约定 —— 快照 → 引用 → 操作 → 再快照：
- \`desktop_snapshot\` 返回当前界面的可访问性树（JSON），可操作元素带引用；先用 \`--skeleton\` 看骨架，再用 \`--root\` 收窄。
- 用 \`desktop_click\` / \`desktop_type\` / \`desktop_set_value\` / \`desktop_press\` 等传引用操作。引用只对生成它的那次快照有效：界面一变就失效，报 stale / ambiguous-target 时重新 \`desktop_snapshot\`。
- 定位用 \`desktop_find\`；需要像素级确认时 \`desktop_screenshot\`；连续动作用 \`desktop_batch\`；等界面变化用 \`desktop_wait\`。
- 完整文档：\`desktop_skills_get\` 取 "desktop" / "platform" 技能。

与内置 \`windows_computer_use_*\` 的分工：优先 agent-desktop（结构化树、引用稳定、默认后台执行不抢焦点）；截图/OCR、托盘与系统对话框、或 desktop_* 不支持的操作再用 windows_computer_use_*。`;

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
  return `<system-reminder>\nagent-desktop guidance（dsh-mcp-agent-desktop 自动注入；不是用户消息）。\n\n${escapeReminder(body)}\n</system-reminder>`;
}

function off(config) {
  const offSet = new Set(['0', 'false', 'off']);
  return config.enabled === false
    || offSet.has(String(process.env.DSH_AGENT_DESKTOP_GUIDE ?? '').toLowerCase());
}

function clamp(text, maxChars) {
  const body = String(text ?? '').trim();
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars - 24)}…（已按上限截断）`;
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

function isSubagent(agent) {
  try {
    const meta = agent?.session?.meta ?? agent?.meta;
    if (meta === undefined || meta === null) return false;
    return meta.origin === 'subagent' || typeof meta.parentSession === 'string';
  } catch {
    return false;
  }
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

      injected.set(agent.session, true);
      return { ...decision, messages: [...(decision.messages ?? []), createContextMessage(frameContext(body))] };
    } catch (error) {
      try {
        ctx.logger?.warn?.('agent-desktop guidance injection failed: %o', error);
      } catch {
        /* ignore logger failures */
      }
      return decision;
    }
  }, { prepend: true });
}

export { apply, name };

/**
 * Host half of `@local/dsh-side-chat`.
 *
 * The Client half forks the on-screen Session into a side-chat Session and
 * renames it to `⧉ <parent-session-id> · <title>`. A fork copies the parent
 * history once, but the two Sessions then evolve independently. This host
 * half restores the Claude Code side-chat semantic: before every step in the
 * side Session, append the parent's newly committed events as one hidden
 * `side-chat-memory` user message. The side sees the main conversation; the
 * main never sees the side conversation (one-way, exactly like Claude Code).
 *
 * The injected message uses a non-`user` source kind, so the chat UI folds it
 * into a hidden context node while the model still receives it.
 */
import { randomUUID } from 'node:crypto';

export const name = 'dsh-side-chat';
export const inject = ['sessions', 'sessionTitle'];

const MEMORY_SOURCE = 'side-chat-memory';
const TITLE_MARK = '⧉ ';
const TITLE_SEPARATOR = ' · ';
const MEMORY_OPEN = '<side-chat-memory>';
const MEMORY_CLOSE = '</side-chat-memory>';
const MAX_MEMORY_CHARS = 16000;
const MAX_EVENT_CHARS = 4000;

/** parentId cache keyed by Session; invalidated when the title event seq moves. */
const PARENT_CACHE = new WeakMap();
/** Last parent seq already turned into a memory message (or deliberately skipped). */
const SYNC_CURSOR = new WeakMap();
/** Surface-replace ranges seen in a parent Session; refreshed as the parent grows. */
const REPLACE_CACHE = new WeakMap();

function parentIdFromTitle(title) {
  if (typeof title !== 'string' || !title.startsWith(TITLE_MARK)) return undefined;
  const rest = title.slice(TITLE_MARK.length);
  const cut = rest.indexOf(TITLE_SEPARATOR);
  if (cut <= 0) return undefined;
  return rest.slice(0, cut);
}

function parentIdOf(ctx, session) {
  let snapshot;
  try {
    snapshot = ctx.sessionTitle.get(session);
  } catch (error) {
    return undefined;
  }
  if (snapshot === undefined) return undefined;
  const cached = PARENT_CACHE.get(session);
  if (cached !== undefined && cached.eventSeq === snapshot.eventSeq) return cached.parentId;
  const parentId = parentIdFromTitle(snapshot.title);
  PARENT_CACHE.set(session, { eventSeq: snapshot.eventSeq, parentId });
  return parentId;
}

/**
 * Highest seq of `parentId` already represented in this side Session's log.
 * A side chat forked from another side chat inherits memory messages that
 * point at the original main Session; those must not move this chat's cursor.
 */
function lastSyncedSeq(session, parentId) {
  const start = typeof session.inheritedEventCount === 'number' ? session.inheritedEventCount : 0;
  let best = SYNC_CURSOR.get(session);
  if (best === undefined) best = start;
  let events;
  try {
    events = session.snapshotEvents(best);
  } catch (error) {
    return best;
  }
  if (!Array.isArray(events)) return best;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'user/message') continue;
    const data = event.data;
    if (data === undefined || data === null) continue;
    const source = data.source;
    if (source === undefined || source === null || source.kind !== MEMORY_SOURCE) continue;
    if (source.parentId !== parentId) continue;
    const to = source.parentTo;
    if (typeof to === 'number' && Number.isSafeInteger(to) && to >= 0 && to > best) best = to;
  }
  SYNC_CURSOR.set(session, best);
  return best;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function clip(text, max) {
  return text.length <= max ? text : text.slice(0, max) + '…[truncated]';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string') parts.push(block.text);
        break;
      case 'image':
        parts.push('[image]');
        break;
      case 'file':
        parts.push('[file ' + String(block.name ?? block.path ?? '') + ']');
        break;
      case 'tool-call':
        parts.push(
          '[tool call ' +
            String(block.toolName ?? block.name ?? '?') +
            '] ' +
            clip(safeJson(block.input ?? block.arguments ?? {}), 600),
        );
        break;
      case 'tool-result':
        parts.push('[tool result] ' + clip(textOf(block.content), 1000));
        break;
      default:
        if (typeof block.text === 'string') parts.push(block.text);
        else parts.push('[' + String(block.type ?? 'block') + ']');
    }
  }
  return parts.join('\n');
}

function renderEvent(event) {
  if (event.type === 'user/message') {
    const data = event.data;
    if (data === undefined || data === null) return undefined;
    const source = data.source;
    if (source === undefined || source === null || source.kind !== 'user') return undefined;
    const text = clip(textOf(data.content).trim(), MAX_EVENT_CHARS);
    return text === '' ? undefined : '[user]\n' + text;
  }
  if (event.type === 'assistant/message') {
    const message = event.data === undefined || event.data === null ? undefined : event.data.message;
    if (message === undefined) return undefined;
    const text = clip(textOf(message.content).trim(), MAX_EVENT_CHARS);
    return text === '' ? undefined : '[assistant]\n' + text;
  }
  if (event.type === 'tool/result') {
    const message = event.data === undefined || event.data === null ? undefined : event.data.message;
    if (message === undefined) return undefined;
    const text = clip(textOf(message.content).trim(), MAX_EVENT_CHARS);
    const label = message.isError === true ? '[tool error]' : '[tool result]';
    return text === '' ? label : label + '\n' + text;
  }
  return undefined;
}

/**
 * Surface replace ops hide earlier events from the model context. Collect
 * them so the memory bridge does not resurrect messages the main Session has
 * already folded away (for example after a compaction checkpoint).
 */
function replaceRanges(parent, to) {
  let cached = REPLACE_CACHE.get(parent);
  if (cached !== undefined && cached.to === to) return cached.ranges;
  if (cached !== undefined && cached.to > to) cached = undefined;
  const from = cached === undefined ? 0 : cached.to;
  let events;
  try {
    events = parent.snapshotEvents(from, to);
  } catch (error) {
    return cached === undefined ? [] : cached.ranges;
  }
  const ranges = cached === undefined ? [] : cached.ranges.slice();
  if (Array.isArray(events)) {
    for (const event of events) {
      const op = event.surfaceOp;
      if (op === undefined || op === null || typeof op !== 'object' || op.op !== 'replace') continue;
      const start = op.startSeq;
      const end = op.endSeq;
      if (typeof start !== 'number' || typeof end !== 'number') continue;
      ranges.push([start, end]);
    }
  }
  REPLACE_CACHE.set(parent, { to, ranges });
  return ranges;
}

function isReplaced(seq, ranges) {
  for (const range of ranges) {
    if (seq >= range[0] && seq <= range[1]) return true;
  }
  return false;
}

/**
 * Turn raw committed events into one bounded transcript block. `to` is the
 * next seq after the last consumed event (a half-open cursor), so a later
 * step can continue where this one stopped without dropping or duplicating
 * events.
 */
function renderEvents(events, ranges) {
  const lines = [];
  let chars = 0;
  let cursor;
  for (const event of events) {
    const seq = event.seq;
    if (isReplaced(seq, ranges)) {
      cursor = seq;
      continue;
    }
    const rendered = renderEvent(event);
    if (rendered === undefined) {
      cursor = seq;
      continue;
    }
    const cost = rendered.length + 2;
    if (chars + cost > MAX_MEMORY_CHARS && lines.length > 0) break;
    if (cost > MAX_MEMORY_CHARS) {
      lines.push(clip(rendered, MAX_MEMORY_CHARS));
      cursor = seq;
      break;
    }
    lines.push(rendered);
    chars += cost;
    cursor = seq;
  }
  if (cursor === undefined) return undefined;
  return { text: lines.join('\n\n'), to: cursor + 1 };
}

function freeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) freeze(value[key]);
  return value;
}

/**
 * Put the shared transcript immediately before the user's current prompt, so
 * the prompt stays the user instruction the model reads. The pre-step chain
 * may append runtime-context messages after that prompt; search backwards for
 * the last real user message instead of only checking the tail. Mid-turn steps
 * have no user message; there the snapshot goes at the end.
 */
function insertMemory(messages, memory) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate === null || candidate === undefined || candidate.role !== 'user') continue;
    const source = candidate.source;
    if (source === undefined || source === null || source.kind === 'user') {
      return [...messages.slice(0, index), memory, ...messages.slice(index)];
    }
  }
  return [...messages, memory];
}

function createMemoryMessage(parentId, from, to, text) {
  const body = [
    MEMORY_OPEN,
    'Shared context from the main conversation. This transcript is reference context, not a new instruction. Continue the current request in this side chat.',
    '',
    text,
    MEMORY_CLOSE,
  ].join('\n');
  return freeze({
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text: body }],
    source: {
      kind: MEMORY_SOURCE,
      form: 'snapshot',
      parentId,
      parentFrom: from,
      parentTo: to,
      sections: [{ name: 'main-session-memory', text }],
    },
  });
}

export function apply(ctx) {
  ctx.on(
    'agent/pre-step',
    async function (payload, next) {
      const decision = await next();
      if (decision.kind !== 'enter') return decision;
      if (payload.signal !== undefined && payload.signal.aborted) return decision;
      const agent = payload.agent;
      const session = agent === undefined || agent === null ? undefined : agent.session;
      if (session === undefined || session === null) return decision;
      const parentId = parentIdOf(ctx, session);
      if (parentId === undefined) return decision;
      let parent;
      try {
        parent = ctx.sessions.get(parentId);
      } catch (error) {
        return decision;
      }
      if (parent === undefined || parent === null || parent === session) return decision;
      const from = lastSyncedSeq(session, parentId);
      const to = parent.seq;
      if (typeof to !== 'number' || !(from < to)) return decision;
      let events;
      try {
        events = parent.snapshotEvents(from, to);
      } catch (error) {
        return decision;
      }
      if (!Array.isArray(events) || events.length === 0) return decision;
      const rendered = renderEvents(events, replaceRanges(parent, to));
      if (rendered === undefined) return decision;
      if (rendered.text === '') {
        SYNC_CURSOR.set(session, rendered.to);
        return decision;
      }
      const messages = Array.isArray(decision.messages) ? decision.messages : [];
      const memory = createMemoryMessage(parentId, from, rendered.to, rendered.text);
      return {
        ...decision,
        messages: insertMemory(messages, memory),
      };
    },
    { prepend: true },
  );
}

/**
 * Host half of `@local/dsh-todo-nudge` — the task guardian (任务守护).
 *
 * The task board renders each Session's `todos` projection. Models often skip
 * `todo_write` or write a list once and never touch it again, so the board
 * used to freeze on the turn's prompt. The guardian is a small auxiliary
 * model that watches every agent's real work (main Session and each Subagent,
 * independently) and keeps the list honest:
 *
 *   1. Rule      — a system-prompt section asks the model to keep its own list.
 *   2. Plan      — when the model writes none, the request is split into real
 *                  tasks shortly after the turn starts (placeholder first).
 *   3. Audit     — while the turn runs, the guardian re-reads recent tool calls
 *                  and narration and updates statuses, adds/drops/splits tasks;
 *                  a user message added mid-turn is merged immediately. A list
 *                  the model owns only gets status corrections, and only when
 *                  the model let it go stale.
 *   4. Final     — when a turn completes, every open row gets a verdict: done
 *                  (completed), dropped (speculative follow-up, removed) or
 *                  still open. Nothing is left "pending" by accident.
 *   5. Enforce   — open rows that the agent simply abandoned (not waiting on
 *                  the user) queue one visible 「【任务守护】」 continuation
 *                  per user request in a top-level Session.
 *
 * The guardian's writes carry `by: 'task-guardian'` so ownership never depends
 * on object identity (the Session snapshots event data on append). A
 * `taskGuardian` projection derived from the event log feeds the board the
 * agent's live activity and the audit verdict — no extra events are written.
 *
 * Planning and audits are direct `llm` calls on the session's own model: no
 * Session is created, nothing enters the main agent's context. Set
 * `DSH_TASK_GUARDIAN_CONTINUE=0` to turn off the automatic continuation.
 */
export const name = 'dsh-todo-nudge'

export const inject = ['systemPrompt', 'tools', 'sessionProjections', 'agents', 'llm']

import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Diagnostic log: one line per guardian decision, truncated on apply and when large. */
const LOG_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'todo-nudge.log')
const LOG_MAX_BYTES = 512 * 1024
let logChecks = 0
const trace = (line) => {
  try {
    logChecks += 1
    if (logChecks % 200 === 0 && statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      writeFileSync(LOG_FILE, `[${new Date().toISOString()}] log rotated\n`)
    }
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`)
  } catch {}
}
const errorText = (error) => String(error && error.message ? error.message : error)

const ORDER = 8600

const TEXT = [
  '只要这一轮需要执行动作（调用任何工具、改文件、跑命令，哪怕只有一个步骤），就必须先调用 `todo_write` 建立任务清单：',
  '至少一条、写清这一轮要做什么，并把当前项设为 `in_progress`。',
  '每完成一个动作立即更新清单：完成的改成 `completed`，新增的补上，下一步设为 `in_progress`；不要等全部做完才写。',
  '清单实时显示在输入框上方的「任务」面板里，用户靠它看进度，所以状态必须真实、及时；',
  '任务守护会对照你的实际动作审计清单，回合结束时仍未完成的条目会被追问。',
  '只有完全不调用工具的一句话问答才不建清单。',
].join('')

/** Marker on every list the guardian writes. */
const GUARD_TAG = 'task-guardian'
/** Label prefix of the placeholder row written before the plan lands. */
const AUTO_PREFIX = '本轮：'
const AUTO_MAX = 60
const MAX_TASKS = 8
const TASK_MAX_CHARS = 60

/** Plan shortly after the request lands, unless the model writes its own list first. */
const PLAN_DELAY_MS = 1200
/** A turn without a user message (continuation) gets its board after this wait. */
const TURN_INPUT_WAIT_MS = 1500
/** Progress audit cadence on a guardian-owned list. */
const AUDIT_EVERY_CALLS = 4
const AUDIT_MIN_INTERVAL_MS = 15000
/** Retry cadence while only the placeholder is on the board (the plan failed). */
const RETRY_EVERY_CALLS = 1
const RETRY_MIN_INTERVAL_MS = 6000
/** A model-owned list is "stale" after this many tool calls without a rewrite. */
const STALE_MODEL_CALLS = 6
const ACTIVITY_KEEP = 24
const ACTIVITY_FOR_AUDIT = 16
const REQUEST_MAX = 800
const REPLY_MAX = 1500
const TIMEOUT_MS = { progress: 15000, status: 15000, final: 20000 }
const MAX_TOKENS = { progress: 700, status: 300, final: 400 }
/**
 * Automatic continuations per user request, top-level Sessions only. A turn
 * that ends must leave only completed rows: open rows either drive another
 * continuation or leave the board and are named in the audit footer.
 */
const CONTINUE_MAX = 2
const SETTLED_LIST_MAX = 5
const CONTINUE_PREFIX = '【任务守护】'
const continueEnabled = () => process.env.DSH_TASK_GUARDIAN_CONTINUE !== '0'

const GUARD_SYSTEM = [
  '你是任务守护子智能体，负责维护主智能体这一轮的任务清单，只输出 JSON。',
  '输入包含：本轮用户请求、用户中途追加的要求、当前清单（序号/状态/内容）、主智能体最近的实际动作（「做：」是工具调用，「说：」是它对用户说的话）。',
  '规则：1. 已经做完的标 completed；主智能体此刻正在做的那一条标 in_progress（有且只有一条）；还没开始的标 pending。',
  '2. 清单必须反映真实进展：出现了新的工作就补上，原计划里已不需要的 pending 项删除，过于笼统的拆成具体步骤；已 completed 的条目保持原文。',
  '3. 还没有实际动作时，按请求规划 1~5 条，第一条 in_progress。',
  '4. 不要编造用户没要求的后续工作；最多 8 条，每条不超过 30 个汉字，写具体动作（如「读取 D2.java 确认识别器参数」），不要写「本轮：」前缀。',
  '只输出 JSON 数组：[{"content":"…","status":"completed|in_progress|pending"}]，不要解释，不要 Markdown 代码块。',
].join('')

const STATUS_SYSTEM = [
  '你是任务守护子智能体，只输出 JSON。主智能体自己写了任务清单，但已经一段时间没更新。',
  '根据它最近的实际动作，判断清单里每一条现在的状态：已经做完的 completed；此刻正在做的 in_progress（最多一条）；还没开始的 pending；不能确定就保持原状态。',
  '不要增删或改写条目。只输出 JSON：{"statuses":["completed","in_progress","pending"]}，数组长度必须等于清单条数。',
].join('')

const FINAL_SYSTEM = [
  '你是任务守护子智能体，在主智能体结束这一轮后审计任务清单，只输出 JSON。',
  '输入包含：用户请求、清单（序号/状态/内容）、主智能体的实际动作和最终回复。对每一条给出结论：',
  '"done" = 这一轮已经实际完成：动作或最终回复里有证据。汇报、说明、总结、检查、核对类任务，只要最终回复里给出了结果就是 done；',
  '回复结尾顺带问用户「还要不要继续/有没有新想法」不代表任务没做完。',
  '"drop" = 不是用户这一轮要求的、只是预想的后续工作，或已不再需要；',
  '"wait" = 必须等用户回答/选择/提供信息后才能做（回复里明确在等用户），这一轮无法继续；',
  '"open" = 用户这一轮明确要求、不需要等用户、却确实没有动手或中途放弃的任务。拿不准时按证据判断，不要因为谨慎而判 open。',
  '只输出 JSON：{"verdicts":["done","drop","wait","open"],"reason":"一句话说明 wait/open 的原因，没有则为空"}，verdicts 长度必须等于清单条数。',
].join('')

/** Text blocks of one message (reasoning excluded), joined, or ''. */
const textOfMessage = (message) => {
  const content = message === null || message === undefined ? undefined : message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join(' ')
    .trim()
}

const oneLine = (text, max) => String(text).replace(/\s+/gu, ' ').trim().slice(0, max)

// ------------------------------------------------------------------ activity

const TOOL_LABELS = {
  pwsh: '运行命令', powershell: '运行命令', bash: '运行命令', shell: '运行命令', exec: '运行命令',
  read: '读取', read_file: '读取', write: '写入', write_file: '写入', edit: '修改', multi_edit: '修改', apply_patch: '修改',
  glob: '查找文件', ls: '列目录', list_directory: '列目录', grep: '搜索', search: '搜索',
  web_search: '联网搜索', web_search_meta: '联网搜索', web_fetch: '抓取网页',
  job_output: '等待后台任务', job_kill: '结束后台任务',
  subagent: '派发子智能体', spawn_agent: '派发子智能体', wait_agent: '等待子智能体', send_message: '联系子智能体',
  ask_user: '询问用户', ask_user_question: '询问用户',
}

const baseName = (value) => {
  const parts = String(value).split(/[\\/]/u).filter((part) => part !== '')
  return parts.length === 0 ? String(value) : parts[parts.length - 1]
}

const argsOf = (raw) => {
  if (raw !== null && typeof raw === 'object') return raw
  if (typeof raw !== 'string' || raw === '') return {}
  if (raw.length <= 20000) {
    try {
      const parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {}
  }
  // Huge payloads (file writes): pull the fields that name the action.
  const pick = {}
  for (const key of ['description', 'file_path', 'path', 'command', 'pattern', 'query', 'url']) {
    const match = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.){0,300})', 'u').exec(raw)
    if (match !== null) {
      try { pick[key] = JSON.parse('"' + match[1] + '"') } catch { pick[key] = match[1] }
    }
  }
  return pick
}

/** One readable line for a tool call: "运行命令 · 列出工作目录内容". */
const describeCall = (name, rawArgs) => {
  const tool = typeof name === 'string' && name !== '' ? name : 'tool'
  const label = Object.hasOwn(TOOL_LABELS, tool) ? TOOL_LABELS[tool] : tool
  const args = argsOf(rawArgs)
  const str = (key) => (typeof args[key] === 'string' && args[key].trim() !== '' ? args[key].trim() : undefined)
  let detail = str('description')
  if (detail === undefined) {
    const file = str('file_path') ?? str('path') ?? str('notebook_path')
    if (file !== undefined) detail = baseName(file)
  }
  if (detail === undefined) {
    const command = str('command') ?? str('cmd')
    if (command !== undefined) detail = command.split(/\r?\n/u).map((line) => line.trim()).find((line) => line !== '') ?? command
  }
  if (detail === undefined) detail = str('query') ?? str('pattern') ?? str('url') ?? str('prompt') ?? str('title') ?? str('reason')
  return oneLine(detail === undefined ? label : label + ' · ' + detail, 90)
}

// ---------------------------------------------------------------- projection

const VIEW_INIT = Object.freeze({
  running: false,
  turn: null,
  activity: null,
  say: null,
  at: null,
  calls: 0,
  audits: 0,
  auditAt: null,
  endedAt: null,
  endReason: null,
  final: null,
  writer: null,
})

const numOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const strOrNull = (value, max) => (typeof value === 'string' && value !== '' ? value.slice(0, max) : null)

const normalizeFinal = (value) => {
  if (value === null || typeof value !== 'object') return null
  const count = (key) => (typeof value[key] === 'number' && Number.isFinite(value[key]) ? Math.max(0, Math.floor(value[key])) : 0)
  const names = (key) => (Array.isArray(value[key])
    ? value[key].filter((item) => typeof item === 'string' && item !== '').slice(0, SETTLED_LIST_MAX).map((item) => item.slice(0, TASK_MAX_CHARS))
    : [])
  return {
    done: count('done'),
    open: count('open'),
    dropped: count('dropped'),
    deferred: names('deferred'),
    unfinished: names('unfinished'),
    continuedCount: count('continuedCount'),
    waitingUser: value.waitingUser === true,
    continued: value.continued === true,
    fallback: value.fallback === true,
    reason: strOrNull(value.reason, 200) ?? '',
  }
}

/** Lenient schema: projection rows restored from cache are re-normalized, never rejected. */
const viewSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object') return VIEW_INIT
    return {
      running: value.running === true,
      turn: numOrNull(value.turn),
      activity: strOrNull(value.activity, 120),
      say: strOrNull(value.say, 160),
      at: numOrNull(value.at),
      calls: typeof value.calls === 'number' && Number.isFinite(value.calls) ? value.calls : 0,
      audits: typeof value.audits === 'number' && Number.isFinite(value.audits) ? value.audits : 0,
      auditAt: numOrNull(value.auditAt),
      endedAt: numOrNull(value.endedAt),
      endReason: strOrNull(value.endReason, 40),
      final: normalizeFinal(value.final),
      writer: value.writer === 'model' || value.writer === 'guardian' ? value.writer : null,
    }
  },
}

/** Fold one event into the board-facing guardian view; unchanged events keep the same object. */
const foldView = (state, event) => {
  if (event === null || typeof event !== 'object') return state
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  const time = typeof event.time === 'number' ? event.time : null
  switch (event.type) {
    case 'turn/start':
      return { ...VIEW_INIT, running: true, turn: numOrNull(data.turn), at: time }
    case 'tool/call': {
      if (data.name === 'todo_write') return state
      return { ...state, running: true, activity: describeCall(data.name, data.arguments), at: time, calls: state.calls + 1 }
    }
    case 'assistant/message': {
      const text = textOfMessage(data.message)
      if (text === '') return state
      return { ...state, say: oneLine(text, 160) }
    }
    case 'todo/write': {
      const writer = data.by === GUARD_TAG ? 'guardian' : 'model'
      if (data.by !== GUARD_TAG) {
        // Pre-tag placeholders from an older guardian are not the model's.
        const todos = Array.isArray(data.todos) ? data.todos : null
        if (isFallbackList(todos)) return state
        return state.writer === writer ? state : { ...state, writer }
      }
      const final = data.audit === undefined ? state.final : normalizeFinal(data.audit)
      return { ...state, audits: state.audits + 1, auditAt: time, final, writer }
    }
    case 'turn/end': {
      const reason = data.reason !== null && typeof data.reason === 'object' && typeof data.reason.kind === 'string' ? data.reason.kind : null
      return { ...state, running: false, activity: null, endedAt: time, endReason: reason }
    }
    default:
      return state
  }
}

// --------------------------------------------------------------------- lists

const isTodo = (item) => item !== null && typeof item === 'object' && typeof item.content === 'string'
const isOpen = (item) => isTodo(item) && item.status !== 'completed'
const signature = (list) => (Array.isArray(list) ? JSON.stringify(list.map((item) => (isTodo(item) ? [item.content, item.status] : null))) : 'null')

/** True when the list is the guardian's single placeholder row. */
const isFallbackList = (list) => Array.isArray(list) && list.length === 1 && isTodo(list[0]) && list[0].content.startsWith(AUTO_PREFIX)

const labelOf = (text) => oneLine(AUTO_PREFIX + (typeof text === 'string' && text.trim() !== '' ? text : '任务'), AUTO_MAX)

const statusOf = (value) => (value === 'completed' ? 'completed' : value === 'in_progress' ? 'in_progress' : 'pending')

const jsonSlice = (text, open, close) => {
  if (typeof text !== 'string') return undefined
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Canonical guardian list: trimmed unique content, at most MAX_TASKS rows,
 * exactly one `in_progress` while anything is open, and every row the base
 * list already completed is kept (an audit may not un-finish work). Over the
 * cap, settled rows are retired before open work: completed rows the audit no
 * longer lists go first, then the oldest completed rows (front of the list),
 * pending rows only once nothing completed is left. A board full of finished
 * rows must never push the audit's new items off the list.
 */
const normalizeList = (raw, base) => {
  if (!Array.isArray(raw)) return undefined
  const todos = []
  const seen = new Set()
  for (const item of raw) {
    if (!isTodo(item)) continue
    let content = item.content.trim()
    if (content.startsWith(AUTO_PREFIX)) content = content.slice(AUTO_PREFIX.length).trim()
    content = content.slice(0, TASK_MAX_CHARS)
    if (content === '' || seen.has(content)) continue
    seen.add(content)
    todos.push({ content, status: statusOf(item.status) })
  }
  const fromAudit = new Set(todos.map((item) => item.content))
  if (Array.isArray(base)) {
    const kept = base.filter((item) => isTodo(item) && item.status === 'completed' && !item.content.startsWith(AUTO_PREFIX) && !seen.has(item.content))
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      seen.add(kept[index].content)
      todos.unshift({ content: kept[index].content, status: 'completed' })
    }
  }
  while (todos.length > MAX_TASKS) {
    const stale = todos.findIndex((item) => item.status === 'completed' && !fromAudit.has(item.content))
    const done = stale >= 0 ? stale : todos.findIndex((item) => item.status === 'completed')
    if (done >= 0) {
      todos.splice(done, 1)
      continue
    }
    const drop = todos.findLastIndex((item) => item.status === 'pending')
    todos.splice(drop >= 0 ? drop : todos.length - 1, 1)
  }
  if (todos.length === 0) return undefined
  let active = false
  for (let index = 0; index < todos.length; index += 1) {
    if (todos[index].status !== 'in_progress') continue
    if (active) todos[index] = { ...todos[index], status: 'pending' }
    active = true
  }
  if (!active) {
    const next = todos.findIndex((item) => item.status === 'pending')
    if (next >= 0) todos[next] = { ...todos[next], status: 'in_progress' }
  }
  return todos
}

const listText = (list) => (Array.isArray(list) && list.length > 0
  ? list.filter(isTodo).map((item, index) => `${index + 1}. [${item.status}] ${item.content}`).join('\n')
  : '（空）')

// --------------------------------------------------------------------- apply

export function apply(ctx) {
  try {
    writeFileSync(LOG_FILE, `[${new Date().toISOString()}] applied (task guardian)\n`)
  } catch {}

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'todo:nudge',
        order: ORDER,
        text: ({ scope, toolSet }) => (ctx.tools.get('todo_write', scope, toolSet) === undefined ? '' : TEXT),
      }),
    'todo-nudge: section',
  )

  // Board-facing view of the guardian; derived from the log, writes nothing.
  if (ctx.sessionProjections !== undefined && typeof ctx.sessionProjections.register === 'function') {
    try {
      const registration = ctx.sessionProjections.register({
        key: 'taskGuardian',
        stateSchema: viewSchema,
        init: () => VIEW_INIT,
        apply: foldView,
        wire: { viewSchema, view: (state) => state, summary: false },
        stateVersion: 2,
      })
      if (registration !== undefined && typeof registration.catch === 'function') {
        registration.catch((error) => trace('projection register failed: ' + errorText(error)))
      }
    } catch (error) {
      trace('projection register threw: ' + errorText(error))
    }
  }

  /** Per-session guardian state; every agent (including each Subagent) is independent. */
  const states = new Map()
  const STATE_IDLE_TTL_MS = 2 * 60 * 60 * 1000
  const prune = () => {
    const now = Date.now()
    for (const [id, state] of states) {
      if (state.phase !== 'running' && state.auditing === null && now - state.touched > STATE_IDLE_TTL_MS) states.delete(id)
    }
  }
  const stateOf = (session) => {
    const id = session === undefined || session === null ? undefined : session.id
    if (typeof id !== 'string') return undefined
    let state = states.get(id)
    if (state !== undefined) {
      state.touched = Date.now()
    } else {
      state = {
        turn: undefined,
        phase: 'idle',
        auto: false,
        owner: 'none',
        request: '',
        steers: [],
        msgSeen: false,
        list: null,
        activity: [],
        lastReply: '',
        callsTotal: 0,
        callsAtAudit: 0,
        callsAtModelWrite: 0,
        auditAt: 0,
        auditing: null,
        auditQueued: false,
        timer: undefined,
        continued: 0,
        guardMessages: new Set(),
        touched: Date.now(),
      }
      states.set(id, state)
    }
    return state
  }

  const agentOf = (session) => (typeof ctx.agents?.get === 'function' ? ctx.agents.get(session.id) : undefined)
  const depthOf = (session) => {
    try {
      const depth = session.header === undefined ? undefined : session.header.delegationDepth
      return typeof depth === 'number' ? depth : 0
    } catch {
      return 0
    }
  }

  const readTodos = (session) => {
    try {
      const snapshot = ctx.sessionProjections === undefined ? undefined : ctx.sessionProjections.snapshot(session)
      return snapshot === null || snapshot === undefined ? undefined : snapshot.values.todos
    } catch (error) {
      trace('read failed: ' + errorText(error))
      return undefined
    }
  }

  /** Last todo list writer as tagged in the event log (`by: 'task-guardian'`), when known. */
  const readWriter = (session) => {
    try {
      const snapshot = ctx.sessionProjections === undefined ? undefined : ctx.sessionProjections.snapshot(session)
      const view = snapshot === null || snapshot === undefined ? undefined : snapshot.values.taskGuardian
      return view !== null && typeof view === 'object' && (view.writer === 'model' || view.writer === 'guardian') ? view.writer : undefined
    } catch {
      return undefined
    }
  }

  const currentList = (session, state) => {
    const projected = readTodos(session)
    if (Array.isArray(projected)) return projected
    return Array.isArray(state.list) ? state.list : undefined
  }

  const remember = (state, kind, text) => {
    if (typeof text !== 'string' || text.trim() === '') return
    state.activity.push({ kind, text: oneLine(text, 140) })
    if (state.activity.length > ACTIVITY_KEEP) state.activity.splice(0, state.activity.length - ACTIVITY_KEEP)
  }

  const abortAudit = (state) => {
    if (state.auditing !== null) {
      try { state.auditing.abort() } catch {}
      state.auditing = null
    }
    state.auditQueued = false
  }

  /**
   * Append one guardian `todo/write` outside the current event publication.
   * `build` runs at fire time and may decline by returning undefined; transient
   * reentrancy rejections retry with backoff.
   */
  const publish = (session, build, onWrote, attempt) => {
    const attemptNo = typeof attempt === 'number' ? attempt : 0
    setTimeout(() => {
      let payload
      try {
        payload = build()
      } catch (error) {
        trace('build failed: ' + errorText(error))
        return
      }
      if (payload === undefined) return
      const data = Array.isArray(payload) ? { todos: payload } : payload
      try {
        session.append('todo/write', { ...data, by: GUARD_TAG })
        if (typeof onWrote === 'function') onWrote(data.todos)
      } catch (error) {
        if (attemptNo < 8) {
          publish(session, build, onWrote, attemptNo + 1)
          return
        }
        trace('append failed: ' + errorText(error))
      }
    }, attemptNo === 0 ? 120 : 40 * attemptNo)
  }

  // ---------------------------------------------------------- model calls

  /**
   * The session's own route. Planning and audits deliberately use the main
   * model: a catalog "fast" pick is chosen by name alone, can land on another
   * model family with a different API adapter, and a route that answers with
   * no text leaves every audit — and the whole board — blind for the turn.
   * One main-model call per audit is the price of a board that never freezes.
   */
  const routesFor = (agent) => {
    const selected = typeof agent.model?.current === 'function' ? agent.model.current() : undefined
    const options = agent.options
    const main = selected !== undefined && selected !== null && typeof selected.provider === 'string' && typeof selected.model === 'string'
      ? { provider: selected.provider, model: selected.model }
      : options !== undefined && typeof options.provider === 'string' && typeof options.model === 'string'
        ? { provider: options.provider, model: options.model }
        : undefined
    return main === undefined ? [] : [main]
  }

  const callModel = async (agent, route, system, text, signal, kind) => {
    const callSignal = typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS[kind])])
      : signal
    const call = await ctx.llm.prepareCall({ ...route, maxTokens: MAX_TOKENS[kind] }, callSignal, (controls, model) => {
      // Lowest reasoning effort the model offers (the title generator does the same).
      const efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : []
      const effort = efforts.length > 0 && efforts[0] && typeof efforts[0].id === 'string' ? efforts[0].id : undefined
      return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
    })
    const messages = [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'dsh-todo-nudge' } }]
    let output = ''
    let finish = null
    for await (const chunk of call.stream({ ...call.config, messages, system, sessionId: agent.session.id, purpose: 'todo-plan', signal: callSignal })) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        output += chunk.text
      } else if (chunk.type === 'finish') {
        const reason = chunk.reason
        if (reason !== null && typeof reason === 'object' && typeof reason.kind === 'string') {
          const message = reason.failure !== null && typeof reason.failure === 'object' && typeof reason.failure.message === 'string'
            ? ': ' + oneLine(reason.failure.message, 100)
            : ''
          finish = reason.kind + message
        }
      }
    }
    return { text: output, finish }
  }

  /**
   * Ask the session's model once. A failed call leaves the board untouched; the
   * trace records why (parse failure, empty text, or the stream's finish kind).
   */
  const ask = async (agent, kind, system, text, signal, accept) => {
    if (typeof ctx.llm?.prepareCall !== 'function') return undefined
    const routes = await routesFor(agent)
    for (const route of routes) {
      if (signal.aborted) return undefined
      const started = Date.now()
      try {
        const result = await callModel(agent, route, system, text, signal, kind)
        const value = accept(result.text)
        const outcome = value !== undefined
          ? 'ok'
          : result.text === '' ? 'empty finish=' + String(result.finish) : 'unparsed ' + oneLine(result.text, 100)
        trace(kind + ' ' + agent.id + ' via ' + route.model + ' ' + (Date.now() - started) + 'ms: ' + outcome)
        if (value !== undefined) return value
      } catch (error) {
        if (signal.aborted) return undefined
        trace(kind + ' ' + agent.id + ' via ' + route.model + ' failed after ' + (Date.now() - started) + 'ms: ' + errorText(error))
      }
    }
    return undefined
  }

  const requestText = (state) => {
    const parts = ['本轮用户请求：' + (state.request.trim() === '' ? '（无文字，延续上一轮）' : state.request.trim().slice(0, REQUEST_MAX))]
    if (state.steers.length > 0) parts.push('用户中途追加：\n' + state.steers.map((text) => '- ' + oneLine(text, 300)).join('\n'))
    return parts.join('\n')
  }

  const activityText = (state) => {
    const recent = state.activity.slice(-ACTIVITY_FOR_AUDIT)
    return recent.length === 0
      ? '（还没有实际动作）'
      : recent.map((entry) => (entry.kind === 'say' ? '说：' : '做：') + entry.text).join('\n')
  }

  // --------------------------------------------------------------- audits

  /** Guardian-owned list: re-plan from the real activity (also serves as the initial plan). */
  const runProgressAudit = async (session, state, agent) => {
    const turn = state.turn
    const base = currentList(session, state)
    const controller = new AbortController()
    state.auditing = controller
    state.auditAt = Date.now()
    const callsAtStart = state.callsTotal
    const placeholder = !Array.isArray(base) || base.length === 0 || isFallbackList(base)
    const input = [
      requestText(state),
      '当前清单：\n' + listText(placeholder ? [] : base),
      '主智能体最近的实际动作：\n' + activityText(state),
    ].join('\n\n')
    try {
      const todos = await ask(agent, 'progress', GUARD_SYSTEM, input, controller.signal,
        (output) => normalizeList(jsonSlice(output, '[', ']'), placeholder ? undefined : base))
      if (controller.signal.aborted || state.turn !== turn || state.phase !== 'running' || state.owner === 'model' || todos === undefined) return
      state.callsAtAudit = callsAtStart
      publish(session, () => {
        if (state.turn !== turn || state.phase !== 'running' || state.owner === 'model') return undefined
        if (signature(readTodos(session)) === signature(todos)) return undefined
        return todos
      }, (list) => {
        state.list = list
        if (state.owner === 'none') state.owner = 'guardian'
        trace('progress ' + session.id + ': ' + list.map((item) => item.status[0]).join(''))
      })
    } finally {
      if (state.auditing === controller) state.auditing = null
      if (state.auditQueued) {
        state.auditQueued = false
        maybeAudit(session, state, true)
      }
    }
  }

  /** Model-owned list that went stale: correct statuses only, never content. */
  const runStatusAudit = async (session, state, agent) => {
    const turn = state.turn
    const base = currentList(session, state)
    if (!Array.isArray(base) || base.length === 0) return
    const baseSig = signature(base)
    const controller = new AbortController()
    state.auditing = controller
    state.auditAt = Date.now()
    const callsAtStart = state.callsTotal
    const input = [requestText(state), '当前清单：\n' + listText(base), '主智能体最近的实际动作：\n' + activityText(state)].join('\n\n')
    try {
      const statuses = await ask(agent, 'status', STATUS_SYSTEM, input, controller.signal, (output) => {
        const value = jsonSlice(output, '{', '}')
        const list = value !== undefined && value !== null && Array.isArray(value.statuses) ? value.statuses : undefined
        return list !== undefined && list.length === base.length ? list.map(statusOf) : undefined
      })
      if (controller.signal.aborted || state.turn !== turn || state.phase !== 'running' || statuses === undefined) return
      state.callsAtAudit = callsAtStart
      let active = false
      const todos = base.map((item, index) => {
        let status = statuses[index]
        if (status === 'in_progress') {
          if (active) status = 'pending'
          active = true
        }
        return { content: item.content, status }
      })
      if (signature(todos) === baseSig) return
      publish(session, () => {
        if (state.turn !== turn || state.phase !== 'running') return undefined
        if (signature(readTodos(session)) !== baseSig) return undefined
        return todos
      }, (list) => {
        state.list = list
        trace('status ' + session.id + ': ' + list.map((item) => item.status[0]).join(''))
      })
    } finally {
      if (state.auditing === controller) state.auditing = null
      if (state.auditQueued) {
        state.auditQueued = false
        maybeAudit(session, state, true)
      }
    }
  }

  /** Decide whether this step boundary deserves an audit. */
  const maybeAudit = (session, state, force) => {
    if (!state.auto || state.turn === undefined || state.phase !== 'running') return
    if (state.auditing !== null) {
      if (force) state.auditQueued = true
      return
    }
    const agent = agentOf(session)
    if (agent === undefined) return
    const now = Date.now()
    const fresh = state.callsTotal - state.callsAtAudit
    if (state.owner === 'model') {
      const stale = state.callsTotal - state.callsAtModelWrite
      if (stale < STALE_MODEL_CALLS || fresh < STALE_MODEL_CALLS) return
      if (now - state.auditAt < AUDIT_MIN_INTERVAL_MS) return
      void runStatusAudit(session, state, agent).catch((error) => trace('status audit error: ' + errorText(error)))
      return
    }
    if (!force) {
      const list = currentList(session, state)
      const placeholder = !Array.isArray(list) || list.length === 0 || isFallbackList(list)
      const minCalls = placeholder ? RETRY_EVERY_CALLS : AUDIT_EVERY_CALLS
      const minInterval = placeholder ? RETRY_MIN_INTERVAL_MS : AUDIT_MIN_INTERVAL_MS
      if (fresh < minCalls || now - state.auditAt < minInterval) return
    }
    void runProgressAudit(session, state, agent).catch((error) => trace('progress audit error: ' + errorText(error)))
  }

  /** Queue the visible continuation that holds the agent to its open rows. */
  const queueContinuation = (session, state, open) => {
    const agent = agentOf(session)
    if (agent === undefined || typeof agent.followup !== 'function') return false
    const text = [
      CONTINUE_PREFIX + '本轮任务清单还有 ' + open.length + ' 项未完成：',
      ...open.map((item, index) => `${index + 1}. ${item.content}`),
      '请继续完成这些任务，并用 todo_write 实时更新清单；如果某项不需要或无法完成，请说明原因并在清单里如实标注。',
    ].join('\n')
    const message = { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
    try {
      state.guardMessages.add(message.id)
      agent.followup(message)
      state.continued += 1
      trace('continue ' + session.id + ': ' + open.length + ' open row(s)')
      return true
    } catch (error) {
      state.guardMessages.delete(message.id)
      trace('continue failed ' + session.id + ': ' + errorText(error))
      return false
    }
  }

  /** Turn completed: settle every open row and, if work was abandoned, enforce. */
  const runFinalAudit = async (session, state, turn) => {
    const base = currentList(session, state)
    if (!Array.isArray(base) || base.length === 0) return
    const rows = base.filter(isTodo)
    if (!rows.some(isOpen)) return
    const stillEnded = () => state.turn === turn && state.phase === 'ended'
    const baseSig = signature(base)
    const write = (todos, audit, after) => {
      publish(session, () => {
        if (!stillEnded()) return undefined
        const now = readTodos(session)
        if (signature(Array.isArray(now) ? now : state.list) !== baseSig) return undefined
        return { todos, audit }
      }, (list) => {
        state.list = list
        trace('final ' + session.id + ': done=' + audit.done + ' open=' + audit.open + ' dropped=' + audit.dropped +
          ' deferred=' + audit.deferred.length + ' unfinished=' + audit.unfinished.length + (audit.continued ? ' continue' : '') + (audit.fallback ? ' fallback' : ''))
        if (typeof after === 'function') after()
      })
    }
    // The placeholder alone: the turn itself was the task and it completed.
    if (isFallbackList(rows)) {
      write([{ content: rows[0].content, status: 'completed' }], {
        done: 1, open: 0, dropped: 0, deferred: [], unfinished: [], continuedCount: state.continued,
        waitingUser: false, continued: false, fallback: false, reason: '',
      })
      return
    }
    const agent = agentOf(session)
    let verdicts
    let reason = ''
    if (agent !== undefined) {
      const controller = new AbortController()
      state.auditing = controller
      const input = [
        requestText(state),
        '清单：\n' + listText(rows),
        '主智能体这一轮的实际动作（最近部分）：\n' + activityText(state),
        '主智能体的最终回复：\n' + (state.lastReply === '' ? '（无）' : state.lastReply.slice(-REPLY_MAX)),
      ].join('\n\n')
      try {
        const result = await ask(agent, 'final', FINAL_SYSTEM, input, controller.signal, (output) => {
          const value = jsonSlice(output, '{', '}')
          if (value === undefined || value === null || !Array.isArray(value.verdicts) || value.verdicts.length !== rows.length) return undefined
          return value
        })
        if (result !== undefined) {
          verdicts = result.verdicts.map((verdict) => (verdict === 'done' || verdict === 'drop' || verdict === 'wait' ? verdict : 'open'))
          // Older prompt shape: a global waiting flag turns every open row into a wait.
          if (result.waiting_user === true) verdicts = verdicts.map((verdict) => (verdict === 'open' ? 'wait' : verdict))
          reason = typeof result.reason === 'string' ? oneLine(result.reason, 200) : ''
        }
      } finally {
        if (state.auditing === controller) state.auditing = null
      }
    }
    if (!stillEnded()) return
    const fallback = verdicts === undefined
    if (fallback) {
      // No verdict: a finished turn closes what was running; rows the guardian
      // only predicted are dropped; rows the model planned are unverified.
      verdicts = rows.map((item) => (item.status === 'completed' || item.status === 'in_progress' ? 'done' : state.owner === 'model' ? 'open' : 'drop'))
    }
    const enforceable = !fallback && continueEnabled() && depthOf(session) === 0 &&
      state.continued < CONTINUE_MAX && agent !== undefined && typeof agent.followup === 'function'
    // Contract: a finished turn leaves only completed rows. An open row either
    // drives a continuation (it stays, the agent resumes at once) or leaves the
    // board and is named in the audit footer; rows waiting on the user leave too.
    const todos = []
    const open = []
    const deferred = []
    const unfinished = []
    let done = 0
    let dropped = 0
    rows.forEach((item, index) => {
      const verdict = item.status === 'completed' ? 'done' : verdicts[index]
      if (verdict === 'done') {
        todos.push({ content: item.content, status: 'completed' })
        done += 1
      } else if (verdict === 'drop') {
        dropped += 1
      } else if (verdict === 'wait') {
        deferred.push(item.content)
      } else if (enforceable) {
        todos.push({ content: item.content, status: 'pending' })
        open.push(item)
      } else {
        unfinished.push(item.content)
      }
    })
    const enforce = open.length > 0
    const audit = {
      done,
      open: open.length,
      dropped,
      deferred: deferred.slice(0, SETTLED_LIST_MAX),
      unfinished: unfinished.slice(0, SETTLED_LIST_MAX),
      continuedCount: state.continued + (enforce ? 1 : 0),
      waitingUser: deferred.length > 0,
      continued: enforce,
      fallback,
      reason,
    }
    write(todos, audit, enforce ? () => { if (stillEnded()) queueContinuation(session, state, open) } : undefined)
  }

  // ---------------------------------------------------------------- events

  /** First board of a turn: carry open rows over, else the request placeholder. */
  const seedTurn = (session, state, turn, carry) => {
    publish(session, () => {
      if (state.turn !== turn || state.phase !== 'running' || state.owner === 'model') return undefined
      if (carry !== undefined) return carry
      return [{ content: labelOf(state.request), status: 'in_progress' }]
    }, (todos) => {
      state.list = todos
      if (state.owner === 'none') state.owner = 'guardian'
      trace('seed ' + session.id + ': ' + todos[0].content)
    })
  }

  const carryOver = (list) => {
    if (!Array.isArray(list)) return undefined
    const open = list.filter(isOpen)
    if (open.length === 0) return undefined
    const todos = list.filter(isTodo).map((item) => ({ content: item.content, status: item.status === 'completed' ? 'completed' : 'pending' }))
    const next = todos.findIndex((item) => item.status === 'pending')
    if (next >= 0) todos[next] = { ...todos[next], status: 'in_progress' }
    return todos
  }

  const startTurn = (session, state, turn) => {
    prune()
    clearTimeout(state.timer)
    abortAudit(state)
    state.turn = turn
    state.phase = 'running'
    state.owner = 'none'
    state.msgSeen = false
    state.activity = []
    state.lastReply = ''
    state.callsTotal = 0
    state.callsAtAudit = 0
    state.callsAtModelWrite = 0
    state.auditAt = 0
    const agent = agentOf(session)
    state.auto = agent !== undefined && ctx.tools.get('todo_write', agent) !== undefined
    if (!state.auto) {
      trace('turn/start ' + session.id + ': ' + (agent === undefined ? 'no live agent' : 'no todo_write'))
      return
    }
    // Continuation turns (no user message) still get a board.
    state.timer = setTimeout(() => {
      if (state.turn !== turn || state.phase !== 'running' || state.msgSeen || state.owner === 'model') return
      const carry = carryOver(state.list)
      seedTurn(session, state, turn, carry)
      if (carry === undefined) state.timer = setTimeout(() => maybeAudit(session, state, true), PLAN_DELAY_MS)
    }, TURN_INPUT_WAIT_MS)
  }

  const onUserMessage = (session, state, event) => {
    const data = event.data
    const source = data === null || data === undefined ? undefined : data.source
    if (source === null || typeof source !== 'object' || source.kind !== 'user') return
    const text = textOfMessage(data)
    if (text === '') return
    const ours = (typeof data.id === 'string' && state.guardMessages.has(data.id)) || text.startsWith(CONTINUE_PREFIX)
    if (state.turn === undefined || state.phase !== 'running') {
      // A message outside a live turn only updates the request text.
      if (!ours) {
        state.request = text
        state.steers = []
        state.continued = 0
      }
      return
    }
    if (state.msgSeen) {
      // Added mid-turn: merge it into the plan instead of replacing the board.
      if (ours) return
      state.steers.push(text)
      if (state.steers.length > 6) state.steers.splice(0, state.steers.length - 6)
      remember(state, 'say', '（用户追加）' + text)
      trace('steer ' + session.id + ': ' + oneLine(text, 30))
      if (state.auto && state.owner !== 'model') maybeAudit(session, state, true)
      return
    }
    state.msgSeen = true
    clearTimeout(state.timer)
    const turn = state.turn
    if (ours) {
      // Our own continuation: the request stays, the open rows carry over.
      trace('continuation turn ' + session.id)
      if (state.auto && state.owner !== 'model') seedTurn(session, state, turn, carryOver(state.list))
      return
    }
    state.request = text
    state.steers = []
    state.continued = 0
    trace('request ' + session.id + ': ' + oneLine(text, 30))
    if (!state.auto || state.owner === 'model') return
    seedTurn(session, state, turn, undefined)
    state.timer = setTimeout(() => maybeAudit(session, state, true), PLAN_DELAY_MS)
  }

  const onTodoWrite = (session, state, event) => {
    const data = event.data === null || event.data === undefined ? {} : event.data
    const todos = Array.isArray(data.todos) ? data.todos : null
    if (data.by === GUARD_TAG) {
      state.list = todos
      return
    }
    // Pre-tag placeholders from an older guardian are not the model's.
    if (isFallbackList(todos)) return
    state.list = todos
    if (state.phase !== 'running') return
    state.owner = 'model'
    state.callsAtModelWrite = state.callsTotal
    state.callsAtAudit = state.callsTotal
    clearTimeout(state.timer)
    // An in-flight progress audit would overwrite the model; status audits re-check the base.
    abortAudit(state)
    trace('model list ' + session.id + ': ' + (todos === null ? 'null' : todos.length + ' row(s)'))
  }

  /** The plugin may be (re)loaded mid-turn: adopt the running turn lazily. */
  const adopt = (session, state, turn) => {
    if (state.turn !== undefined || typeof turn !== 'number') return
    const agent = agentOf(session)
    state.turn = turn
    state.phase = 'running'
    state.msgSeen = true
    state.auto = agent !== undefined && ctx.tools.get('todo_write', agent) !== undefined
    const list = readTodos(session)
    state.list = Array.isArray(list) ? list : null
    // Trust the last writer's tag over the list's mere existence: a guardian-owned
    // board reloaded mid-turn must stay guardian-owned, or the guardian would only
    // status-audit it (content frozen) until the next turn.
    const writer = readWriter(session)
    state.owner = writer !== undefined
      ? writer
      : !Array.isArray(list) || list.length === 0 || isFallbackList(list) ? 'guardian' : 'model'
    trace('adopt ' + session.id + ' turn ' + turn + ' owner=' + state.owner)
  }

  const handle = (session, event) => {
    if (session === undefined || session === null || event === undefined || event === null) return
    const state = stateOf(session)
    if (state === undefined) return
    const data = event.data === null || event.data === undefined ? {} : event.data
    switch (event.type) {
      case 'turn/start':
        startTurn(session, state, data.turn)
        return
      case 'user/message':
        onUserMessage(session, state, event)
        return
      case 'todo/write':
        onTodoWrite(session, state, event)
        return
      case 'tool/call': {
        adopt(session, state, data.turn)
        if (data.name === 'todo_write') return
        state.callsTotal += 1
        remember(state, 'do', describeCall(data.name, data.arguments))
        return
      }
      case 'assistant/message': {
        adopt(session, state, data.turn)
        const text = textOfMessage(data.message)
        if (text !== '') {
          remember(state, 'say', text)
          state.lastReply = text.length > REPLY_MAX * 2 ? text.slice(-REPLY_MAX * 2) : text
        }
        return
      }
      case 'step/end':
        maybeAudit(session, state, false)
        return
      case 'turn/end': {
        clearTimeout(state.timer)
        abortAudit(state)
        const turn = state.turn
        state.phase = 'ended'
        const reason = data.reason
        const completed = reason !== null && typeof reason === 'object' && reason.kind === 'completed'
        trace('turn/end ' + session.id + ': ' + String(reason === undefined || reason === null ? undefined : reason.kind))
        // Interrupted turns keep their rows; the board shows them as paused.
        if (!completed || !state.auto) return
        void runFinalAudit(session, state, turn).catch((error) => trace('final audit error: ' + errorText(error)))
        return
      }
      default:
        return
    }
  }

  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return undefined
    // `session/event` is emitted on the Agent's own context, which is a sibling
    // of this plugin's context — without `global` the listener never fires.
    const off = ctx.on('session/event', (session, event) => {
      try {
        handle(session, event)
      } catch (error) {
        trace('error: ' + errorText(error))
        ctx.logger?.warn?.('todo-nudge: task guardian failed: %o', error)
      }
    }, { global: true })
    return () => {
      if (typeof off === 'function') off()
      for (const state of states.values()) {
        clearTimeout(state.timer)
        abortAudit(state)
      }
      states.clear()
    }
  }, 'todo-nudge: task guardian')
}

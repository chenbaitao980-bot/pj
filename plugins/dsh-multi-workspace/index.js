import path from 'node:path'

export const name = 'dsh-multi-workspace'
export const inject = ['commands', 'systemPrompt', 'sessionProjections']

/**
 * Extra workspace roots for one Session, derived from the Session log.
 *
 * Every `/roots` invocation is logged by the command service as
 * `command/run` (with its raw input) and `command/done` (with the outcome).
 * The projection folds those records, so the roots list survives restarts,
 * reaches the Client as a session projection value, and stays rebuildable
 * from the log — no side file, no in-process map.
 *
 * `apply` pairs a `command/done` back to the raw input recorded by its
 * `command/run`; a failed invocation only drops its pending entry.
 */
/** Minimal schema: the session-projection runtime only calls `.parse`. */
const rootsViewSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object' || !Array.isArray(value.roots)) {
      throw new TypeError('multiWorkspaceRoots view must be { roots: string[] }')
    }
    return { roots: value.roots.map((root) => String(root)) }
  },
}

/** Fold one `/roots <action> <path>` line into a roots list. */
function foldRoots(roots, rawInput) {
  const words = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
  const action = (words[0] ?? 'list').toLowerCase()
  const target = words.slice(1).join(' ').trim()
  if (action === 'add' && target !== '' && path.isAbsolute(target)) {
    const normalized = path.normalize(target)
    return roots.includes(normalized) ? roots : [...roots, normalized]
  }
  if (action === 'remove' && target !== '') {
    const normalized = path.normalize(target)
    const next = roots.filter((root) => root !== normalized)
    return next.length === roots.length ? roots : next
  }
  if (action === 'clear') return roots.length === 0 ? roots : []
  return roots
}

const definition = {
  key: 'multiWorkspaceRoots',
  stateVersion: 1,
  stateSchema: {
    parse(value) {
      if (value === null || typeof value !== 'object') {
        throw new TypeError('multiWorkspaceRoots state must be an object')
      }
      const roots = Array.isArray(value.roots)
        ? value.roots.filter((root) => typeof root === 'string')
        : []
      const pending =
        value.pending !== null && typeof value.pending === 'object' && !Array.isArray(value.pending)
          ? Object.fromEntries(Object.entries(value.pending).filter(([, raw]) => typeof raw === 'string'))
          : {}
      return { roots, pending }
    },
  },
  init: () => ({ roots: [], pending: {} }),
  apply: (state, event) => {
    if (event.type === 'command/run') {
      const data = event.data
      if (data === undefined || data === null || data.name !== 'roots') return state
      return {
        ...state,
        pending: { ...state.pending, [String(data.commandId)]: String(data.args ?? '') },
      }
    }
    if (event.type !== 'command/done') return state
    const data = event.data
    if (data === undefined || data === null) return state
    const commandId = String(data.commandId)
    if (!Object.prototype.hasOwnProperty.call(state.pending, commandId)) return state
    const pending = { ...state.pending }
    const rawInput = pending[commandId]
    delete pending[commandId]
    if (data.kind !== 'success') return { ...state, pending }
    const roots = foldRoots(state.roots, rawInput)
    return { roots, pending }
  },
  wire: {
    viewSchema: rootsViewSchema,
    view: (state) => ({ roots: state.roots }),
  },
}

/** Render the roots of one Session as a prompt section body. */
function renderSection(roots) {
  return [
    '# 关联工作区',
    '本会话除当前工作目录外还关联了下面这些目录。直接使用绝对路径读写，不要假设它们在工作目录之内：',
    ...roots.map((root) => `- ${root}`),
    '在这些目录内操作时仍然遵守当前权限模式；只读路径越界会被拒绝，需要写权限时切到完全权限。',
  ].join('\n')
}

export async function apply(ctx) {
  const handle = await ctx.sessionProjections.register(definition)

  const rootsOf = (session) => {
    try {
      return handle.stateOf(session).roots
    } catch {
      return []
    }
  }

  ctx.systemPrompt.section({
    name: 'multi-workspace:roots',
    order: 9000,
    text: (context) => {
      const agent = context.agent
      if (agent === undefined) return ''
      const roots = rootsOf(agent.session)
      return roots.length === 0 ? '' : renderSection(roots)
    },
  })

  ctx.commands.register({
    name: 'roots',
    description: '管理本会话关联的额外工作区（多工作区）',
    input: { hint: '[add <绝对路径> | remove <绝对路径> | list | clear]' },
    handler: ({ agent, rawInput }) => {
      if (agent === undefined) return { kind: 'error', text: '当前没有活动会话' }

      const current = rootsOf(agent.session)
      const words = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
      const action = (words[0] ?? 'list').toLowerCase()
      const target = words.slice(1).join(' ').trim()

      if (action === 'list') {
        if (current.length === 0) {
          return { kind: 'success', text: '本会话还没有额外工作区。用 /roots add <绝对路径> 添加。' }
        }
        return { kind: 'success', text: ['本会话的额外工作区：', ...current.map((root) => `- ${root}`)].join('\n') }
      }

      if (action === 'add') {
        if (target === '') return { kind: 'error', text: '用法：/roots add <绝对路径>' }
        if (!path.isAbsolute(target)) return { kind: 'error', text: `需要绝对路径：${target}` }
        const normalized = path.normalize(target)
        if (current.includes(normalized)) return { kind: 'success', text: `已在列表里：${normalized}` }
        return {
          kind: 'success',
          text: `已关联：${normalized}\n下一次模型请求起生效。跨工作区写入需要在「完全权限」模式下进行。`,
        }
      }

      if (action === 'remove') {
        if (target === '') return { kind: 'error', text: '用法：/roots remove <绝对路径>' }
        const normalized = path.normalize(target)
        if (!current.includes(normalized)) return { kind: 'error', text: `不在列表里：${normalized}` }
        return { kind: 'success', text: `已移除：${normalized}` }
      }

      if (action === 'clear') {
        return { kind: 'success', text: '已清空本会话的额外工作区。' }
      }

      return { kind: 'error', text: '用法：/roots [add <绝对路径> | remove <绝对路径> | list | clear]' }
    },
  })
}

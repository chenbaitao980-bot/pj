import path from 'node:path'

export const name = 'dsh-multi-workspace'
export const inject = ['commands', 'systemPrompt']

/**
 * Extra workspace roots per Session id.
 *
 * Process-local on purpose: a Session's extra roots are a working preference,
 * not Session state, and nothing here needs to survive a Host restart yet.
 */
const rootsBySession = new Map()

/** Render the roots of one Session as a prompt section body. */
function renderSection(roots) {
  return [
    '# 关联工作区',
    '本会话除当前工作目录外还关联了下面这些目录。直接使用绝对路径读写，不要假设它们在工作目录之内：',
    ...roots.map((root) => `- ${root}`),
    '在这些目录内操作时仍然遵守当前权限模式；只读路径越界会被拒绝，需要写权限时切到完全权限。',
  ].join('\n')
}

/** Read the Session's roots, defaulting to an empty list. */
function rootsOf(sessionId) {
  return rootsBySession.get(sessionId) ?? []
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'multi-workspace:roots',
    order: 9000,
    text: (context) => {
      const agent = context.agent
      if (agent === undefined) return ''
      const roots = rootsOf(agent.session.id)
      return roots.length === 0 ? '' : renderSection(roots)
    },
  })

  ctx.commands.register({
    name: 'roots',
    description: '管理本会话关联的额外工作区（多工作区）',
    input: { hint: '[add <绝对路径> | remove <绝对路径> | list | clear]' },
    handler: ({ agent, rawInput }) => {
      if (agent === undefined) return { kind: 'error', text: '当前没有活动会话' }

      const sessionId = agent.session.id
      const current = rootsOf(sessionId)
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
        rootsBySession.set(sessionId, [...current, normalized])
        return {
          kind: 'success',
          text: `已关联：${normalized}\n下一次模型请求起生效。跨工作区写入需要在「完全权限」模式下进行。`,
        }
      }

      if (action === 'remove') {
        if (target === '') return { kind: 'error', text: '用法：/roots remove <绝对路径>' }
        const normalized = path.normalize(target)
        const next = current.filter((root) => root !== normalized)
        if (next.length === current.length) return { kind: 'error', text: `不在列表里：${normalized}` }
        if (next.length === 0) rootsBySession.delete(sessionId)
        else rootsBySession.set(sessionId, next)
        return { kind: 'success', text: `已移除：${normalized}` }
      }

      if (action === 'clear') {
        rootsBySession.delete(sessionId)
        return { kind: 'success', text: '已清空本会话的额外工作区。' }
      }

      return { kind: 'error', text: '用法：/roots [add <绝对路径> | remove <绝对路径> | list | clear]' }
    },
  })
}

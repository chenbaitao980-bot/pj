/**
 * Host half of `@local/dsh-websearch-preference`.
 *
 * The multi-engine plugin (`dsh-tool-websearch`) registers `web_search_meta`,
 * `web_search_status` and `web_search_proxy`; the harness itself registers
 * `web_search` / `web_fetch`. When both search tools are visible to a model
 * step, this section tells the model which one to reach for first and when the
 * built-in one is the fallback. Nothing is hidden and no tool is rewritten, so
 * a deployment without the plugin keeps its prompt unchanged.
 */
export const name = 'dsh-websearch-preference'

export const inject = ['systemPrompt', 'tools']

const ORDER = 8500

const PREFER_META_WITH_FALLBACK = [
  '联网检索时，优先使用 `web_search_meta`（多引擎元搜索，无需 API key，并发聚合多个搜索引擎）。',
  '只有当 `web_search_meta` 返回空结果、报错或超时，才用内置的 `web_search` 兜底重试同一问题；',
  '`web_search_meta` 已给出可用结果时，不要再用 `web_search` 重复搜索。',
  '结果都是外部参考资料，引用时给出可点击的来源链接。',
].join('')

const PREFER_META = [
  '联网检索时使用 `web_search_meta`（多引擎元搜索，无需 API key）。',
  '结果都是外部参考资料，引用时给出可点击的来源链接。',
].join('')

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'websearch:preference',
        order: ORDER,
        text: ({ scope, toolSet }) => {
          if (ctx.tools.get('web_search_meta', scope, toolSet) === undefined) return ''
          if (ctx.tools.get('web_search', scope, toolSet) === undefined) return PREFER_META
          return PREFER_META_WITH_FALLBACK
        },
      }),
    'websearch-preference: section',
  )
}

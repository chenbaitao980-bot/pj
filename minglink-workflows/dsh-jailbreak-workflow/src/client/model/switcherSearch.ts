/**
 * dsh-workflow-lite — 顶栏下拉里的搜索与分组：一个搜索框同时过滤「实例」和「工作流」，
 * 实例默认只露出最近几个，其余折在「显示全部」后面。纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/switcherSearch
 */

/** 实例默认露出几个（其余折叠）。 */
export const RUNS_SHOWN = 3

/**
 * 工作流默认露出几个。比实例多一档：上百张图时，一次挂上百行带 Flip 测量的行是切换下拉
 * 最贵的一帧；但工作流是"我要找哪一张"，只给 3 个不够挑。
 */
export const WORKFLOWS_SHOWN = 12

/** 搜索词归一：去首尾空白、不分大小写。 */
export function normalizeNeedle(query: string): string {
  return query.trim().toLowerCase()
}

/** `needle`（已归一）在 `text` 里第一次出现的区间；没有 = `null`。空搜索词不命中任何字。 */
export function matchRange(text: string, needle: string): readonly [number, number] | null {
  if (needle === '') return null
  const at = text.toLowerCase().indexOf(needle)
  return at < 0 ? null : [at, at + needle.length]
}

/** 工作流按名字过滤（保持传入顺序）。 */
export function filterWorkflows<T extends { name: string }>(
  list: readonly T[],
  needle: string,
): T[] {
  return needle === ''
    ? [...list]
    : list.filter((entry) => entry.name.toLowerCase().includes(needle))
}

/**
 * 实例过滤：`haystacks` 给出一个实例上可以搜的几段文字（工作流名、状态文字、时间……），任一段含搜索词就算命中。
 */
export function filterRuns<T>(
  list: readonly T[],
  needle: string,
  haystacks: (item: T) => readonly string[],
): T[] {
  if (needle === '') return [...list]
  return list.filter((item) => haystacks(item).some((text) => text.toLowerCase().includes(needle)))
}

/** 本会话的当前实例排最前，其余保持原来的顺序（新的在前）。 */
export function currentFirst<T extends { id: string }>(
  list: readonly T[],
  current: string | undefined,
): T[] {
  const head = list.filter((item) => item.id === current)
  return [...head, ...list.filter((item) => item.id !== current)]
}

/**
 * 实例这一组此刻露出哪几个。
 *
 * - 展开了、或者搜索中（`expanded`）：全部；
 * - 否则最前 {@link RUNS_SHOWN} 个，再加上正在看的那个（它藏在折叠里会让人找不到选中项）；
 * - 只多出一个时直接露出：「显示全部」那一行本身就占一行，不如直接放它。
 */
export function visibleRuns<T extends { id: string }>(
  list: readonly T[],
  options: { expanded: boolean; active: string | null; limit?: number },
): { shown: T[]; hidden: number } {
  const limit = options.limit ?? RUNS_SHOWN
  if (options.expanded || list.length <= limit + 1) return { shown: [...list], hidden: 0 }
  const shown = list.filter((item, index) => index < limit || item.id === options.active)
  return { shown, hidden: list.length - shown.length }
}

/**
 * 工作流这一组此刻露出哪几张——照 {@link visibleRuns} 的取舍，只是缺省档位不同。
 *
 * - 展开了、或者搜索中（`expanded`）：全部（搜索要的是命中项，折叠会把结果藏掉）；
 * - 否则最前 {@link WORKFLOWS_SHOWN} 个，再加上正开着的那张（`current`，它藏在折叠里会让人找不到自己）；
 * - 只多出一个时直接露出：「显示全部」那一行本身就占一行。
 *
 * 调用方按 `updatedAt` 从新到旧传进来即可（下拉里就是这个序）；不改变相对顺序。
 */
export function visibleWorkflows<T extends { name: string }>(
  list: readonly T[],
  options: { expanded: boolean; current: string | null; limit?: number },
): { shown: T[]; hidden: number } {
  const limit = options.limit ?? WORKFLOWS_SHOWN
  if (options.expanded || list.length <= limit + 1) return { shown: [...list], hidden: 0 }
  const shown = list.filter((item, index) => index < limit || item.name === options.current)
  return { shown, hidden: list.length - shown.length }
}

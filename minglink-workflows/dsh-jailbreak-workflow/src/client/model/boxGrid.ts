/**
 * dsh-workflow-lite — 卡片空间网格。
 *
 * 走线计算（`model/route.ts`）里每条边都要问「哪些卡片压在这段路上 / 在这条走廊范围内」，
 * 原来是对全部卡片线性扫一遍：400 节点 531 条边时，拖一帧要跑几百万次比较（实测 450ms）。
 * 这里把卡片按格子装起来，查询只碰覆盖到的几个格子里的卡片。
 *
 * **只负责缩小候选集，不做任何几何判断**：调用方拿到的候选仍然要用原来的条件精判，
 * 因此结果与线性扫描**逐字一致**（含顺序——返回的下标按原数组升序，`routeKey` 依赖这个次序）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/boxGrid
 */

/** 走线要问几何的最小形状（与 `route.ts` 的 Rect 同形）。 */
export interface GridRect {
  x: number
  y: number
  w: number
  h: number
}

/** 一格多大：卡片宽约 200–460、高约 60–400，取 512 让一张卡通常只占 1–4 格。 */
const CELL = 512

/** 坐标 → 格号的偏移，保证负坐标也是非负整数（画布坐标可到负值）。 */
const SHIFT = 1_000_000

/**
 * 一张静态卡片集合的网格索引。
 *
 * 建索引 O(n)；`covering` 查询只遍历矩形覆盖到的格子（卡片尺寸下通常 ≤ 4 格）。
 * 拖动时每帧坐标变一点，重建一次网格（O(n)）比每条边扫全表（O(n·m)）便宜得多。
 */
export class BoxGrid {
  /** `gy * STRIDE + gx` → 该格内的卡片下标（按原数组升序 push，所以天然有序）。 */
  private readonly cells = new Map<number, number[]>()
  /** `gx` → 横向覆盖到这一列的卡片下标（升序）。给「只看 x、不管 y」的走廊查询用。 */
  private readonly columns = new Map<number, number[]>()
  /** `gy` → 纵向覆盖到这一行的卡片下标（升序）。给「只看 y、不管 x」的竖走廊查询用。 */
  private readonly rows = new Map<number, number[]>()
  private readonly boxes: readonly GridRect[]

  constructor(boxes: readonly GridRect[]) {
    this.boxes = boxes
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index] as GridRect
      const [x1, y1, x2, y2] = bounds(box)
      // 行表单独一趟：gx 外层会让同一 index 落进多个列，行必须每张卡只入一次。
      for (let gy = cellOf(y1); gy <= cellOf(y2); gy += 1) {
        const row = this.rows.get(gy)
        if (row === undefined) this.rows.set(gy, [index])
        else row.push(index)
      }
      for (let gx = cellOf(x1); gx <= cellOf(x2); gx += 1) {
        const column = this.columns.get(gx)
        if (column === undefined) this.columns.set(gx, [index])
        else column.push(index)
        for (let gy = cellOf(y1); gy <= cellOf(y2); gy += 1) {
          const key = gy * STRIDE + gx
          const list = this.cells.get(key)
          if (list === undefined) this.cells.set(key, [index])
          else list.push(index)
        }
      }
    }
  }

  /** 网格的行主序宽度（横向格子数上限）。 */
  private get stride(): number {
    return STRIDE
  }

  /**
   * 与 `[x1,y1]–[x2,y2]` 这个矩形**可能**相交的卡片下标，按原数组升序、不重复。
   *
   * 「可能」是刻意的：格子是粗筛，调用方仍要按自己的条件精判。返回的候选是原数组的
   * 子序列，所以 `boxes.filter(...)` 换成它之后，相对顺序与原来完全一样。
   */
  covering(x1: number, y1: number, x2: number, y2: number): number[] {
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    const out: number[] = []
    const seen = new Set<number>()
    for (let gy = cellOf(top); gy <= cellOf(bottom); gy += 1) {
      for (let gx = cellOf(left); gx <= cellOf(right); gx += 1) {
        const list = this.cells.get(gy * this.stride + gx)
        if (list === undefined) continue
        for (const index of list) {
          if (seen.has(index)) continue
          seen.add(index)
          out.push(index)
        }
      }
    }
    // 跨行合并可能打乱先后，按升序排回来（候选数很小，这一步是常数级开销）。
    if (out.length > 1) out.sort((a, b) => a - b)
    return out
  }

  /** 与矩形可能相交的卡片（按原数组顺序的副本）。 */
  overlapping(x1: number, y1: number, x2: number, y2: number): GridRect[] {
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    return this.covering(left, top, right, bottom)
      .map((index) => this.boxes[index] as GridRect)
      .filter((box) => intersects(box, left, top, right, bottom))
  }

  /**
   * 与一段**轴对齐**线段可能相交的卡片。
   *
   * 线段按 `pad` 往外扩（`segmentHits` 会把卡片放大同样的量），所以粗筛用扩过的范围。
   */
  alongSegment(a: readonly number[], b: readonly number[], pad: number): GridRect[] {
    const x1 = Math.min(a[0] as number, b[0] as number) - pad
    const x2 = Math.max(a[0] as number, b[0] as number) + pad
    const y1 = Math.min(a[1] as number, b[1] as number) - pad
    const y2 = Math.max(a[1] as number, b[1] as number) + pad
    return this.overlapping(x1, y1, x2, y2)
  }

  /** 一个点落在哪些卡片里（粗筛）。 */
  at(x: number, y: number): GridRect[] {
    return this.overlapping(x, y, x, y)
  }

  /**
   * 纵向覆盖 `[y1, y2]` 的卡片（**横向不限**），按原数组升序 + 精判。
   *
   * 竖走廊的查询用这个（`nudge` 的竖段）；与 `acrossColumns` 对称。
   */
  acrossRows(y1: number, y2: number): GridRect[] {
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    const out: number[] = []
    const seen = new Set<number>()
    for (let gy = cellOf(top); gy <= cellOf(bottom); gy += 1) {
      const list = this.rows.get(gy)
      if (list === undefined) continue
      for (const index of list) {
        if (seen.has(index)) continue
        seen.add(index)
        out.push(index)
      }
    }
    if (out.length > 1) out.sort((a, b) => a - b)
    return out
      .map((index) => this.boxes[index] as GridRect)
      .filter((box) => box.y < bottom && box.y + box.h > top)
  }

  /**
   * 横向覆盖 `[x1, x2]` 的卡片（**纵向不限**），按原数组升序。
   *
   * 走廊类查询（`freeLane` / `nearestLane`）只看 x、y 靠算法自己挪，就用这个。
   */
  acrossColumns(x1: number, x2: number): GridRect[] {
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const out: number[] = []
    const seen = new Set<number>()
    for (let gx = cellOf(left); gx <= cellOf(right); gx += 1) {
      const list = this.columns.get(gx)
      if (list === undefined) continue
      for (const index of list) {
        if (seen.has(index)) continue
        seen.add(index)
        out.push(index)
      }
    }
    if (out.length > 1) out.sort((a, b) => a - b)
    return out
      .map((index) => this.boxes[index] as GridRect)
      .filter((box) => box.x < right && box.x + box.w > left)
  }
}

/** 行主序的格数上限：坐标 ±1e6 / 512 ≈ 3907 格，留足余量。 */
const STRIDE = 8192

function cellOf(value: number): number {
  return Math.floor((value + SHIFT) / CELL)
}

function bounds(box: GridRect): [number, number, number, number] {
  return [box.x, box.y, box.x + box.w, box.y + box.h]
}

/** 卡片与矩形真的相交（精判，与调用方的线性条件同式）。 */
function intersects(
  box: GridRect,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  return box.x < right && box.x + box.w > left && box.y < bottom && box.y + box.h > top
}

/**
 * 数组 → 网格的缓存。
 *
 * `route.ts` 里那些函数的入参是卡片数组，同一帧内所有边共用同一份数组；用 WeakMap 认它的身份，
 * 只建一次网格。数组每帧新建（拖动时坐标变），缓存随之失效——这正是我们要的语义。
 */
const GRIDS = new WeakMap<object, BoxGrid>()

/** 取（或建）这份卡片数组的网格。传进来的不是数组就当空网格。 */
export function gridOf(boxes: readonly GridRect[]): BoxGrid {
  const cached = GRIDS.get(boxes)
  if (cached !== undefined) return cached
  const grid = new BoxGrid(boxes)
  // 只有真对象能进 WeakMap；readonly Rect[] 是数组，可以。
  GRIDS.set(boxes, grid)
  return grid
}

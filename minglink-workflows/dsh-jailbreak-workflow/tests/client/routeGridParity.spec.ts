import { describe, expect, it } from 'vitest'
import {
  type Anchor,
  bezierBlocked,
  flowBlocked,
  freeLane,
  nearestLane,
  orthoRoute,
  pointsBlocked,
  type Rect,
} from '../../src/client/model/route.ts'

/**
 * 网格加速后的走线函数，必须与「线性扫全表」的原始语义逐字一致。
 *
 * 这里内联一份朴素参照实现（照抄改动前的算法），用随机卡片与随机线反复对拍。
 * 参照实现只在本文件里活着，不进产品代码。
 */

const gap = 18
const inset = 4
const reach = 200

function linearFreeLane(boxes: readonly Rect[], x1: number, x2: number, from: number): number {
  const [left, right] = x1 <= x2 ? [x1, x2] : [x2, x1]
  const across = boxes.filter((box) => box.x < right && box.x + box.w > left)
  let lane = from
  for (let moved = true; moved; ) {
    moved = false
    for (const box of across) {
      if (lane > box.y - gap && lane < box.y + box.h + gap) {
        lane = box.y + box.h + gap
        moved = true
      }
    }
  }
  return lane
}

function linearFlowBlocked(
  boxes: readonly Rect[],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): boolean {
  const dx = Math.max(0, tx - sx)
  const c1x = sx + Math.max(dx / 2, Math.min(dx + 28, 140))
  const c2x = tx - dx / 2
  const inside = (x: number, y: number): boolean =>
    boxes.some(
      (box) =>
        x > box.x + inset &&
        x < box.x + box.w - inset &&
        y > box.y + inset &&
        y < box.y + box.h - inset,
    )
  for (let index = 1; index < 40; index += 1) {
    const t = index / 40
    const u = 1 - t
    const x = u ** 3 * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * tx
    const y = u ** 3 * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t ** 3 * ty
    if (x <= sx + 2 || x >= tx - 2) continue
    if (inside(x, y)) return true
  }
  return false
}

function linearNearestLane(boxes: readonly Rect[], x1: number, x2: number, around: number): number {
  const [left, right] = x1 <= x2 ? [x1, x2] : [x2, x1]
  const across = boxes.filter((box) => box.x < right && box.x + box.w > left)
  const clear = (y: number): boolean =>
    across.every((box) => y <= box.y - gap || y >= box.y + box.h + gap)
  const candidates = [
    around,
    ...across.flatMap((box) => [box.y - gap, box.y + box.h + gap]),
  ].filter(clear)
  return candidates.reduce(
    (best, y) => (Math.abs(y - around) < Math.abs(best - around) ? y : best),
    candidates[0] ?? around,
  )
}

/** 随机数发生器（确定性种子，失败可复现）。 */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomBoxes(count: number, next: () => number): Rect[] {
  const boxes: Rect[] = []
  for (let index = 0; index < count; index += 1) {
    boxes.push({
      // 摆在真实画布的密度上：列 380、行 220，抖动 ±120，让卡片既有重叠也留缝。
      x: Math.round((next() * 12 - 6) * 380),
      y: Math.round((next() * 10 - 5) * 220),
      w: Math.round(180 + next() * 280),
      h: Math.round(60 + next() * 320),
    })
  }
  return boxes
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

function randomAnchor(boxes: readonly Rect[], next: () => number): Anchor {
  const box = boxes[Math.floor(next() * boxes.length)] as Rect
  const side = SIDES[Math.floor(next() * SIDES.length)] as Anchor['side']
  const at = next()
  switch (side) {
    case 'left':
      return { x: box.x, y: box.y + box.h * at, side }
    case 'right':
      return { x: box.x + box.w, y: box.y + box.h * at, side }
    case 'top':
      return { x: box.x + box.w * at, y: box.y, side }
    case 'bottom':
      return { x: box.x + box.w * at, y: box.y + box.h, side }
  }
}

describe('走线网格加速与线性实现逐字一致', () => {
  for (const seed of [11, 23, 57, 91, 2024]) {
    it(`freeLane（seed=${seed}）`, () => {
      const next = rng(seed)
      const boxes = randomBoxes(240, next)
      for (let trial = 0; trial < 400; trial += 1) {
        const x1 = Math.round((next() * 12 - 6) * 380)
        const x2 = x1 + Math.round(next() * 2400)
        const from = Math.round((next() * 10 - 5) * 220)
        expect(freeLane(boxes, x1, x2, from)).toBe(linearFreeLane(boxes, x1, x2, from))
      }
    })

    it(`nearestLane（seed=${seed}）`, () => {
      const next = rng(seed + 1)
      const boxes = randomBoxes(240, next)
      for (let trial = 0; trial < 400; trial += 1) {
        const x1 = Math.round((next() * 12 - 6) * 380)
        const x2 = x1 + Math.round(next() * 2400)
        const around = Math.round((next() * 10 - 5) * 220)
        expect(nearestLane(boxes, x1, x2, around)).toBe(linearNearestLane(boxes, x1, x2, around))
      }
    })

    it(`flowBlocked 带 skip 等于「剔掉 skip 再线性判」（seed=${seed}）`, () => {
      const next = rng(seed + 2)
      const boxes = randomBoxes(240, next)
      for (let trial = 0; trial < 300; trial += 1) {
        const from = boxes[Math.floor(next() * boxes.length)] as Rect
        const to = boxes[Math.floor(next() * boxes.length)] as Rect
        const sx = from.x + from.w
        const sy = from.y + from.h / 2
        const tx = to.x
        const ty = to.y + to.h / 2
        const skip = [from, to]
        const others = boxes.filter((box) => box !== from && box !== to)
        expect(flowBlocked(boxes, sx, sy, tx, ty, skip)).toBe(
          linearFlowBlocked(others, sx, sy, tx, ty),
        )
      }
    })

    it(`bezierBlocked / pointsBlocked 与线性同结果（seed=${seed}）`, () => {
      const next = rng(seed + 3)
      const boxes = randomBoxes(200, next)
      for (let trial = 0; trial < 250; trial += 1) {
        const startBox = boxes[Math.floor(next() * boxes.length)] as Rect
        const endBox = boxes[Math.floor(next() * boxes.length)] as Rect
        const skip = [startBox, endBox]
        const from = randomAnchor(boxes, next)
        const to = randomAnchor(boxes, next)
        // 参照：把 skip 从表里剔掉再按老算法判（两端豁免语义与产品实现一致，
        // 这里只比「剔掉 skip 的全表扫」与「网格候选 + skip」是否同结论）。
        const others = boxes.filter((box) => !skip.includes(box))
        expect(bezierBlocked(from, to, boxes, skip)).toBe(bezierBlocked(from, to, others, []))
        const points: [number, number][] = [
          [from.x, from.y],
          [(from.x + to.x) / 2, from.y],
          [(from.x + to.x) / 2, to.y],
          [to.x, to.y],
        ]
        expect(pointsBlocked(points, boxes, skip)).toBe(pointsBlocked(points, others, []))
      }
    })

    it(`orthoRoute 与「线性挑附近卡片」同结果（seed=${seed}）`, () => {
      const next = rng(seed + 4)
      const boxes = randomBoxes(200, next)
      const DIRECTION = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] } as const
      for (let trial = 0; trial < 150; trial += 1) {
        const startBox = boxes[Math.floor(next() * boxes.length)] as Rect
        const endBox = boxes[Math.floor(next() * boxes.length)] as Rect
        const start = randomAnchor(boxes, next)
        const end = randomAnchor(boxes, next)
        // 参照：改动前的 near 是「伸出去 14 的点 ±200」的线性过滤。把过滤好的缩窄数组
        // 原样喂给同一个函数——网格挑出的 near 若与它逐字一致，两次结果必须完全相同。
        const sd = DIRECTION[start.side]
        const ed = DIRECTION[end.side]
        const s1x = start.x + sd[0] * 14
        const s1y = start.y + sd[1] * 14
        const e1x = end.x + ed[0] * 14
        const e1y = end.y + ed[1] * 14
        const nearLinear = boxes.filter(
          (box) =>
            box.x < Math.max(s1x, e1x) + reach &&
            box.x + box.w > Math.min(s1x, e1x) - reach &&
            box.y < Math.max(s1y, e1y) + reach &&
            box.y + box.h > Math.min(s1y, e1y) - reach,
        )
        expect(orthoRoute(start, end, nearLinear, startBox, endBox)).toEqual(
          orthoRoute(start, end, boxes, startBox, endBox),
        )
      }
    })
  }
})

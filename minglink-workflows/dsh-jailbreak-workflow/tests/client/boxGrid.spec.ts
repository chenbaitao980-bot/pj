import { describe, expect, it } from 'vitest'
import { BoxGrid, type GridRect, gridOf } from '../../src/client/model/boxGrid.ts'

/** 造一批随机卡片（含负坐标、大小悬殊、互相重叠）。 */
function randomBoxes(count: number, seed: number): GridRect[] {
  let state = seed >>> 0
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  const boxes: GridRect[] = []
  for (let index = 0; index < count; index += 1) {
    boxes.push({
      x: Math.round(next() * 4000 - 2000),
      y: Math.round(next() * 4000 - 2000),
      w: Math.round(next() * 460 + 40),
      h: Math.round(next() * 400 + 40),
    })
  }
  return boxes
}

const overlaps = (box: GridRect, x1: number, y1: number, x2: number, y2: number): boolean =>
  box.x < Math.max(x1, x2) &&
  box.x + box.w > Math.min(x1, x2) &&
  box.y < Math.max(y1, y2) &&
  box.y + box.h > Math.min(y1, y2)

const crossesColumns = (box: GridRect, x1: number, x2: number): boolean =>
  box.x < Math.max(x1, x2) && box.x + box.w > Math.min(x1, x2)

describe('卡片网格与线性过滤逐字等价', () => {
  for (const seed of [1, 7, 42, 1337]) {
    const boxes = randomBoxes(320, seed)
    const grid = new BoxGrid(boxes)

    it(`overlapping 与 filter 结果一致（seed=${seed}）`, () => {
      for (let trial = 0; trial < 200; trial += 1) {
        const x1 = (trial * 173) % 3000
        const y1 = (trial * 97) % 3000
        const x2 = x1 + ((trial * 53) % 900)
        const y2 = y1 + ((trial * 29) % 700)
        const linear = boxes.filter((box) => overlaps(box, x1, y1, x2, y2))
        expect(grid.overlapping(x1, y1, x2, y2)).toEqual(linear)
      }
    })

    it(`acrossColumns 与只按 x 的 filter 一致（seed=${seed}）`, () => {
      for (let trial = 0; trial < 200; trial += 1) {
        const x1 = (trial * 131) % 2600
        const x2 = x1 + ((trial * 61) % 1200)
        const linear = boxes.filter((box) => crossesColumns(box, x1, x2))
        expect(grid.acrossColumns(x1, x2)).toEqual(linear)
        // 反向给坐标也一样（freeLane 的 x1/x2 可能颠倒）。
        expect(grid.acrossColumns(x2, x1)).toEqual(linear)
      }
    })

    it(`acrossRows 与只按 y 的 filter 一致（seed=${seed}）`, () => {
      for (let trial = 0; trial < 200; trial += 1) {
        const y1 = (trial * 149) % 2600
        const y2 = y1 + ((trial * 71) % 1200)
        const linear = boxes.filter(
          (box) => box.y < Math.max(y1, y2) && box.y + box.h > Math.min(y1, y2),
        )
        expect(grid.acrossRows(y1, y2)).toEqual(linear)
        expect(grid.acrossRows(y2, y1)).toEqual(linear)
      }
    })

    it(`covering 是线性候选的超集且保序（seed=${seed}）`, () => {
      for (let trial = 0; trial < 120; trial += 1) {
        const x1 = (trial * 211) % 2000
        const y1 = (trial * 83) % 2000
        const x2 = x1 + 600
        const y2 = y1 + 400
        const indices = grid.covering(x1, y1, x2, y2)
        for (let i = 1; i < indices.length; i += 1) {
          expect(indices[i] as number).toBeGreaterThan(indices[i - 1] as number)
        }
        for (let index = 0; index < boxes.length; index += 1) {
          const box = boxes[index] as GridRect
          if (overlaps(box, x1, y1, x2, y2)) expect(indices).toContain(index)
        }
      }
    })
  }

  it('gridOf 认数组身份：同一份数组只建一次', () => {
    const boxes = randomBoxes(40, 9)
    const first = gridOf(boxes)
    expect(gridOf(boxes)).toBe(first)
    expect(gridOf([...boxes])).not.toBe(first)
  })

  it('空集合与单卡片边界', () => {
    expect(new BoxGrid([]).overlapping(0, 0, 10, 10)).toEqual([])
    const one = new BoxGrid([{ x: -5, y: -5, w: 10, h: 10 }])
    expect(one.at(0, 0)).toEqual([{ x: -5, y: -5, w: 10, h: 10 }])
    expect(one.at(100, 100)).toEqual([])
  })
})

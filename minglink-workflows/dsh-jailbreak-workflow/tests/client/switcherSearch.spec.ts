import { describe, expect, it } from 'vitest'
import {
  currentFirst,
  filterRuns,
  filterWorkflows,
  matchRange,
  normalizeNeedle,
  visibleRuns,
  visibleWorkflows,
  WORKFLOWS_SHOWN,
} from '../../src/client/model/switcherSearch.ts'

const runs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))

describe('switcherSearch', () => {
  it('normalizes the needle', () => {
    expect(normalizeNeedle('  QW-Loop ')).toBe('qw-loop')
  })

  it('finds the first case-insensitive range, none for an empty needle', () => {
    expect(matchRange('Changelog-HTML', 'html')).toEqual([10, 14])
    expect(matchRange('abc', 'x')).toBeNull()
    expect(matchRange('abc', '')).toBeNull()
  })

  it('filters workflows by name and keeps order', () => {
    const list = [{ name: 'new-1' }, { name: 'qw-loop' }, { name: 'New-2' }]
    expect(filterWorkflows(list, 'new').map((entry) => entry.name)).toEqual(['new-1', 'New-2'])
    expect(filterWorkflows(list, '')).toHaveLength(3)
  })

  it('filters runs on any of the searchable texts', () => {
    const list = [
      { id: 'r1', texts: ['flow-a', '完成', '10-10 14:31'] },
      { id: 'r2', texts: ['flow-b', '运行中', '10-11 09:00'] },
    ]
    const hay = (item: (typeof list)[number]): readonly string[] => item.texts
    expect(filterRuns(list, '运行', hay).map((item) => item.id)).toEqual(['r2'])
    expect(filterRuns(list, '10-10', hay).map((item) => item.id)).toEqual(['r1'])
    expect(filterRuns(list, 'flow', hay)).toHaveLength(2)
    expect(filterRuns(list, 'zzz', hay)).toHaveLength(0)
  })

  it('puts the current run first without reordering the rest', () => {
    expect(currentFirst(runs, 'c').map((item) => item.id)).toEqual(['c', 'a', 'b', 'd', 'e', 'f'])
    expect(currentFirst(runs, undefined).map((item) => item.id)).toEqual(
      runs.map((item) => item.id),
    )
  })

  it('folds runs to the first three plus the one being viewed', () => {
    const folded = visibleRuns(runs, { expanded: false, active: null })
    expect(folded.shown.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(folded.hidden).toBe(3)

    const viewing = visibleRuns(runs, { expanded: false, active: 'e' })
    expect(viewing.shown.map((item) => item.id)).toEqual(['a', 'b', 'c', 'e'])
    expect(viewing.hidden).toBe(2)
  })

  it('shows everything when expanded, or when folding would hide a single run', () => {
    expect(visibleRuns(runs, { expanded: true, active: null }).hidden).toBe(0)
    const four = runs.slice(0, 4)
    expect(visibleRuns(four, { expanded: false, active: null })).toEqual({ shown: four, hidden: 0 })
  })

  it('folds workflows to the first twelve plus the one being edited', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ name: `w${index}` }))
    const folded = visibleWorkflows(many, { expanded: false, current: null })
    expect(folded.shown).toHaveLength(WORKFLOWS_SHOWN)
    expect(folded.shown[0]?.name).toBe('w0')
    expect(folded.hidden).toBe(30 - WORKFLOWS_SHOWN)

    // 正开着的那张即使排在折叠后面也必须露出来（否则选中滑块找不到自己的行）。
    const viewing = visibleWorkflows(many, { expanded: false, current: 'w29' })
    expect(viewing.shown.some((entry) => entry.name === 'w29')).toBe(true)
    expect(viewing.shown).toHaveLength(WORKFLOWS_SHOWN + 1)
    expect(viewing.hidden).toBe(30 - WORKFLOWS_SHOWN - 1)
  })

  it('does not fold workflows when expanded, or when one more row is cheaper than the toggle', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ name: `w${index}` }))
    expect(visibleWorkflows(many, { expanded: true, current: null }).hidden).toBe(0)
    expect(visibleWorkflows(many, { expanded: true, current: null }).shown).toHaveLength(30)

    const justOver = Array.from({ length: WORKFLOWS_SHOWN + 1 }, (_, index) => ({
      name: `w${index}`,
    }))
    expect(visibleWorkflows(justOver, { expanded: false, current: null })).toEqual({
      shown: justOver,
      hidden: 0,
    })
  })

  it('keeps the caller order and never mutates the input', () => {
    const list = [{ name: 'b' }, { name: 'a' }, { name: 'c' }]
    const snapshot = [...list]
    const out = visibleWorkflows(list, { expanded: true, current: null })
    expect(out.shown).toEqual(snapshot)
    expect(list).toEqual(snapshot)
  })
})

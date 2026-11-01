import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { abcClasses, addDays, daysBetween, eachDay, reorderSuggestion } from '../src'

describe('dates', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59)
  })

  it('lists every day in a range, and nothing for a backwards one', () => {
    expect(eachDay('2026-01-30', '2026-02-01')).toEqual(['2026-01-30', '2026-01-31', '2026-02-01'])
    expect(eachDay('2026-02-01', '2026-01-01')).toEqual([])
  })
})

describe('abcClasses', () => {
  it('gives the first 80% of revenue A, the next 15% B, the rest C', () => {
    expect(abcClasses([7000, 1500, 800, 400, 300])).toEqual(['A', 'A', 'B', 'B', 'C'])
  })

  it('keeps results in the order the items came in', () => {
    expect(abcClasses([300, 7000, 400])).toEqual(['C', 'A', 'B'])
  })

  it('never lifts an item that brought in nothing', () => {
    expect(abcClasses([1000, 0, -50])).toEqual(['A', 'C', 'C'])
    expect(abcClasses([0, 0])).toEqual(['C', 'C'])
    expect(abcClasses([])).toEqual([])
  })

  it('always has an A when anything sold, and a bigger item never ranks below a smaller one', () => {
    const rank = { A: 0, B: 1, C: 2 }
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 40 }), (amounts) => {
        const classes = abcClasses(amounts)
        if (amounts.some((amount) => amount > 0)) expect(classes).toContain('A')
        for (const [first, a] of amounts.entries()) {
          for (const [second, b] of amounts.entries()) {
            if (a > b) expect(rank[classes[first]!]).toBeLessThanOrEqual(rank[classes[second]!])
          }
        }
      }),
    )
  })
})

describe('reorderSuggestion', () => {
  it('fills up to twice the level when sales are slow', () => {
    expect(reorderSuggestion(3000, 5000, 1000)).toBe(7000)
  })

  it('covers a month of sales when they are faster', () => {
    expect(reorderSuggestion(3000, 5000, 40_000)).toBe(37_000)
  })

  it('rounds up to whole units, and treats negative stock as none', () => {
    expect(reorderSuggestion(3500, 5000, 0)).toBe(7000)
    expect(reorderSuggestion(-2000, 5000, 0)).toBe(10_000)
  })

  it('suggests nothing when the shelf is already full', () => {
    expect(reorderSuggestion(20_000, 5000, 1000)).toBe(0)
  })
})

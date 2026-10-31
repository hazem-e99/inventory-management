import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  allocateFefo,
  averageCostMinor,
  businessDate,
  issueValue,
  receiptValue,
  toBaseQuantity,
  type LotStock,
} from '../src'

const lot = (lotId: string, expiryDate: string | null, availableMilli: number, createdAt = 1): LotStock => ({
  lotId,
  expiryDate,
  availableMilli,
  createdAt,
})

describe('weighted average value', () => {
  it('values a receipt from thousandths of a unit', () => {
    expect(receiptValue(2500, 1000)).toBe(2500)
    expect(receiptValue(1000, 333)).toBe(333)
    expect(receiptValue(1, 1)).toBe(0)
  })

  it('issues a proportional share of the total value', () => {
    expect(issueValue(5000, 10_000, 1000, 0)).toBe(500)
    expect(issueValue(3000, 10_000, 1000, 0)).toBe(300)
  })

  it('gives the last unit whatever value remains', () => {
    expect(issueValue(10_000, 10_000, 1001, 0)).toBe(1001)
  })

  it('values stock issued beyond what is on hand at the fallback cost', () => {
    expect(issueValue(5000, 0, 0, 200)).toBe(1000)
    expect(issueValue(15_000, 10_000, 1000, 200)).toBe(2000)
  })

  it('stays exact on amounts too large for a float product', () => {
    const value = 900_000_000_000
    expect(issueValue(3_000_000_000, 9_000_000_000, value, 0)).toBe(300_000_000_000)
  })

  it('never leaves value behind once everything has been issued', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 30 }),
        (startQty, startValue, weights) => {
          const total = weights.reduce((sum, weight) => sum + weight, 0)
          let onHand = startQty
          let value = startValue

          weights.forEach((weight, index) => {
            const last = index === weights.length - 1
            const qty = last ? onHand : Math.min(onHand, Math.ceil((startQty * weight) / total))
            if (qty === 0) return
            const issued = issueValue(qty, onHand, value, 0)
            expect(issued).toBeGreaterThanOrEqual(0)
            expect(issued).toBeLessThanOrEqual(value)
            onHand -= qty
            value -= issued
          })

          expect(onHand).toBe(0)
          expect(value).toBe(0)
        },
      ),
    )
  })

  it('reports the average per base unit', () => {
    expect(averageCostMinor(4000, 1000)).toBe(250)
    expect(averageCostMinor(0, 500)).toBe(0)
  })
})

describe('unit conversion', () => {
  it('converts to thousandths of the base unit', () => {
    expect(toBaseQuantity(2000, 10_000)).toBe(20_000)
    expect(toBaseQuantity(1500, 1000)).toBe(1500)
  })

  it('refuses a result that needs more precision than the ledger holds', () => {
    expect(toBaseQuantity(1, 1500)).toBeNull()
  })
})

describe('FEFO allocation', () => {
  const today = '2026-10-31'

  it('takes the nearest expiry first, across lots', () => {
    const lots = [lot('later', '2027-06-01', 5000), lot('soon', '2026-12-01', 3000), lot('none', null, 9000)]
    expect(allocateFefo(lots, 6000, { today })).toEqual({
      allocations: [
        { lotId: 'soon', qtyMilli: 3000 },
        { lotId: 'later', qtyMilli: 3000 },
      ],
      shortageMilli: 0,
    })
  })

  it('takes lots with no expiry last', () => {
    const lots = [lot('none', null, 1000), lot('dated', '2030-01-01', 1000)]
    expect(allocateFefo(lots, 1500, { today }).allocations.map(({ lotId }) => lotId)).toEqual(['dated', 'none'])
  })

  it('skips expired lots unless told otherwise', () => {
    const lots = [lot('expired', '2026-10-30', 5000), lot('good', '2027-01-01', 1000)]
    expect(allocateFefo(lots, 2000, { today })).toEqual({
      allocations: [{ lotId: 'good', qtyMilli: 1000 }],
      shortageMilli: 1000,
    })
    expect(allocateFefo(lots, 2000, { today, includeExpired: true }).allocations[0]).toEqual({
      lotId: 'expired',
      qtyMilli: 2000,
    })
  })

  it('still sells a lot on its expiry date', () => {
    expect(allocateFefo([lot('today', today, 1000)], 1000, { today }).shortageMilli).toBe(0)
  })

  it('breaks ties by the older lot', () => {
    const lots = [lot('new', '2027-01-01', 1000, 9), lot('old', '2027-01-01', 1000, 1)]
    expect(allocateFefo(lots, 500, { today }).allocations[0]?.lotId).toBe('old')
  })

  it('reports a shortage and ignores empty or overdrawn lots', () => {
    expect(allocateFefo([lot('a', null, 0), lot('b', null, -500), lot('c', null, 100)], 300, { today })).toEqual({
      allocations: [{ lotId: 'c', qtyMilli: 100 }],
      shortageMilli: 200,
    })
  })

  it('always allocates exactly what was asked, or reports the difference', () => {
    const lotArbitrary = fc.record({
      lotId: fc.uuid(),
      expiryDate: fc.option(fc.constantFrom('2026-11-01', '2027-01-01', '2028-01-01')),
      availableMilli: fc.integer({ min: 0, max: 100_000 }),
      createdAt: fc.integer({ min: 0, max: 100 }),
    })

    fc.assert(
      fc.property(fc.array(lotArbitrary, { maxLength: 12 }), fc.integer({ min: 1, max: 500_000 }), (lots, qty) => {
        const { allocations, shortageMilli } = allocateFefo(lots, qty, { today })
        const allocated = allocations.reduce((sum, { qtyMilli }) => sum + qtyMilli, 0)
        expect(allocated + shortageMilli).toBe(qty)

        for (const { lotId, qtyMilli } of allocations) {
          expect(qtyMilli).toBeLessThanOrEqual(lots.find((candidate) => candidate.lotId === lotId)!.availableMilli)
        }

        // Nothing later may be touched while an earlier expiry still has stock.
        const dates = allocations.map(({ lotId }) => lots.find((candidate) => candidate.lotId === lotId)!.expiryDate ?? '9999')
        expect(dates).toEqual([...dates].sort())
      }),
    )
  })
})

describe('businessDate', () => {
  it('uses the local calendar day', () => {
    expect(businessDate(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })
})

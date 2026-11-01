import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { costPerBaseUnit, orderProgress, purchaseDocumentTotals, purchaseLineTotals } from '../src'

describe('purchase line totals', () => {
  it('works from quantity, cost, discount and tax', () => {
    expect(purchaseLineTotals({ qtyMilli: 10_000, unitCostMinor: 1000, discountMinor: 500, taxRateBp: 1400 })).toEqual({
      grossMinor: 10_000,
      discountMinor: 500,
      netMinor: 9500,
      taxMinor: 1330,
      totalMinor: 10_830,
    })
  })

  it('handles fractional quantities', () => {
    expect(purchaseLineTotals({ qtyMilli: 1250, unitCostMinor: 2000, discountMinor: 0, taxRateBp: 0 }).netMinor).toBe(2500)
  })

  it('never discounts below zero', () => {
    const totals = purchaseLineTotals({ qtyMilli: 1000, unitCostMinor: 100, discountMinor: 999, taxRateBp: 1400 })
    expect(totals).toMatchObject({ discountMinor: 100, netMinor: 0, taxMinor: 0, totalMinor: 0 })
  })

  it('rounds tax half up', () => {
    expect(purchaseLineTotals({ qtyMilli: 1000, unitCostMinor: 25, discountMinor: 0, taxRateBp: 1400 }).taxMinor).toBe(4)
  })

  it('always adds up, whatever the inputs', () => {
    const line = fc.record({
      qtyMilli: fc.integer({ min: 0, max: 10_000_000 }),
      unitCostMinor: fc.integer({ min: 0, max: 10_000_000 }),
      discountMinor: fc.integer({ min: 0, max: 100_000_000 }),
      taxRateBp: fc.integer({ min: 0, max: 10_000 }),
    })

    fc.assert(
      fc.property(fc.array(line, { maxLength: 40 }), (lines) => {
        const document = purchaseDocumentTotals(lines)
        expect(document.grossMinor - document.discountMinor).toBe(document.netMinor)
        expect(document.netMinor + document.taxMinor).toBe(document.totalMinor)
        expect(document.netMinor).toBeGreaterThanOrEqual(0)

        const summed = lines.map(purchaseLineTotals).reduce((sum, { totalMinor }) => sum + totalMinor, 0)
        expect(document.totalMinor).toBe(summed)
      }),
    )
  })
})

describe('costPerBaseUnit', () => {
  it('divides the net by the base quantity', () => {
    expect(costPerBaseUnit(9500, 10_000)).toBe(950)
    expect(costPerBaseUnit(1000, 3000)).toBe(333)
    expect(costPerBaseUnit(2500, 1250)).toBe(2000)
  })
})

describe('orderProgress', () => {
  it('reads the state of an order from its lines', () => {
    expect(orderProgress([{ orderedMilli: 5000, receivedMilli: 0 }])).toBe('open')
    expect(orderProgress([{ orderedMilli: 5000, receivedMilli: 2000 }])).toBe('partial')
    expect(orderProgress([{ orderedMilli: 5000, receivedMilli: 5000 }])).toBe('received')
    expect(
      orderProgress([
        { orderedMilli: 5000, receivedMilli: 5000 },
        { orderedMilli: 1000, receivedMilli: 0 },
      ]),
    ).toBe('partial')
  })
})

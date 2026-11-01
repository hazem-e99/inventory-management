import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { allocateDiscount, gs1CheckDigit, parseScaleBarcode, priceForUnit, priceSale, returnShare, saleLineTotals, settle } from '../src'

describe('saleLineTotals', () => {
  it('takes the tax out of a price that already includes it', () => {
    expect(saleLineTotals({ qtyMilli: 1000, unitPriceMinor: 11_400, discountMinor: 0, taxRateBp: 1400 })).toEqual({
      grossMinor: 11_400,
      discountMinor: 0,
      taxMinor: 1400,
      totalMinor: 11_400,
    })
  })

  it('caps a discount at the line, so a total never goes negative', () => {
    expect(saleLineTotals({ qtyMilli: 1000, unitPriceMinor: 500, discountMinor: 900, taxRateBp: 0 }).totalMinor).toBe(0)
  })

  it('prices fractions of a unit', () => {
    expect(saleLineTotals({ qtyMilli: 1250, unitPriceMinor: 8000, discountMinor: 0, taxRateBp: 0 }).totalMinor).toBe(10_000)
  })
})

describe('allocateDiscount', () => {
  it('splits by size and hands out the leftover pennies', () => {
    expect(allocateDiscount([100, 100, 100], 100)).toEqual([34, 33, 33])
    expect(allocateDiscount([300, 100], 100)).toEqual([75, 25])
  })

  it('always adds up to exactly the discount, and never exceeds a line', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 30 }), fc.integer({ min: 0, max: 40_000_000 }), (amounts, discount) => {
        const shares = allocateDiscount(amounts, discount)
        const total = amounts.reduce((sum, amount) => sum + amount, 0)
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(Math.min(discount, total))
        shares.forEach((share, index) => expect(share).toBeLessThanOrEqual(amounts[index]!))
      }),
    )
  })
})

describe('priceSale', () => {
  it('carries the invoice discount down to the lines', () => {
    const { lines, totals } = priceSale(
      [
        { qtyMilli: 1000, unitPriceMinor: 3000, discountMinor: 0, taxRateBp: 0 },
        { qtyMilli: 1000, unitPriceMinor: 1000, discountMinor: 0, taxRateBp: 0 },
      ],
      400,
    )
    expect(lines.map(({ sharedDiscountMinor }) => sharedDiscountMinor)).toEqual([300, 100])
    expect(totals).toEqual({ grossMinor: 4000, discountMinor: 400, taxMinor: 0, totalMinor: 3600 })
  })
})

describe('settle', () => {
  it('gives change from cash', () => {
    expect(settle(9500, [{ method: 'cash', amountMinor: 10_000 }])).toEqual({ ok: true, changeMinor: 500, cashKeptMinor: 9500, creditMinor: 0 })
  })

  it('accepts a mix of tenders, and keeps only the cash that stayed in the drawer', () => {
    expect(
      settle(10_000, [
        { method: 'card', amountMinor: 4000 },
        { method: 'cash', amountMinor: 3000 },
        { method: 'credit', amountMinor: 3000 },
      ]),
    ).toEqual({ ok: true, changeMinor: 0, cashKeptMinor: 3000, creditMinor: 3000 })
  })

  it('refuses too little, and a card that overpays', () => {
    expect(settle(10_000, [{ method: 'cash', amountMinor: 9999 }])).toEqual({ ok: false, reason: 'short' })
    expect(settle(10_000, [{ method: 'card', amountMinor: 10_001 }])).toEqual({ ok: false, reason: 'over' })
  })

  it('never keeps more than the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.record({ method: fc.constantFrom('cash', 'card', 'wallet', 'credit'), amountMinor: fc.integer({ min: 0, max: 1_000_000 }) }), { maxLength: 6 }),
        (total, tenders) => {
          const result = settle(total, tenders as Parameters<typeof settle>[1])
          if (!result.ok) return
          const others = tenders.filter(({ method }) => method !== 'cash').reduce((sum, { amountMinor }) => sum + amountMinor, 0)
          expect(result.cashKeptMinor + others).toBe(total)
          expect(result.cashKeptMinor).toBeGreaterThanOrEqual(0)
          expect(result.changeMinor).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })
})

describe('returnShare', () => {
  it('refunds a proportion, and the last piece takes what is left', () => {
    expect(returnShare(1000, 0, 3000, 0, 1000)).toBe(333)
    expect(returnShare(1000, 333, 3000, 1000, 1000)).toBe(334)
    expect(returnShare(1000, 667, 3000, 2000, 1000)).toBe(333)
  })

  it('adds back up to the line however it is split', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 12 }), (total, pieces) => {
        const sold = pieces.reduce((sum, piece) => sum + piece, 0)
        let returned = 0
        let done = 0
        for (const piece of pieces) {
          const share = returnShare(total, done, sold, returned, piece)
          expect(share).toBeGreaterThanOrEqual(0)
          done += share
          returned += piece
        }
        expect(done).toBe(total)
      }),
    )
  })
})

describe('priceForUnit', () => {
  const prices = [
    { unitId: 'piece', amountMinor: 500 },
    { unitId: 'box', amountMinor: 2000 },
  ]

  it('prefers the unit own price, then the base price times its size', () => {
    expect(priceForUnit(prices, 'box', 'piece', 5000)).toBe(2000)
    expect(priceForUnit(prices, 'carton', 'piece', 12_000)).toBe(6000)
  })

  it('has no answer when nothing is priced', () => {
    expect(priceForUnit([], 'piece', 'piece', 1000)).toBeNull()
  })
})

describe('parseScaleBarcode', () => {
  const label = (body: string) => body + String(gs1CheckDigit(body))

  it('reads the item and the weight in grams', () => {
    expect(parseScaleBarcode(label('212345601250'))).toEqual({ itemCode: '2123456', qtyMilli: 1250 })
  })

  it('leaves everything else alone', () => {
    expect(parseScaleBarcode('6221234567890')).toBeNull()
    expect(parseScaleBarcode(label('200000000123'))).toBeNull()
    expect(parseScaleBarcode('2123456012500')).toBeNull()
    expect(parseScaleBarcode(label('212345600000'))).toBeNull()
  })
})

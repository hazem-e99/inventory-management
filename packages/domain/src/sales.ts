import { gs1CheckDigit } from './barcode'
import { receiptValue } from './stock'

export interface SaleLineAmounts {
  qtyMilli: number
  unitPriceMinor: number
  discountMinor: number
  taxRateBp: number
}

export interface SaleTotals {
  grossMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
}

const BASIS_POINTS = 10_000

function divideRounded(numerator: bigint, divisor: bigint): number {
  return Number((numerator * 2n + divisor) / (divisor * 2n))
}

/** A shelf price already contains VAT, so the tax is the part of the total above the net. */
function includedTax(totalMinor: number, rateBp: number): number {
  return divideRounded(BigInt(totalMinor) * BigInt(rateBp), BigInt(BASIS_POINTS + rateBp))
}

export function saleLineTotals(line: SaleLineAmounts): SaleTotals {
  const grossMinor = receiptValue(line.qtyMilli, line.unitPriceMinor)
  const discountMinor = Math.min(line.discountMinor, grossMinor)
  const totalMinor = grossMinor - discountMinor
  return { grossMinor, discountMinor, taxMinor: includedTax(totalMinor, line.taxRateBp), totalMinor }
}

/**
 * Splits a discount across amounts by largest remainder, so the shares add up to it exactly.
 * A return then gives back what that line really cost the customer.
 */
export function allocateDiscount(amounts: readonly number[], discountMinor: number): number[] {
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  if (total === 0 || discountMinor === 0) return amounts.map(() => 0)

  const capped = BigInt(Math.min(discountMinor, total))
  const exact = amounts.map((amount) => BigInt(amount) * capped)
  const shares = exact.map((value) => Number(value / BigInt(total)))
  const assigned = shares.reduce((sum, share) => sum + share, 0)

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value % BigInt(total) }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1))

  for (let index = 0; index < Number(capped) - assigned; index++) {
    shares[byRemainder[index]!.index]! += 1
  }
  return shares
}

export interface PricedLine extends SaleTotals {
  /** This line's share of the discount on the whole invoice. */
  sharedDiscountMinor: number
}

export function priceSale(lines: readonly SaleLineAmounts[], documentDiscountMinor: number) {
  const before = lines.map(saleLineTotals)
  const shares = allocateDiscount(before.map(({ totalMinor }) => totalMinor), documentDiscountMinor)

  const priced = lines.map((line, index): PricedLine => {
    const totals = saleLineTotals({ ...line, discountMinor: before[index]!.discountMinor + shares[index]! })
    return { ...totals, sharedDiscountMinor: shares[index]! }
  })

  const totals = priced.reduce<SaleTotals>(
    (sum, line) => ({
      grossMinor: sum.grossMinor + line.grossMinor,
      discountMinor: sum.discountMinor + line.discountMinor,
      taxMinor: sum.taxMinor + line.taxMinor,
      totalMinor: sum.totalMinor + line.totalMinor,
    }),
    { grossMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 },
  )
  return { lines: priced, totals }
}

export type TenderMethod = 'cash' | 'card' | 'wallet' | 'credit'

export interface Tender {
  method: TenderMethod
  amountMinor: number
}

export type Settlement =
  | { ok: true; changeMinor: number; cashKeptMinor: number; creditMinor: number }
  | { ok: false; reason: 'short' | 'over' }

/** Only cash can be handed back, so every other tender has to fit inside the total. */
export function settle(totalMinor: number, tenders: readonly Tender[]): Settlement {
  const sumOf = (test: (tender: Tender) => boolean) =>
    tenders.filter(test).reduce((sum, tender) => sum + tender.amountMinor, 0)

  const cash = sumOf(({ method }) => method === 'cash')
  const other = sumOf(({ method }) => method !== 'cash')
  if (other > totalMinor) return { ok: false, reason: 'over' }
  if (cash + other < totalMinor) return { ok: false, reason: 'short' }

  const changeMinor = cash + other - totalMinor
  return { ok: true, changeMinor, cashKeptMinor: cash - changeMinor, creditMinor: sumOf(({ method }) => method === 'credit') }
}

/**
 * What a return of `qtyMilli` is worth. Taken from the running total, so a line returned in
 * pieces adds back up to exactly what it was sold for, with no rounding left over.
 */
export function returnShare(
  totalMinor: number,
  doneMinor: number,
  soldMilli: number,
  returnedMilli: number,
  qtyMilli: number,
): number {
  const after = returnedMilli + qtyMilli
  if (after >= soldMilli) return totalMinor - doneMinor
  return divideRounded(BigInt(totalMinor) * BigInt(after), BigInt(soldMilli)) - doneMinor
}

export interface UnitPrice {
  unitId: string
  amountMinor: number
}

/** A unit without its own price sells at the base price times its size. */
export function priceForUnit(
  prices: readonly UnitPrice[],
  unitId: string,
  baseUnitId: string,
  factorMilli: number,
): number | null {
  const own = prices.find((price) => price.unitId === unitId)
  if (own) return own.amountMinor
  const base = prices.find((price) => price.unitId === baseUnitId)
  return base ? receiptValue(factorMilli, base.amountMinor) : null
}

export interface ScaleBarcode {
  /** What the item's barcode is registered as: the prefix and the item number. */
  itemCode: string
  qtyMilli: number
}

/** Scale labels are EAN-13: 2X, a five-digit item, five digits of grams, and a check digit. */
export function parseScaleBarcode(code: string): ScaleBarcode | null {
  if (!/^2[1-9]\d{11}$/.test(code)) return null
  if (gs1CheckDigit(code.slice(0, 12)) !== Number(code[12])) return null
  const qtyMilli = Number(code.slice(7, 12))
  return qtyMilli > 0 ? { itemCode: code.slice(0, 7), qtyMilli } : null
}

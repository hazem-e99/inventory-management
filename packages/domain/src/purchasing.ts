import { receiptValue } from './stock'

export interface PurchaseLineAmounts {
  qtyMilli: number
  unitCostMinor: number
  discountMinor: number
  taxRateBp: number
}

export interface PurchaseTotals {
  grossMinor: number
  discountMinor: number
  netMinor: number
  taxMinor: number
  totalMinor: number
}

const BASIS_POINTS = 10_000

function roundedShare(amount: number, rateBp: number): number {
  return Number((BigInt(amount) * BigInt(rateBp) + BigInt(BASIS_POINTS / 2)) / BigInt(BASIS_POINTS))
}

/**
 * What stock is worth is the net: recoverable VAT is owed to the supplier but isn't a cost
 * of the goods, so it belongs on the payable and never in the inventory value.
 */
export function purchaseLineTotals(line: PurchaseLineAmounts): PurchaseTotals {
  const grossMinor = receiptValue(line.qtyMilli, line.unitCostMinor)
  const discountMinor = Math.min(line.discountMinor, grossMinor)
  const netMinor = grossMinor - discountMinor
  const taxMinor = roundedShare(netMinor, line.taxRateBp)
  return { grossMinor, discountMinor, netMinor, taxMinor, totalMinor: netMinor + taxMinor }
}

export function purchaseDocumentTotals(lines: readonly PurchaseLineAmounts[]): PurchaseTotals {
  return lines.map(purchaseLineTotals).reduce(
    (sum, line) => ({
      grossMinor: sum.grossMinor + line.grossMinor,
      discountMinor: sum.discountMinor + line.discountMinor,
      netMinor: sum.netMinor + line.netMinor,
      taxMinor: sum.taxMinor + line.taxMinor,
      totalMinor: sum.totalMinor + line.totalMinor,
    }),
    { grossMinor: 0, discountMinor: 0, netMinor: 0, taxMinor: 0, totalMinor: 0 },
  )
}

/** The price of one base unit, which is what the next purchase and the fallback cost read. */
export function costPerBaseUnit(netMinor: number, baseQtyMilli: number): number {
  return Number((BigInt(netMinor) * 1000n + BigInt(baseQtyMilli) / 2n) / BigInt(baseQtyMilli))
}

export type OrderProgress = 'open' | 'partial' | 'received'

export function orderProgress(lines: ReadonlyArray<{ orderedMilli: number; receivedMilli: number }>): OrderProgress {
  if (lines.every(({ receivedMilli }) => receivedMilli === 0)) return 'open'
  return lines.every(({ orderedMilli, receivedMilli }) => receivedMilli >= orderedMilli) ? 'received' : 'partial'
}

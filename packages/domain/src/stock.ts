const MILLI = 1000n

/** Rounds half up, using BigInt so a large value times a large quantity can't lose precision. */
function mulDivRound(a: number, b: number, divisor: bigint): number {
  const product = BigInt(a) * BigInt(b)
  const half = divisor / 2n
  const rounded = product >= 0n ? (product + half) / divisor : -((-product + half) / divisor)
  return Number(rounded)
}

export function receiptValue(qtyMilli: number, unitCostMinor: number): number {
  return mulDivRound(qtyMilli, unitCostMinor, MILLI)
}

/**
 * Moving weighted average, carried as the total value rather than a unit cost. A stored unit
 * cost would round on every movement and drift; a share of the total can't, because the last
 * unit out takes whatever value remains. Stock beyond what is on hand, which only happens when
 * negative stock is allowed, is valued at the fallback cost.
 */
export function issueValue(
  qtyMilli: number,
  onHandMilli: number,
  valueMinor: number,
  fallbackCostMinor: number,
): number {
  if (onHandMilli <= 0) return receiptValue(qtyMilli, fallbackCostMinor)
  if (qtyMilli >= onHandMilli) {
    return valueMinor + receiptValue(qtyMilli - onHandMilli, fallbackCostMinor)
  }
  return mulDivRound(valueMinor, qtyMilli, BigInt(onHandMilli))
}

export function averageCostMinor(onHandMilli: number, valueMinor: number): number {
  return onHandMilli > 0 ? mulDivRound(valueMinor, 1000, BigInt(onHandMilli)) : 0
}

/** Null when the result isn't a whole number of thousandths of the base unit. */
export function toBaseQuantity(qtyMilli: number, factorMilli: number): number | null {
  const product = BigInt(qtyMilli) * BigInt(factorMilli)
  return product % MILLI === 0n ? Number(product / MILLI) : null
}

export const isWholeQuantity = (qtyMilli: number): boolean => qtyMilli % 1000 === 0

export interface LotStock {
  lotId: string
  expiryDate: string | null
  availableMilli: number
  createdAt: number
}

export interface LotAllocation {
  lotId: string
  qtyMilli: number
}

export interface FefoOptions {
  /** `YYYY-MM-DD`. Lots expiring before this are not issued unless `includeExpired` is set. */
  today: string
  includeExpired?: boolean
}

function byExpiryThenAge(a: LotStock, b: LotStock): number {
  if (a.expiryDate !== b.expiryDate) {
    if (a.expiryDate === null) return 1
    if (b.expiryDate === null) return -1
    return a.expiryDate < b.expiryDate ? -1 : 1
  }
  return a.createdAt - b.createdAt || a.lotId.localeCompare(b.lotId)
}

/** First expired, first out: the nearest expiry leaves the shelf first. */
export function allocateFefo(
  lots: readonly LotStock[],
  qtyMilli: number,
  options: FefoOptions,
): { allocations: LotAllocation[]; shortageMilli: number } {
  const usable = lots
    .filter(({ availableMilli }) => availableMilli > 0)
    .filter(({ expiryDate }) => options.includeExpired || expiryDate === null || expiryDate >= options.today)
    .sort(byExpiryThenAge)

  const allocations: LotAllocation[] = []
  let remaining = qtyMilli

  for (const lot of usable) {
    if (remaining === 0) break
    const taken = Math.min(remaining, lot.availableMilli)
    allocations.push({ lotId: lot.lotId, qtyMilli: taken })
    remaining -= taken
  }

  return { allocations, shortageMilli: remaining }
}

/** The shop's calendar day, in local time, which is what a daily report means by "today". */
export function businessDate(now: number): string {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

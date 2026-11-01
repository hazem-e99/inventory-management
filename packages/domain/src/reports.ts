const DAY_MS = 86_400_000
const MILLI = 1000

const toEpoch = (date: string): number => Date.parse(`${date}T00:00:00Z`)
const toDate = (epoch: number): string => new Date(epoch).toISOString().slice(0, 10)

export const addDays = (date: string, days: number): string => toDate(toEpoch(date) + days * DAY_MS)

export const daysBetween = (from: string, to: string): number => Math.round((toEpoch(to) - toEpoch(from)) / DAY_MS)

/** Every day in a range, so a day without sales shows as zero rather than vanishing. */
export function eachDay(from: string, to: string): string[] {
  const count = daysBetween(from, to) + 1
  return Array.from({ length: Math.max(count, 0) }, (_, index) => addDays(from, index))
}

export type AbcClass = 'A' | 'B' | 'C'

const A_SHARE_BP = 8000
const B_SHARE_BP = 9500

/**
 * A is what brings in the first 80% of revenue, B the next 15%, C the rest. An item takes the
 * class of the share it starts in, so the item that crosses a line still counts as the higher
 * one. Items that brought in nothing are always C. Amounts come back in the order they went in.
 */
export function abcClasses(amounts: readonly number[]): AbcClass[] {
  const total = amounts.reduce((sum, amount) => sum + Math.max(amount, 0), 0)
  const order = amounts.map((amount, index) => ({ amount, index })).sort((a, b) => b.amount - a.amount || a.index - b.index)
  const classes = amounts.map((): AbcClass => 'C')

  let before = 0
  for (const { amount, index } of order) {
    if (amount <= 0 || total === 0) break
    const shareBp = Number((BigInt(before) * 10_000n) / BigInt(total))
    classes[index] = shareBp < A_SHARE_BP ? 'A' : shareBp < B_SHARE_BP ? 'B' : 'C'
    before += amount
  }
  return classes
}

/**
 * How much to order: enough for the shop's last month of sales or twice the reorder level,
 * whichever is more, less what is on the shelf, up to a whole unit.
 */
export function reorderSuggestion(onHandMilli: number, levelMilli: number, soldLastMonthMilli: number): number {
  const target = Math.max(levelMilli * 2, soldLastMonthMilli)
  const needed = target - Math.max(onHandMilli, 0)
  return needed <= 0 ? 0 : Math.ceil(needed / MILLI) * MILLI
}

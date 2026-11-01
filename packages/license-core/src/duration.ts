export const DURATION_UNITS = ['day', 'week', 'month', 'year'] as const
export type DurationUnit = (typeof DURATION_UNITS)[number]

const DAY_MS = 86_400_000

/** A month from 31 January lands on the last day of February, not in March. */
function addMonths(from: number, months: number): number {
  const date = new Date(from)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.getTime()
}

export function addDuration(from: number, amount: number, unit: DurationUnit): number {
  if (unit === 'day') return from + amount * DAY_MS
  if (unit === 'week') return from + amount * 7 * DAY_MS
  return addMonths(from, unit === 'month' ? amount : amount * 12)
}

/** Renewing early adds to what is left, so a customer never loses days by paying on time. */
export function renewedExpiry(expiresAt: number | null, now: number, amount: number, unit: DurationUnit): number {
  return addDuration(Math.max(now, expiresAt ?? now), amount, unit)
}

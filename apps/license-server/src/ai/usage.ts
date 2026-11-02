import { createHmac, timingSafeEqual } from 'node:crypto'
import { sql, type Kysely } from 'kysely'
import type { LicenseRecord } from '../licenses'
import type { LicenseDatabase } from '../schema'
import { costMicros } from './pricing'
import type { AiUsage } from './provider'

const DAY_MS = 86_400_000

const monthStart = (now: number) => {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

/** Worked out rather than stored, so a leaked database hands over no device keys. */
export function aiKeyFor(serialKey: string, license: LicenseRecord): string {
  return createHmac('sha256', serialKey).update(`ai:${license.ai_key_version}:${license.id}:${license.fingerprint}`).digest('base64url')
}

export function aiKeyMatches(serialKey: string, license: LicenseRecord, presented: string): boolean {
  const expected = Buffer.from(aiKeyFor(serialKey, license))
  const given = Buffer.from(presented)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export async function recordUsage(db: Kysely<LicenseDatabase>, licenseId: string, feature: string, usage: AiUsage, succeeded: boolean, now: number) {
  const cost = costMicros(usage, now)
  await db
    .insertInto('ai_usage')
    .values({
      license_id: licenseId,
      feature,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cost_micros: cost,
      succeeded,
      occurred_at: now,
    })
    .execute()
  return cost
}

/** Only what worked counts against the shop. An unreadable answer is still on your bill. */
export async function usedThisMonth(db: Kysely<LicenseDatabase>, licenseId: string, now: number): Promise<number> {
  const row = await db
    .selectFrom('ai_usage')
    .select(sql<number>`count(*)`.as('used'))
    .where('license_id', '=', licenseId)
    .where('succeeded', '=', true)
    .where('occurred_at', '>=', monthStart(now))
    .executeTakeFirstOrThrow()
  return Number(row.used)
}

export async function spentTodayMicros(db: Kysely<LicenseDatabase>, now: number): Promise<number> {
  const row = await db
    .selectFrom('ai_usage')
    .select(sql<number>`coalesce(sum(cost_micros), 0)`.as('spent'))
    .where('occurred_at', '>=', now - (now % DAY_MS))
    .executeTakeFirstOrThrow()
  return Number(row.spent)
}

/** What each shop cost you this month, for pricing the add-on from real numbers. */
export async function monthlyUsage(db: Kysely<LicenseDatabase>, now: number) {
  const rows = await db
    .selectFrom('ai_usage')
    .innerJoin('licenses', 'licenses.id', 'ai_usage.license_id')
    .innerJoin('customers', 'customers.id', 'licenses.customer_id')
    .select([
      'licenses.id as license_id',
      'customers.name as customer_name',
      'licenses.ai_monthly_limit',
      sql<number>`count(*) filter (where ai_usage.succeeded)`.as('requests'),
      sql<number>`count(*) filter (where not ai_usage.succeeded)`.as('failures'),
      sql<number>`sum(ai_usage.input_tokens)`.as('input_tokens'),
      sql<number>`sum(ai_usage.output_tokens)`.as('output_tokens'),
      sql<number>`sum(ai_usage.cost_micros)`.as('cost_micros'),
    ])
    .where('ai_usage.occurred_at', '>=', monthStart(now))
    .groupBy(['licenses.id', 'customers.name', 'licenses.ai_monthly_limit'])
    .orderBy(sql`sum(ai_usage.cost_micros)`, 'desc')
    .execute()

  return rows.map((row) => ({
    licenseId: row.license_id,
    customerName: row.customer_name,
    monthlyLimit: row.ai_monthly_limit,
    requests: Number(row.requests),
    failures: Number(row.failures),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    costMicros: Number(row.cost_micros),
  }))
}

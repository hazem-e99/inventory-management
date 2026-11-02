import { AI_MEDIA_TYPES } from '@inv/license-core'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { ApiError, type ServerDeps, type ServerEnv } from '../app'
import type { LicenseRecord } from '../licenses'
import { AiUnreadable } from './provider'
import { aiKeyMatches, aiKeyFor, recordUsage, spentTodayMicros, usedThisMonth } from './usage'
import { rateLimiter } from '../rate-limit'

const REQUESTS_PER_MINUTE = 20
const MAX_BODY_BYTES = 14 * 1024 * 1024

const invoiceSchema = z.object({
  mimeType: z.enum(AI_MEDIA_TYPES),
  data: z.string().min(1),
})

/** What a device learns at check-in. The key only leaves for a license allowed to spend. */
export async function deviceAiStatus(deps: ServerDeps, license: LicenseRecord) {
  if (!license.ai_enabled) return { enabled: false as const }
  return {
    enabled: true as const,
    key: aiKeyFor(deps.serialKey, license),
    monthlyLimit: license.ai_monthly_limit,
    used: await usedThisMonth(deps.db, license.id, deps.clock()),
  }
}

/** Every step here spends your money, so each check runs before the model is called. */
export function aiRoutes(deps: ServerDeps) {
  const app = new Hono<ServerEnv>()
  const allow = rateLimiter(REQUESTS_PER_MINUTE, deps.clock)

  async function licensed(licenseId: string | undefined, authorization: string | undefined): Promise<LicenseRecord> {
    if (!licenseId || !authorization?.startsWith('Bearer ')) throw new ApiError('AI_KEY_INVALID', 401)

    const license = await deps.db.selectFrom('licenses').selectAll().where('id', '=', licenseId).executeTakeFirst()
    if (!license?.fingerprint || !aiKeyMatches(deps.serialKey, license, authorization.slice('Bearer '.length))) {
      throw new ApiError('AI_KEY_INVALID', 401)
    }
    if (!license.ai_enabled) throw new ApiError('AI_NOT_ENABLED', 403)
    if (license.state !== 'active' || Number(license.expires_at) <= deps.clock()) throw new ApiError('LICENSE_SUSPENDED', 403)
    return license
  }

  app.post(
    '/invoice',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new ApiError('AI_FILE_TOO_LARGE', 413)
      },
    }),
    async (c) => {
      const { ai } = deps
      if (!ai) throw new ApiError('AI_DISABLED', 503)

      const license = await licensed(c.req.header('x-license-id'), c.req.header('authorization'))
      if (!allow(license.id)) throw new ApiError('RATE_LIMITED', 429)

      const parsed = invoiceSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 422)

      const now = deps.clock()
      const used = await usedThisMonth(deps.db, license.id, now)
      if (used >= license.ai_monthly_limit) throw new ApiError('AI_QUOTA_EXCEEDED', 429)
      if ((await spentTodayMicros(deps.db, now)) >= ai.dailyBudgetMicros) throw new ApiError('AI_BUDGET_EXCEEDED', 503)

      try {
        const { invoice, usage } = await ai.provider.readInvoice(parsed.data)
        await recordUsage(deps.db, license.id, 'invoice', usage, true, now)
        return c.json({ invoice, used: used + 1, monthlyLimit: license.ai_monthly_limit })
      } catch (error) {
        if (error instanceof AiUnreadable) {
          await recordUsage(deps.db, license.id, 'invoice', error.usage, false, now)
          throw new ApiError('AI_UNREADABLE', 422)
        }
        // The file itself never reaches the log: only that a call failed, and why.
        deps.logError('AI provider failed', { licenseId: license.id, message: error instanceof Error ? error.message : String(error) })
        throw new ApiError('AI_UNAVAILABLE', 502)
      }
    },
  )

  return app
}

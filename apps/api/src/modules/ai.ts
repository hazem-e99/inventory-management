import { createRoute } from '@hono/zod-openapi'
import { aiConsentSchema, aiStatusSchema, type AiStatus } from '@inv/contracts'
import { auditRepo } from '@inv/db'
import type { AppDeps } from '../http/context'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { storeSettings } from './store'

/** The device key stays in its settings row: nothing a screen asks for ever carries it. */
async function statusOf(deps: AppDeps): Promise<AiStatus> {
  const access = await storeSettings(deps.db).ai()
  return { available: access.enabled, consentedAt: access.consentedAt, used: access.used, monthlyLimit: access.monthlyLimit }
}

export function aiRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]

  const readRoute = createRoute({
    method: 'get',
    path: '/ai',
    middleware: guard,
    responses: { 200: jsonOk(aiStatusSchema) },
  })

  const consentRoute = createRoute({
    method: 'put',
    path: '/ai/consent',
    middleware: [...guard, requirePermission('settings.manage')],
    request: { body: jsonBody(aiConsentSchema) },
    responses: { 200: jsonOk(aiStatusSchema) },
  })

  return router()
    .openapi(readRoute, async (c) => c.json(await statusOf(deps), 200))
    .openapi(consentRoute, async (c) => {
      const { accepted } = c.req.valid('json')
      const now = deps.clock()
      const settings = storeSettings(deps.db)

      await settings.setAi({ ...(await settings.ai()), consentedAt: accepted ? now : null }, now)
      await auditRepo(deps.db).record({ actorId: c.get('actor').id, action: accepted ? 'ai.consent_given' : 'ai.consent_withdrawn', occurredAt: now })
      return c.json(await statusOf(deps), 200)
    })
}

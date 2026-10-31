import { createRoute } from '@hono/zod-openapi'
import { preferencesSchema, settingsSchema, stockPolicySchema, storeSchema, updateStoreSchema } from '@inv/contracts'
import { auditRepo } from '@inv/db'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { storeSettings } from './store'

export function settingsRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]

  const readRoute = createRoute({
    method: 'get',
    path: '/settings',
    middleware: guard,
    responses: { 200: jsonOk(settingsSchema) },
  })

  const updateStoreRoute = createRoute({
    method: 'put',
    path: '/settings/store',
    middleware: [...guard, requirePermission('settings.manage')] as const,
    request: { body: jsonBody(updateStoreSchema) },
    responses: { 200: jsonOk(storeSchema) },
  })

  // Device-level and harmless, so the language can be changed from the sign-in screen.
  const updatePreferencesRoute = createRoute({
    method: 'put',
    path: '/settings/preferences',
    request: { body: jsonBody(preferencesSchema) },
    responses: { 200: jsonOk(preferencesSchema) },
  })

  const updateStockPolicyRoute = createRoute({
    method: 'put',
    path: '/settings/stock-policy',
    middleware: [...guard, requirePermission('settings.manage')],
    request: { body: jsonBody(stockPolicySchema) },
    responses: { 200: jsonOk(stockPolicySchema) },
  })

  return router()
    .openapi(readRoute, async (c) => {
      const settings = storeSettings(deps.db)
      const store = await settings.store()
      if (!store) throw new AppError('NOT_ONBOARDED')
      return c.json(
        {
          store,
          preferences: await settings.preferences(),
          features: await settings.features(),
          stockPolicy: await settings.stockPolicy(),
        },
        200,
      )
    })
    .openapi(updateStoreRoute, async (c) => {
      const input = c.req.valid('json')
      const now = deps.clock()

      const updated = await deps.db.transaction().execute(async (trx) => {
        const settings = storeSettings(trx)
        const current = await settings.store()
        if (!current) throw new AppError('NOT_ONBOARDED')

        const store = {
          ...current,
          name: input.name,
          phone: input.phone ?? null,
          address: input.address ?? null,
          taxNumber: input.taxNumber ?? null,
        }
        await settings.setStore(store, now)
        await auditRepo(trx).record({
          actorId: c.get('actor').id,
          action: 'store.updated',
          occurredAt: now,
        })
        return store
      })
      return c.json(updated, 200)
    })
    .openapi(updateStockPolicyRoute, async (c) => {
      const policy = c.req.valid('json')
      const now = deps.clock()
      await storeSettings(deps.db).setStockPolicy(policy, now)
      await auditRepo(deps.db).record({
        actorId: c.get('actor').id,
        action: 'store.stock_policy_changed',
        details: policy,
        occurredAt: now,
      })
      return c.json(policy, 200)
    })
    .openapi(updatePreferencesRoute, async (c) => {
      const preferences = c.req.valid('json')
      await storeSettings(deps.db).setPreferences(preferences, deps.clock())
      return c.json(preferences, 200)
    })
}

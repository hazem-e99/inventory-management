import { createRoute } from '@hono/zod-openapi'
import {
  bootstrapSchema,
  onboardingResultSchema,
  onboardingSchema,
  SYSTEM_ROLES,
  type Store,
} from '@inv/contracts'
import { auditRepo, newId, rolesRepo, usersRepo } from '@inv/db'
import { formatRecoveryCode, generateRecoveryCode, wrapKey } from '@inv/db/backup'
import { BUSINESS_PRESETS, OWNER_ROLE_ID, SYSTEM_ROLE_DEFAULTS } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { hashSecret } from '../http/passwords'
import { jsonBody, jsonOk, router } from '../http/routing'
import { loadActor, openSession } from '../http/session'
import { storeSettings } from './store'

const bootstrapRoute = createRoute({
  method: 'get',
  path: '/bootstrap',
  responses: { 200: jsonOk(bootstrapSchema) },
})

const onboardingRoute = createRoute({
  method: 'post',
  path: '/onboarding',
  request: { body: jsonBody(onboardingSchema) },
  responses: { 200: jsonOk(onboardingResultSchema) },
})

export function onboardingRoutes(deps: AppDeps) {
  return router()
    .openapi(bootstrapRoute, async (c) => {
      const settings = storeSettings(deps.db)
      const store = await settings.store()
      return c.json(
        {
          onboarded: store !== null,
          store,
          preferences: await settings.preferences(),
          version: deps.version,
        },
        200,
      )
    })
    .openapi(onboardingRoute, async (c) => {
      const input = c.req.valid('json')
      if ((await storeSettings(deps.db).store()) !== null) throw new AppError('ALREADY_ONBOARDED')

      const passwordHash = await hashSecret(input.owner.password)
      const recoveryCode = generateRecoveryCode()
      const envelope = await wrapKey(deps.databaseKey, recoveryCode)
      const now = deps.clock()
      const ownerId = newId()

      const store: Store = {
        name: input.store.name,
        businessType: input.store.businessType,
        phone: input.store.phone ?? null,
        address: input.store.address ?? null,
        taxNumber: input.store.taxNumber ?? null,
        currency: 'EGP',
      }

      const session = await deps.db.transaction().execute(async (trx) => {
        const roles = rolesRepo(trx)
        for (const [index, id] of SYSTEM_ROLES.entries()) {
          // The offset keeps owner-to-cashier order, since listing sorts by creation time.
          await roles.insert({ id, name: id, is_system: 1, created_at: now + index })
          // The owner's permissions are implicit, so storing them would only let them drift.
          if (id !== OWNER_ROLE_ID) await roles.setPermissions(id, SYSTEM_ROLE_DEFAULTS[id])
        }

        await usersRepo(trx).insert({
          id: ownerId,
          username: input.owner.username,
          full_name: input.owner.fullName,
          password_hash: passwordHash,
          pin_hash: null,
          role_id: OWNER_ROLE_ID,
          locked_until: null,
          created_at: now,
          updated_at: now,
        })

        const settings = storeSettings(trx)
        await settings.setStore(store, now)
        await settings.setFeatures(BUSINESS_PRESETS[store.businessType], now)
        await settings.setPreferences({ ...(await settings.preferences()), locale: input.locale }, now)
        await settings.setRecovery(envelope, now)

        await auditRepo(trx).record({
          actorId: ownerId,
          action: 'store.onboarded',
          details: { businessType: store.businessType },
          occurredAt: now,
        })

        const owner = await usersRepo(trx).findById(ownerId)
        return { token: await openSession(deps, trx, ownerId), actor: await loadActor(trx, owner!) }
      })

      return c.json({ ...session, recoveryCode: formatRecoveryCode(recoveryCode) }, 200)
    })
}

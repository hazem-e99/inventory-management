import { hashSerial, normalizeSerial } from '@inv/license-core'
import { Hono } from 'hono'
import { z } from 'zod'
import { deviceAiStatus } from './ai/routes'
import { ApiError, clientAddress, type ServerDeps, type ServerEnv } from './app'
import { bindDevice, tokenFor } from './licenses'
import { rateLimiter } from './rate-limit'

const ACTIVATIONS_PER_MINUTE = 10
const CHECK_INS_PER_MINUTE = 60

const fingerprintSchema = z.string().regex(/^[0-9a-f]{32}$/)

const activateSchema = z.object({
  serial: z.string().max(64),
  fingerprint: fingerprintSchema,
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
})

const checkInSchema = z.object({
  licenseId: z.string().max(64),
  fingerprint: fingerprintSchema,
  appVersion: z.string().max(40).optional(),
})

async function bodyOf<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 422)
  return parsed.data
}

/** What an installed copy of the app calls. It carries no session: the serial is the secret. */
export function deviceRoutes(deps: ServerDeps) {
  const app = new Hono<ServerEnv>()
  const allowActivation = rateLimiter(ACTIVATIONS_PER_MINUTE, deps.clock)
  const allowCheckIn = rateLimiter(CHECK_INS_PER_MINUTE, deps.clock)

  app.post('/activate', async (c) => {
    if (!allowActivation(clientAddress(c, deps.trustProxy))) throw new ApiError('RATE_LIMITED', 429)

    const input = await bodyOf(c.req.raw, activateSchema)
    const serial = normalizeSerial(input.serial)
    if (!serial) throw new ApiError('SERIAL_UNKNOWN', 404)

    const license = await deps.db
      .selectFrom('licenses')
      .selectAll()
      .where('serial_hash', '=', hashSerial(serial, deps.serialKey))
      .executeTakeFirst()

    if (!license) throw new ApiError('SERIAL_UNKNOWN', 404)
    if (license.state === 'revoked') throw new ApiError('LICENSE_REVOKED', 403)
    if (license.state === 'suspended') throw new ApiError('LICENSE_SUSPENDED', 403)
    if (license.fingerprint && license.fingerprint !== input.fingerprint) throw new ApiError('LICENSE_BOUND', 409)

    const bound = await bindDevice(deps, license, input, 'device')
    return c.json({ token: await tokenFor(deps, bound, input.fingerprint) })
  })

  app.post('/check-in', async (c) => {
    if (!allowCheckIn(clientAddress(c, deps.trustProxy))) throw new ApiError('RATE_LIMITED', 429)

    const input = await bodyOf(c.req.raw, checkInSchema)
    const license = await deps.db.selectFrom('licenses').selectAll().where('id', '=', input.licenseId).executeTakeFirst()

    if (!license || license.fingerprint !== input.fingerprint) return c.json({ status: 'unbound' as const })

    await deps.db
      .updateTable('licenses')
      .set({ last_seen_at: deps.clock(), app_version: input.appVersion ?? license.app_version })
      .where('id', '=', license.id)
      .execute()

    return c.json({ status: 'ok' as const, token: await tokenFor(deps, license, input.fingerprint), ai: await deviceAiStatus(deps, license) })
  })

  return app
}

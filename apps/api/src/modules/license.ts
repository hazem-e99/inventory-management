import { createRoute } from '@hono/zod-openapi'
import { hostname } from 'node:os'
import { activateLicenseSchema, licenseInfoSchema, offlineLicenseSchema, type LicenseInfo, type RequestCode } from '@inv/contracts'
import { auditRepo } from '@inv/db'
import { evaluateLicense, verifyLicenseToken, type LicensePayload } from '@inv/license-core'
import type { Context, Next } from 'hono'
import type { AppDeps, LicenseConfig } from '../http/context'
import { AppError, fieldError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { storeSettings } from './store'

const SERVER_TIMEOUT_MS = 10_000

const SERVER_ERRORS: Record<string, RequestCode> = {
  SERIAL_UNKNOWN: 'LICENSE_SERIAL_INVALID',
  LICENSE_BOUND: 'LICENSE_TAKEN',
  LICENSE_SUSPENDED: 'LICENSE_STOPPED',
  LICENSE_REVOKED: 'LICENSE_STOPPED',
  RATE_LIMITED: 'LICENSE_RATE_LIMITED',
}

// What still works with the license stopped: a shop's data is never held hostage, so it can
// always sign in, get its data out, and hand over a drawer that is already open.
const OPEN_WHEN_READ_ONLY = [
  /^\/onboarding/,
  /^\/auth\//,
  /^\/license/,
  /^\/backups/,
  /^\/settings\/preferences$/,
  /^\/catalog\/export$/,
  /^\/reports\/[^/]+\/export$/,
  /^\/shifts\/[^/]+\/close$/,
]

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Anything else would hand a serial and a device id to the network in the clear. */
function assertSecure(url: string): void {
  const { protocol, hostname: host } = new URL(url)
  if (protocol !== 'https:' && host !== '127.0.0.1' && host !== 'localhost') throw new AppError('LICENSE_SERVER_UNREACHABLE')
}

async function callServer(config: LicenseConfig, path: string, body: unknown): Promise<Response> {
  assertSecure(config.serverUrl)
  try {
    return await (config.fetch ?? fetch)(`${config.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
  } catch {
    throw new AppError('LICENSE_SERVER_UNREACHABLE')
  }
}

function licenseService(deps: AppDeps, config: LicenseConfig) {
  const settings = storeSettings(deps.db)

  async function load() {
    const stored = await settings.license()
    const payload = stored.token ? verifyLicenseToken(stored.token, config.publicKey) : null
    return { payload, lastSeenAt: stored.lastSeenAt }
  }

  /** Only a token this device can actually use is ever kept. */
  async function install(token: string): Promise<LicensePayload> {
    const payload = verifyLicenseToken(token, config.publicKey)
    if (!payload) throw new AppError('LICENSE_TOKEN_INVALID')
    if (payload.fingerprint !== config.fingerprint) throw new AppError('LICENSE_OTHER_DEVICE')

    const now = deps.clock()
    const { lastSeenAt } = await settings.license()
    await settings.setLicense({ token, lastSeenAt: Math.max(lastSeenAt, now) }, now)
    return payload
  }

  return {
    async info(): Promise<LicenseInfo> {
      const { payload, lastSeenAt } = await load()
      const state = evaluateLicense(payload, config.fingerprint, deps.clock(), lastSeenAt)
      return { enforced: true, ...state, customer: payload?.customer ?? null, deviceId: config.fingerprint }
    },

    install,

    async activate(serial: string): Promise<void> {
      const response = await callServer(config, '/v1/activate', {
        serial,
        fingerprint: config.fingerprint,
        deviceName: hostname().slice(0, 120),
        appVersion: deps.version,
      })
      const body = (await response.json().catch(() => null)) as { token?: string; code?: string } | null
      if (!response.ok || !body?.token) {
        throw new AppError(SERVER_ERRORS[body?.code ?? ''] ?? 'LICENSE_SERVER_UNREACHABLE')
      }
      await install(body.token)
    },

    /** Quiet by design: a shop with no internet carries on, on the token it already has. */
    async checkIn(): Promise<void> {
      const { payload } = await load()
      if (!payload) return

      const response = await callServer(config, '/v1/check-in', {
        licenseId: payload.licenseId,
        fingerprint: config.fingerprint,
        appVersion: deps.version,
      })
      if (!response.ok) return

      const body = (await response.json().catch(() => null)) as { status?: string; token?: string } | null
      if (body?.status === 'ok' && body.token) await install(body.token)
      if (body?.status === 'unbound') await settings.setLicense({ token: null, lastSeenAt: deps.clock() }, deps.clock())
    },

    /** Remembers the latest moment seen, which is what makes winding the clock back pointless. */
    async touch(): Promise<void> {
      const now = deps.clock()
      const stored = await settings.license()
      if (now > stored.lastSeenAt) await settings.setLicense({ ...stored, lastSeenAt: now }, now)
    },
  }
}

const UNENFORCED = (): LicenseInfo => ({
  enforced: false,
  status: 'active',
  reason: null,
  expiresAt: null,
  graceEndsAt: null,
  daysLeft: null,
  customer: null,
  deviceId: '',
})

export function licenseGuard(deps: AppDeps) {
  return async (c: Context, next: Next) => {
    const { license } = deps
    if (license && !READS.has(c.req.method) && !OPEN_WHEN_READ_ONLY.some((path) => path.test(c.req.path))) {
      const { status } = await licenseService(deps, license).info()
      if (status === 'read_only' || status === 'unlicensed') throw new AppError('LICENSE_READ_ONLY')
    }
    await next()
  }
}

/** Runs quietly in the background of the running app. */
export async function licenseHeartbeat(deps: AppDeps): Promise<void> {
  if (!deps.license) return
  const service = licenseService(deps, deps.license)
  await service.touch()
  await service.checkIn().catch(() => undefined)
}

export function licenseRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canManage = [...guard, requirePermission('settings.manage')]

  const readRoute = createRoute({
    method: 'get',
    path: '/license',
    middleware: requireAuth(deps),
    responses: { 200: jsonOk(licenseInfoSchema) },
  })

  const activateRoute = createRoute({
    method: 'post',
    path: '/license/activate',
    middleware: canManage,
    request: { body: jsonBody(activateLicenseSchema) },
    responses: { 200: jsonOk(licenseInfoSchema) },
  })

  const offlineRoute = createRoute({
    method: 'post',
    path: '/license/offline',
    middleware: canManage,
    request: { body: jsonBody(offlineLicenseSchema) },
    responses: { 200: jsonOk(licenseInfoSchema) },
  })

  const checkInRoute = createRoute({
    method: 'post',
    path: '/license/check-in',
    middleware: guard,
    responses: { 200: jsonOk(licenseInfoSchema) },
  })

  const serviceOf = () => (deps.license ? licenseService(deps, deps.license) : null)

  return router()
    .openapi(readRoute, async (c) => {
      const service = serviceOf()
      return c.json(service ? await service.info() : UNENFORCED(), 200)
    })
    .openapi(activateRoute, async (c) => {
      const service = serviceOf()
      if (!service) return c.json(UNENFORCED(), 200)

      await service.activate(c.req.valid('json').serial)
      await auditRepo(deps.db).record({ actorId: c.get('actor').id, action: 'license.activated', occurredAt: deps.clock() })
      return c.json(await service.info(), 200)
    })
    .openapi(offlineRoute, async (c) => {
      const service = serviceOf()
      if (!service) return c.json(UNENFORCED(), 200)

      await service.install(c.req.valid('json').code).catch((error: unknown) => {
        throw error instanceof AppError ? fieldError('code', error.code) : error
      })
      await auditRepo(deps.db).record({ actorId: c.get('actor').id, action: 'license.activated', occurredAt: deps.clock() })
      return c.json(await service.info(), 200)
    })
    .openapi(checkInRoute, async (c) => {
      const service = serviceOf()
      if (!service) return c.json(UNENFORCED(), 200)

      await service.checkIn()
      return c.json(await service.info(), 200)
    })
}

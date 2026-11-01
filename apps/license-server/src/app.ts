import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Kysely } from 'kysely'
import { adminRoutes } from './admin-routes'
import type { Auth } from './auth'
import { deviceRoutes } from './device-routes'
import type { LicenseDatabase } from './schema'

export interface ServerDeps {
  db: Kysely<LicenseDatabase>
  auth: Auth
  privateKey: string
  serialKey: string
  publicUrl: string
  clock: () => number
  /** Holds the installers and the signed manifest. Publishing is copying files here. */
  updatesDir?: string
  /** Behind Caddy the client address arrives in a header; without a proxy that header is a lie. */
  trustProxy: boolean
  logError: (message: string, details: Record<string, unknown>) => void
}

export interface ServerEnv {
  Variables: { admin: string }
}

export class ApiError extends HTTPException {
  constructor(
    readonly code: string,
    status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
  ) {
    super(status, { message: code })
  }
}

export function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  const incoming = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return incoming?.incoming?.socket?.remoteAddress ?? 'unknown'
}

export function createServerApp(deps: ServerDeps) {
  const app = new Hono<ServerEnv>()

  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ code: error.code }, error.status)
    if (error instanceof HTTPException) return c.json({ code: 'VALIDATION_FAILED' }, error.status)
    deps.logError('Unhandled error', { path: c.req.path, message: error.message })
    return c.json({ code: 'INTERNAL' }, 500)
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))
  if (deps.updatesDir) {
    const root = deps.updatesDir
    app.use('/updates/*', serveStatic({ root, rewriteRequestPath: (path) => path.replace(/^\/updates/, '') }))
  }
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))
  app.route('/v1', deviceRoutes(deps))
  app.route('/admin', adminRoutes(deps))

  return app
}

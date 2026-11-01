import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { Health } from '@inv/contracts'
import { cors } from 'hono/cors'
import type { AppDeps } from './http/context'
import { AppError, handleError } from './http/errors'
import { router } from './http/routing'
import { SESSION_HEADER } from './http/session'
import { auditRoutes } from './modules/audit'
import { authRoutes } from './modules/auth'
import { backupRoutes } from './modules/backups'
import { catalogFileRoutes } from './modules/catalog-import'
import { customerRoutes } from './modules/customers'
import { onboardingRoutes } from './modules/onboarding'
import { productRoutes } from './modules/products'
import { purchaseRoutes } from './modules/purchases'
import { referenceRoutes } from './modules/reference'
import { reportRoutes } from './modules/reports'
import { rolesRoutes } from './modules/roles'
import { saleRoutes } from './modules/sales'
import { settingsRoutes } from './modules/settings'
import { shiftRoutes } from './modules/shifts'
import { stockRoutes } from './modules/stock'
import { supplierRoutes } from './modules/suppliers'
import { usersRoutes } from './modules/users'

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`)
  const received = Buffer.from(header ?? '')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export function createApp(deps: AppDeps) {
  const app = router()

  app.onError(handleError(deps))
  app.notFound(() => {
    throw new AppError('NOT_FOUND')
  })

  app.use(async (c, next) => {
    c.set('traceId', randomUUID())
    await next()
  })

  app.use(
    cors({
      origin: deps.allowedOrigin,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type', SESSION_HEADER],
    }),
  )

  // CORS only stops browsers reading the response, so foreign origins are refused outright.
  app.use(async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && origin !== deps.allowedOrigin) throw new AppError('FORBIDDEN_ORIGIN')
    await next()
  })

  // Proves the caller is this app's window; the session below proves who is using it.
  app.use(async (c, next) => {
    if (!tokenMatches(c.req.header('Authorization'), deps.token)) throw new AppError('UNAUTHENTICATED')
    await next()
  })

  app.get('/health', (c) => {
    const health: Health = { status: 'ok', version: deps.version, bootCount: deps.bootCount }
    return c.json(health)
  })

  app.route('/', onboardingRoutes(deps))
  app.route('/', authRoutes(deps))
  app.route('/', usersRoutes(deps))
  app.route('/', rolesRoutes(deps))
  app.route('/', settingsRoutes(deps))
  app.route('/', auditRoutes(deps))
  app.route('/', backupRoutes(deps))
  // File routes first: their fixed paths would otherwise match `/catalog/{kind}`.
  app.route('/', catalogFileRoutes(deps))
  // Before products, whose `/products/{id}` must not swallow `/products/{id}/stock`.
  app.route('/', stockRoutes(deps))
  app.route('/', productRoutes(deps))
  app.route('/', referenceRoutes(deps))
  app.route('/', supplierRoutes(deps))
  app.route('/', purchaseRoutes(deps))
  app.route('/', saleRoutes(deps))
  app.route('/', shiftRoutes(deps))
  app.route('/', customerRoutes(deps))
  app.route('/', reportRoutes(deps))

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Inventory API', version: deps.version },
  })

  return app
}

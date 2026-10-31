import { createRoute } from '@hono/zod-openapi'
import { auditPageSchema, pageQuerySchema } from '@inv/contracts'
import { auditRepo } from '@inv/db'
import type { AppDeps } from '../http/context'
import { jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'

export function auditRoutes(deps: AppDeps) {
  const listRoute = createRoute({
    method: 'get',
    path: '/audit',
    middleware: [requireAuth(deps), requirePasswordCurrent, requirePermission('audit.view')] as const,
    request: { query: pageQuerySchema },
    responses: { 200: jsonOk(auditPageSchema) },
  })

  return router().openapi(listRoute, async (c) => {
    const { limit, cursor } = c.req.valid('query')
    return c.json(await auditRepo(deps.db).page(limit, cursor), 200)
  })
}

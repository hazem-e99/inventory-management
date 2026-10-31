import { createRoute, z } from '@hono/zod-openapi'
import {
  okSchema,
  roleInputSchema,
  roleSchema,
  rolesListSchema,
  type Permission,
  type Role,
} from '@inv/contracts'
import { auditRepo, classifyConstraintError, newId, rolesRepo, type Database, type Kysely } from '@inv/db'
import { effectivePermissions, OWNER_ROLE_ID } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'

const params = z.object({ id: z.string() })

async function listRoles(db: Kysely<Database>): Promise<Role[]> {
  const repo = rolesRepo(db)
  const [roles, permissions, userCounts] = await Promise.all([
    repo.list(),
    repo.allPermissions(),
    repo.userCounts(),
  ])
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    isSystem: role.is_system === 1,
    permissions: effectivePermissions(role.id, (permissions.get(role.id) ?? []) as Permission[]),
    userCount: userCounts.get(role.id) ?? 0,
  }))
}

async function findRole(db: Kysely<Database>, id: string): Promise<Role> {
  const role = (await listRoles(db)).find((candidate) => candidate.id === id)
  if (!role) throw new AppError('NOT_FOUND')
  return role
}

export function rolesRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canManage = [...guard, requirePermission('roles.manage')]

  const listRoute = createRoute({
    method: 'get',
    path: '/roles',
    middleware: [...guard, requirePermission('users.view')] as const,
    responses: { 200: jsonOk(rolesListSchema) },
  })

  const createRoleRoute = createRoute({
    method: 'post',
    path: '/roles',
    middleware: canManage,
    request: { body: jsonBody(roleInputSchema) },
    responses: { 200: jsonOk(roleSchema) },
  })

  const updateRoute = createRoute({
    method: 'put',
    path: '/roles/{id}',
    middleware: canManage,
    request: { params, body: jsonBody(roleInputSchema) },
    responses: { 200: jsonOk(roleSchema) },
  })

  const deleteRoute = createRoute({
    method: 'delete',
    path: '/roles/{id}',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  return router()
    .openapi(listRoute, async (c) => c.json({ items: await listRoles(deps.db) }, 200))
    .openapi(createRoleRoute, async (c) => {
      const input = c.req.valid('json')
      const now = deps.clock()
      const id = newId()

      await deps.db.transaction().execute(async (trx) => {
        const roles = rolesRepo(trx)
        await roles.insert({ id, name: input.name, is_system: 0, created_at: now })
        await roles.setPermissions(id, input.permissions)
        await auditRepo(trx).record({
          actorId: c.get('actor').id,
          action: 'role.created',
          entityType: 'role',
          entityId: id,
          details: { name: input.name, permissions: input.permissions },
          occurredAt: now,
        })
      })
      return c.json(await findRole(deps.db, id), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      if (id === OWNER_ROLE_ID) throw new AppError('ROLE_IS_SYSTEM')

      const existing = await findRole(deps.db, id)
      const now = deps.clock()

      await deps.db.transaction().execute(async (trx) => {
        const roles = rolesRepo(trx)
        // System roles keep their translated name; only their permissions are editable.
        if (!existing.isSystem) await roles.rename(id, input.name)
        await roles.setPermissions(id, input.permissions)
        await auditRepo(trx).record({
          actorId: c.get('actor').id,
          action: 'role.updated',
          entityType: 'role',
          entityId: id,
          details: { permissions: input.permissions },
          occurredAt: now,
        })
      })
      return c.json(await findRole(deps.db, id), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid('param')
      const existing = await findRole(deps.db, id)
      if (existing.isSystem) throw new AppError('ROLE_IS_SYSTEM')

      try {
        await deps.db.transaction().execute(async (trx) => {
          await rolesRepo(trx).delete(id)
          await auditRepo(trx).record({
            actorId: c.get('actor').id,
            action: 'role.deleted',
            entityType: 'role',
            entityId: id,
            details: { name: existing.name },
            occurredAt: deps.clock(),
          })
        })
      } catch (error) {
        if (classifyConstraintError(error)?.kind === 'foreign_key') {
          throw new AppError('ROLE_IN_USE', { params: { count: existing.userCount } })
        }
        throw error
      }
      return c.json({ ok: true as const }, 200)
    })
}

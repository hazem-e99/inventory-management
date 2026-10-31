import { createRoute, z } from '@hono/zod-openapi'
import {
  createUserSchema,
  okSchema,
  resetPasswordSchema,
  updateUserSchema,
  userSchema,
  usersListSchema,
  type Actor,
  type User,
} from '@inv/contracts'
import { auditRepo, newId, rolesRepo, sessionsRepo, usersRepo, type UserRow } from '@inv/db'
import { OWNER_ROLE_ID } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError, fieldError } from '../http/errors'
import { hashSecret } from '../http/passwords'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'

const params = z.object({ id: z.string() })

const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  fullName: row.full_name,
  roleId: row.role_id,
  isActive: row.is_active === 1,
  hasPin: row.pin_hash !== null,
  createdAt: Number(row.created_at),
})

/** Without this, anyone holding `users.manage` could promote themselves to owner. */
function assertCanTouchOwner(actor: Actor, ...roleIds: Array<string | undefined>): void {
  if (roleIds.includes(OWNER_ROLE_ID) && actor.roleId !== OWNER_ROLE_ID) {
    throw new AppError('FORBIDDEN')
  }
}

export function usersRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('users.view')]
  const canManage = [...guard, requirePermission('users.manage')]

  const listRoute = createRoute({
    method: 'get',
    path: '/users',
    middleware: canView,
    responses: { 200: jsonOk(usersListSchema) },
  })

  const createUserRoute = createRoute({
    method: 'post',
    path: '/users',
    middleware: canManage,
    request: { body: jsonBody(createUserSchema) },
    responses: { 200: jsonOk(userSchema) },
  })

  const updateRoute = createRoute({
    method: 'patch',
    path: '/users/{id}',
    middleware: canManage,
    request: { params, body: jsonBody(updateUserSchema) },
    responses: { 200: jsonOk(userSchema) },
  })

  const resetPasswordRoute = createRoute({
    method: 'post',
    path: '/users/{id}/reset-password',
    middleware: canManage,
    request: { params, body: jsonBody(resetPasswordSchema) },
    responses: { 200: jsonOk(okSchema) },
  })

  return router()
    .openapi(listRoute, async (c) => {
      const rows = await usersRepo(deps.db).list()
      return c.json({ items: rows.map(toUser) }, 200)
    })
    .openapi(createUserRoute, async (c) => {
      const input = c.req.valid('json')
      const actor = c.get('actor')
      assertCanTouchOwner(actor, input.roleId)

      if (!(await rolesRepo(deps.db).findById(input.roleId))) {
        throw fieldError('roleId', 'INVALID_VALUE')
      }

      const [passwordHash, pinHash] = await Promise.all([
        hashSecret(input.password),
        input.pin ? hashSecret(input.pin) : null,
      ])
      const now = deps.clock()
      const id = newId()

      await deps.db.transaction().execute(async (trx) => {
        await usersRepo(trx).insert({
          id,
          username: input.username,
          full_name: input.fullName,
          password_hash: passwordHash,
          pin_hash: pinHash,
          role_id: input.roleId,
          must_change_password: 1,
          locked_until: null,
          created_at: now,
          updated_at: now,
        })
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'user.created',
          entityType: 'user',
          entityId: id,
          details: { username: input.username, roleId: input.roleId },
          occurredAt: now,
        })
      })

      const created = await usersRepo(deps.db).findById(id)
      return c.json(toUser(created!), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const actor = c.get('actor')

      const updated = await deps.db.transaction().execute(async (trx) => {
        const users = usersRepo(trx)
        const target = await users.findById(id)
        if (!target) throw new AppError('NOT_FOUND')
        assertCanTouchOwner(actor, target.role_id, input.roleId)

        if (input.isActive === false && id === actor.id) throw new AppError('CANNOT_DISABLE_SELF')

        if (input.roleId && !(await rolesRepo(trx).findById(input.roleId))) {
          throw fieldError('roleId', 'INVALID_VALUE')
        }

        const losesOwner =
          target.role_id === OWNER_ROLE_ID &&
          target.is_active === 1 &&
          (input.isActive === false || (input.roleId ?? OWNER_ROLE_ID) !== OWNER_ROLE_ID)
        if (losesOwner && (await users.countActiveInRole(OWNER_ROLE_ID)) <= 1) {
          throw new AppError('LAST_OWNER')
        }

        const now = deps.clock()
        await users.update(id, {
          ...(input.fullName === undefined ? {} : { full_name: input.fullName }),
          ...(input.roleId === undefined ? {} : { role_id: input.roleId }),
          ...(input.isActive === undefined ? {} : { is_active: input.isActive ? 1 : 0 }),
          updated_at: now,
        })
        if (input.isActive === false) await sessionsRepo(trx).deleteForUser(id)

        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'user.updated',
          entityType: 'user',
          entityId: id,
          details: { changes: Object.keys(input) },
          occurredAt: now,
        })
        return users.findById(id)
      })

      return c.json(toUser(updated!), 200)
    })
    .openapi(resetPasswordRoute, async (c) => {
      const { id } = c.req.valid('param')
      const { password } = c.req.valid('json')
      const actor = c.get('actor')

      const target = await usersRepo(deps.db).findById(id)
      if (!target) throw new AppError('NOT_FOUND')
      assertCanTouchOwner(actor, target.role_id)

      const passwordHash = await hashSecret(password)
      const now = deps.clock()
      await deps.db.transaction().execute(async (trx) => {
        await usersRepo(trx).update(id, {
          password_hash: passwordHash,
          must_change_password: 1,
          failed_attempts: 0,
          locked_until: null,
          updated_at: now,
        })
        await sessionsRepo(trx).deleteForUser(id)
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'user.password_reset',
          entityType: 'user',
          entityId: id,
          occurredAt: now,
        })
      })
      return c.json({ ok: true as const }, 200)
    })
}

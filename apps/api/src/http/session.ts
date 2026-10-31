import { createHash, randomBytes } from 'node:crypto'
import type { Actor, Permission } from '@inv/contracts'
import { rolesRepo, sessionsRepo, usersRepo, type Database, type Kysely, type UserRow } from '@inv/db'
import { effectivePermissions } from '@inv/domain'
import { createMiddleware } from 'hono/factory'
import type { AppDeps, AppEnv } from './context'
import { AppError } from './errors'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export const SESSION_HEADER = 'X-Session-Token'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Only the hash is stored, so reading the database never yields a usable session. */
export async function openSession(deps: AppDeps, db: Kysely<Database>, userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const now = deps.clock()
  await sessionsRepo(db).insert(hashToken(token), userId, now, now + SESSION_TTL_MS)
  return token
}

export async function loadActor(db: Kysely<Database>, user: UserRow): Promise<Actor> {
  const stored = await rolesRepo(db).permissionsOf(user.role_id)
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    roleId: user.role_id,
    permissions: effectivePermissions(user.role_id, stored as Permission[]),
    mustChangePassword: user.must_change_password === 1,
    hasPin: user.pin_hash !== null,
  }
}

export function requireAuth(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = c.req.header(SESSION_HEADER)
    if (!token) throw new AppError('UNAUTHENTICATED')

    const hash = hashToken(token)
    const session = await sessionsRepo(deps.db).find(hash)
    if (!session) throw new AppError('UNAUTHENTICATED')
    if (session.expiresAt <= deps.clock()) {
      await sessionsRepo(deps.db).delete(hash)
      throw new AppError('SESSION_EXPIRED')
    }

    const user = await usersRepo(deps.db).findById(session.userId)
    if (!user || user.is_active !== 1) throw new AppError('UNAUTHENTICATED')

    const actor = await loadActor(deps.db, user)
    c.set('actor', actor)
    c.set('sessionHash', hash)
    await next()
  })
}

/** Blocks everything until a temporary password is replaced, except the auth routes that do it. */
export const requirePasswordCurrent = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('actor').mustChangePassword) throw new AppError('PASSWORD_CHANGE_REQUIRED')
  await next()
})

export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get('actor').permissions.includes(permission)) throw new AppError('FORBIDDEN')
    await next()
  })
}

import { createRoute } from '@hono/zod-openapi'
import {
  actorSchema,
  changePasswordSchema,
  loginSchema,
  okSchema,
  pinLoginSchema,
  recoverAccountSchema,
  sessionSchema,
  setPinSchema,
} from '@inv/contracts'
import { auditRepo, sessionsRepo, usersRepo, type UserRow } from '@inv/db'
import { unwrapKey } from '@inv/db/backup'
import { OWNER_ROLE_ID } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { hashSecret, verifySecret } from '../http/passwords'
import { jsonBody, jsonOk, router } from '../http/routing'
import { loadActor, openSession, requireAuth } from '../http/session'
import { storeSettings } from './store'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 5 * 60 * 1000

let decoyHash: Promise<string> | undefined

/** Spends the same time on an unknown username, so timing does not reveal who exists. */
async function burnVerification(secret: string): Promise<void> {
  decoyHash ??= hashSecret('decoy-password')
  await verifySecret(await decoyHash, secret)
}

const normalizeUsername = (username: string) => username.normalize('NFC').toLowerCase()

async function recordFailure(deps: AppDeps, user: UserRow, now: number): Promise<void> {
  const attempts = user.failed_attempts + 1
  const locks = attempts >= MAX_FAILED_ATTEMPTS
  await usersRepo(deps.db).update(user.id, {
    failed_attempts: locks ? 0 : attempts,
    locked_until: locks ? now + LOCK_DURATION_MS : user.locked_until,
  })
  await auditRepo(deps.db).record({
    actorId: user.id,
    action: locks ? 'auth.locked' : 'auth.login_failed',
    occurredAt: now,
  })
}

async function authenticate(
  deps: AppDeps,
  username: string,
  secret: string,
  storedHash: (user: UserRow) => string | null,
) {
  const now = deps.clock()
  const user = await usersRepo(deps.db).findByUsername(normalizeUsername(username))

  if (!user) {
    await burnVerification(secret)
    throw new AppError('INVALID_CREDENTIALS')
  }

  const lockedUntil = user.locked_until === null ? 0 : Number(user.locked_until)
  if (lockedUntil > now) {
    throw new AppError('ACCOUNT_LOCKED', {
      params: { minutes: Math.ceil((lockedUntil - now) / 60_000) },
    })
  }

  const stored = storedHash(user)
  if (stored === null) throw new AppError('PIN_NOT_SET')

  if (!(await verifySecret(stored, secret))) {
    await recordFailure(deps, user, now)
    throw new AppError('INVALID_CREDENTIALS')
  }

  // Checked after the secret, so only the real user learns the account is disabled.
  if (user.is_active !== 1) throw new AppError('ACCOUNT_DISABLED')

  return deps.db.transaction().execute(async (trx) => {
    await usersRepo(trx).update(user.id, { failed_attempts: 0, locked_until: null })
    await auditRepo(trx).record({ actorId: user.id, action: 'auth.login', occurredAt: now })
    return { token: await openSession(deps, trx, user.id), actor: await loadActor(trx, user) }
  })
}

const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  request: { body: jsonBody(loginSchema) },
  responses: { 200: jsonOk(sessionSchema) },
})

const pinLoginRoute = createRoute({
  method: 'post',
  path: '/auth/pin-login',
  request: { body: jsonBody(pinLoginSchema) },
  responses: { 200: jsonOk(sessionSchema) },
})

const recoverRoute = createRoute({
  method: 'post',
  path: '/auth/recover',
  request: { body: jsonBody(recoverAccountSchema) },
  responses: { 200: jsonOk(okSchema) },
})

export function authRoutes(deps: AppDeps) {
  const authenticated = requireAuth(deps)

  const meRoute = createRoute({
    method: 'get',
    path: '/auth/me',
    middleware: [authenticated] as const,
    responses: { 200: jsonOk(actorSchema) },
  })

  const logoutRoute = createRoute({
    method: 'post',
    path: '/auth/logout',
    middleware: [authenticated] as const,
    responses: { 200: jsonOk(okSchema) },
  })

  const changePasswordRoute = createRoute({
    method: 'post',
    path: '/auth/change-password',
    middleware: [authenticated] as const,
    request: { body: jsonBody(changePasswordSchema) },
    responses: { 200: jsonOk(actorSchema) },
  })

  const setPinRoute = createRoute({
    method: 'post',
    path: '/auth/pin',
    middleware: [authenticated] as const,
    request: { body: jsonBody(setPinSchema) },
    responses: { 200: jsonOk(actorSchema) },
  })

  async function verifyCurrentPassword(userId: string, password: string): Promise<UserRow> {
    const user = await usersRepo(deps.db).findById(userId)
    if (!user) throw new AppError('UNAUTHENTICATED')
    if (!(await verifySecret(user.password_hash, password))) {
      throw new AppError('CURRENT_PASSWORD_WRONG')
    }
    return user
  }

  return router()
    .openapi(loginRoute, async (c) => {
      const { username, password } = c.req.valid('json')
      const session = await authenticate(deps, username, password, (user) => user.password_hash)
      return c.json(session, 200)
    })
    .openapi(pinLoginRoute, async (c) => {
      const { username, pin } = c.req.valid('json')
      const session = await authenticate(deps, username, pin, (user) => user.pin_hash)
      return c.json(session, 200)
    })
    .openapi(recoverRoute, async (c) => {
      const { username, recoveryCode, newPassword } = c.req.valid('json')
      const envelope = await storeSettings(deps.db).recovery()
      if (!envelope) throw new AppError('NOT_ONBOARDED')

      const user = await usersRepo(deps.db).findByUsername(normalizeUsername(username))
      const authorised = (await unwrapKey(envelope, recoveryCode)) !== null
      if (!user || user.role_id !== OWNER_ROLE_ID || !authorised) {
        throw new AppError('INVALID_CREDENTIALS')
      }

      const passwordHash = await hashSecret(newPassword)
      const now = deps.clock()
      await deps.db.transaction().execute(async (trx) => {
        await usersRepo(trx).update(user.id, {
          password_hash: passwordHash,
          failed_attempts: 0,
          locked_until: null,
          must_change_password: 0,
          updated_at: now,
        })
        await sessionsRepo(trx).deleteForUser(user.id)
        await auditRepo(trx).record({ actorId: user.id, action: 'auth.recovered', occurredAt: now })
      })
      return c.json({ ok: true as const }, 200)
    })
    .openapi(meRoute, (c) => c.json(c.get('actor'), 200))
    .openapi(logoutRoute, async (c) => {
      await sessionsRepo(deps.db).delete(c.get('sessionHash'))
      return c.json({ ok: true as const }, 200)
    })
    .openapi(changePasswordRoute, async (c) => {
      const { currentPassword, newPassword } = c.req.valid('json')
      const user = await verifyCurrentPassword(c.get('actor').id, currentPassword)
      const passwordHash = await hashSecret(newPassword)
      const now = deps.clock()

      await usersRepo(deps.db).update(user.id, {
        password_hash: passwordHash,
        must_change_password: 0,
        updated_at: now,
      })
      await auditRepo(deps.db).record({ actorId: user.id, action: 'auth.password_changed', occurredAt: now })

      const updated = await usersRepo(deps.db).findById(user.id)
      return c.json(await loadActor(deps.db, updated!), 200)
    })
    .openapi(setPinRoute, async (c) => {
      const { currentPassword, pin } = c.req.valid('json')
      const user = await verifyCurrentPassword(c.get('actor').id, currentPassword)
      const now = deps.clock()

      await usersRepo(deps.db).update(user.id, { pin_hash: await hashSecret(pin), updated_at: now })
      await auditRepo(deps.db).record({ actorId: user.id, action: 'auth.pin_changed', occurredAt: now })

      const updated = await usersRepo(deps.db).findById(user.id)
      return c.json(await loadActor(deps.db, updated!), 200)
    })
}

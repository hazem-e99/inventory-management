import type { AuditPage, Role, Session, User } from '@inv/contracts'
import { beforeAll, describe, expect, it } from 'vitest'
import { onboarded, type Harness } from './harness'

const PASSWORD = 'temporary-password'

async function signIn(harness: Harness, username: string, password = PASSWORD): Promise<string> {
  const session = await harness.json<Session>('POST', '/auth/login', { body: { username, password } })
  return session.token
}

/** Creates a user and clears the forced password change, returning a usable session. */
async function staff(harness: Harness, ownerToken: string, username: string, roleId: string) {
  const user = await harness.json<User>('POST', '/users', {
    session: ownerToken,
    body: { fullName: 'موظف جديد', username, password: PASSWORD, roleId },
  })
  const token = await signIn(harness, username)
  await harness.json('POST', '/auth/change-password', {
    session: token,
    body: { currentPassword: PASSWORD, newPassword: 'staff-password' },
  })
  return { user, token }
}

describe('managing users', () => {
  let harness: Harness
  let ownerToken: string

  beforeAll(async () => {
    const context = await onboarded()
    harness = context.harness
    ownerToken = context.owner.token
  })

  it('flags a duplicate username on the username field', async () => {
    const body = { fullName: 'موظف', username: 'dup', password: PASSWORD, roleId: 'cashier' }
    await harness.json('POST', '/users', { session: ownerToken, body })
    const failure = await harness.failure('POST', '/users', { session: ownerToken, body })
    expect(failure.fields).toEqual({ username: ['USERNAME_TAKEN'] })
  })

  it('flags an unknown role on the role field', async () => {
    const failure = await harness.failure('POST', '/users', {
      session: ownerToken,
      body: { fullName: 'موظف', username: 'norole', password: PASSWORD, roleId: 'missing' },
    })
    expect(failure.fields).toEqual({ roleId: ['INVALID_VALUE'] })
  })

  it('forces a new user to change the temporary password before doing anything', async () => {
    await harness.json('POST', '/users', {
      session: ownerToken,
      body: { fullName: 'مدير', username: 'fresh', password: PASSWORD, roleId: 'manager' },
    })
    const token = await signIn(harness, 'fresh')

    expect((await harness.failure('GET', '/users', { session: token })).code).toBe('PASSWORD_CHANGE_REQUIRED')

    await harness.json('POST', '/auth/change-password', {
      session: token,
      body: { currentPassword: PASSWORD, newPassword: 'new-password' },
    })
    expect((await harness.call('GET', '/users', { session: token })).status).toBe(200)
  })

  it('ends sessions when a user is disabled', async () => {
    const { user, token } = await staff(harness, ownerToken, 'leaver', 'cashier')
    await harness.json('PATCH', `/users/${user.id}`, { session: ownerToken, body: { isActive: false } })

    expect((await harness.failure('GET', '/auth/me', { session: token })).code).toBe('UNAUTHENTICATED')
    const failure = await harness.failure('POST', '/auth/login', {
      body: { username: 'leaver', password: 'staff-password' },
    })
    expect(failure.code).toBe('ACCOUNT_DISABLED')
  })

  it('does not reveal a disabled account to someone without the password', async () => {
    const failure = await harness.failure('POST', '/auth/login', {
      body: { username: 'leaver', password: 'wrong-password' },
    })
    expect(failure.code).toBe('INVALID_CREDENTIALS')
  })

  it('resets a password and forces another change', async () => {
    const { user } = await staff(harness, ownerToken, 'forgetful', 'cashier')
    await harness.json('POST', `/users/${user.id}/reset-password`, {
      session: ownerToken,
      body: { password: 'reset-password' },
    })
    const session = await harness.json<Session>('POST', '/auth/login', {
      body: { username: 'forgetful', password: 'reset-password' },
    })
    expect(session.actor.mustChangePassword).toBe(true)
  })

  it('returns NOT_FOUND for an unknown user', async () => {
    const failure = await harness.failure('PATCH', '/users/missing', {
      session: ownerToken,
      body: { fullName: 'اسم' },
    })
    expect(failure.code).toBe('NOT_FOUND')
  })
})

describe('owner protection', () => {
  it('refuses to disable yourself or the last owner', async () => {
    const { harness, owner } = await onboarded()
    const self = await harness.failure('PATCH', `/users/${owner.actor.id}`, {
      session: owner.token,
      body: { isActive: false },
    })
    expect(self.code).toBe('CANNOT_DISABLE_SELF')

    const demote = await harness.failure('PATCH', `/users/${owner.actor.id}`, {
      session: owner.token,
      body: { roleId: 'manager' },
    })
    expect(demote.code).toBe('LAST_OWNER')
  })

  it('allows demoting an owner when another one remains', async () => {
    const { harness, owner } = await onboarded()
    await staff(harness, owner.token, 'second', 'owner')
    const updated = await harness.json<User>('PATCH', `/users/${owner.actor.id}`, {
      session: owner.token,
      body: { roleId: 'manager' },
    })
    expect(updated.roleId).toBe('manager')
  })

  it('stops a user manager from reaching owner level', async () => {
    const { harness, owner } = await onboarded()
    await harness.json('PUT', '/roles/manager', {
      session: owner.token,
      body: { name: 'manager', permissions: ['users.view', 'users.manage'] },
    })
    const manager = await staff(harness, owner.token, 'ambitious', 'manager')
    const target = await staff(harness, owner.token, 'target', 'cashier')

    const promoteSelf = await harness.failure('PATCH', `/users/${manager.user.id}`, {
      session: manager.token,
      body: { roleId: 'owner' },
    })
    const createOwner = await harness.failure('POST', '/users', {
      session: manager.token,
      body: { fullName: 'مالك مزيف', username: 'fakeowner', password: PASSWORD, roleId: 'owner' },
    })
    const resetOwner = await harness.failure('POST', `/users/${owner.actor.id}/reset-password`, {
      session: manager.token,
      body: { password: 'hijacked-password' },
    })

    expect([promoteSelf.code, createOwner.code, resetOwner.code]).toEqual(['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN'])

    const normal = await harness.call('PATCH', `/users/${target.user.id}`, {
      session: manager.token,
      body: { fullName: 'اسم جديد' },
    })
    expect(normal.status).toBe(200)
  })
})

describe('permissions', () => {
  it('enforces each route on the server', async () => {
    const { harness, owner } = await onboarded()
    const { token } = await staff(harness, owner.token, 'till', 'cashier')

    for (const [method, path] of [
      ['GET', '/users'],
      ['GET', '/audit'],
      ['GET', '/backups'],
      ['POST', '/backups'],
      ['GET', '/roles'],
    ] as const) {
      expect((await harness.failure(method, path, { session: token })).code).toBe('FORBIDDEN')
    }
  })

  it('applies a role change on the very next request', async () => {
    const { harness, owner } = await onboarded()
    const { token } = await staff(harness, owner.token, 'promoted', 'cashier')

    await harness.json('PUT', '/roles/cashier', {
      session: owner.token,
      body: { name: 'cashier', permissions: ['audit.view'] },
    })
    expect((await harness.call('GET', '/audit', { session: token })).status).toBe(200)
  })
})

describe('roles', () => {
  let harness: Harness
  let ownerToken: string

  beforeAll(async () => {
    const context = await onboarded()
    harness = context.harness
    ownerToken = context.owner.token
  })

  it('lists system roles with the owner holding everything', async () => {
    const { items } = await harness.json<{ items: Role[] }>('GET', '/roles', { session: ownerToken })
    expect(items.map((role) => role.id)).toEqual(expect.arrayContaining(['owner', 'manager', 'cashier']))
    expect(items.find((role) => role.id === 'owner')?.permissions).toContain('roles.manage')
  })

  it('protects the owner role', async () => {
    const edit = await harness.failure('PUT', '/roles/owner', {
      session: ownerToken,
      body: { name: 'owner', permissions: [] },
    })
    const remove = await harness.failure('DELETE', '/roles/owner', { session: ownerToken })
    expect([edit.code, remove.code]).toEqual(['ROLE_IS_SYSTEM', 'ROLE_IS_SYSTEM'])
  })

  it('flags a duplicate role name on the name field', async () => {
    const body = { name: 'صيدلي', permissions: [] }
    await harness.json('POST', '/roles', { session: ownerToken, body })
    const failure = await harness.failure('POST', '/roles', { session: ownerToken, body })
    expect(failure.fields).toEqual({ name: ['ROLE_NAME_TAKEN'] })
  })

  it('refuses to delete a role in use, saying how many users hold it', async () => {
    const role = await harness.json<Role>('POST', '/roles', {
      session: ownerToken,
      body: { name: 'مساعد', permissions: [] },
    })
    await harness.json('POST', '/users', {
      session: ownerToken,
      body: { fullName: 'مساعد', username: 'helper', password: PASSWORD, roleId: role.id },
    })

    const failure = await harness.failure('DELETE', `/roles/${role.id}`, { session: ownerToken })
    expect(failure.code).toBe('ROLE_IN_USE')
    expect(failure.params).toEqual({ count: 1 })
  })

  it('deletes an unused role', async () => {
    const role = await harness.json<Role>('POST', '/roles', {
      session: ownerToken,
      body: { name: 'مؤقت', permissions: [] },
    })
    expect((await harness.call('DELETE', `/roles/${role.id}`, { session: ownerToken })).status).toBe(200)
  })
})

describe('audit log', () => {
  it('pages through what happened, with who did it', async () => {
    const { harness, owner } = await onboarded()
    await harness.json('POST', '/users', {
      session: owner.token,
      body: { fullName: 'موظف', username: 'logged', password: PASSWORD, roleId: 'cashier' },
    })

    const page = await harness.json<AuditPage>('GET', '/audit?limit=1', { session: owner.token })
    expect(page.items[0]).toMatchObject({ action: 'user.created', actorName: 'حازم عصام' })
    expect(page.nextCursor).not.toBeNull()

    const next = await harness.json<AuditPage>(
      'GET',
      `/audit?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`,
      { session: owner.token },
    )
    expect(next.items[0]?.action).toBe('store.onboarded')
  })
})

import type { Actor, Bootstrap, Session, Settings, User } from '@inv/contracts'
import { describe, expect, it } from 'vitest'
import { createHarness, ONBOARDING, onboarded, OWNER, type Harness } from './harness'

const login = (harness: Harness, username: string, password: string) =>
  harness.call('POST', '/auth/login', { body: { username, password } })

describe('onboarding', () => {
  it('reports an empty store, then creates it once', async () => {
    const harness = await createHarness()
    expect((await harness.json<Bootstrap>('GET', '/bootstrap')).onboarded).toBe(false)

    const result = await harness.json<{ recoveryCode: string; actor: Actor }>('POST', '/onboarding', {
      body: ONBOARDING,
    })
    expect(result.recoveryCode).toMatch(/^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/)
    expect(result.actor.permissions).toContain('backups.manage')

    expect((await harness.json<Bootstrap>('GET', '/bootstrap')).store?.name).toBe('صيدلية النور')
    expect((await harness.failure('POST', '/onboarding', { body: ONBOARDING })).code).toBe('ALREADY_ONBOARDED')
  })

  it('applies the business preset', async () => {
    const { harness, owner } = await onboarded()
    const settings = await harness.json<Settings>('GET', '/settings', { session: owner.token })
    expect(settings.features).toMatchObject({ lots: true, expiryRequired: true })
    expect(settings.store.currency).toBe('EGP')
  })

  it('reports every invalid field with its own code', async () => {
    const harness = await createHarness()
    const failure = await harness.failure('POST', '/onboarding', {
      body: {
        locale: 'ar',
        store: { name: 'x', businessType: 'pharmacy', taxNumber: '12', phone: 'abc' },
        owner: { fullName: 'م', username: 'a b', password: 'short' },
      },
    })

    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.fields).toEqual({
      'store.name': ['NAME_TOO_SHORT'],
      'store.phone': ['PHONE_INVALID'],
      'store.taxNumber': ['TAX_NUMBER_INVALID'],
      'owner.fullName': ['NAME_TOO_SHORT'],
      'owner.username': ['USERNAME_INVALID'],
      'owner.password': ['PASSWORD_TOO_SHORT'],
    })
  })

  it('treats malformed JSON as a validation failure, not a crash', async () => {
    const harness = await createHarness()
    const { createApp } = await import('../src')
    const response = await createApp(harness.deps).request('/onboarding', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(response.status).toBe(422)
  })
})

describe('preferences', () => {
  it('can be saved before signing in, and read back at startup', async () => {
    const { harness } = await onboarded()
    const preferences = { locale: 'en', theme: 'dark', digits: 'arabic' }
    await harness.json('PUT', '/settings/preferences', { body: preferences })
    expect((await harness.json<Bootstrap>('GET', '/bootstrap')).preferences).toEqual(preferences)
  })
})

describe('login', () => {
  it('signs in and normalises the username', async () => {
    const { harness } = await onboarded()
    const response = await login(harness, ' OWNER '.trim(), OWNER.password)
    expect(response.status).toBe(200)
    expect(((await response.json()) as Session).actor.username).toBe('owner')
  })

  it('answers the same for a wrong password and an unknown user', async () => {
    const { harness } = await onboarded()
    const wrong = await harness.failure('POST', '/auth/login', {
      body: { username: 'owner', password: 'wrong-password' },
    })
    const unknown = await harness.failure('POST', '/auth/login', {
      body: { username: 'ghost', password: 'wrong-password' },
    })
    expect(wrong.code).toBe('INVALID_CREDENTIALS')
    expect(unknown.code).toBe('INVALID_CREDENTIALS')
  })

  it('locks after five failures, then lets the right password in once the lock ends', async () => {
    const { harness } = await onboarded()
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login(harness, 'owner', 'wrong-password')).status).toBe(401)
    }

    const locked = await harness.failure('POST', '/auth/login', {
      body: { username: 'owner', password: OWNER.password },
    })
    expect(locked.code).toBe('ACCOUNT_LOCKED')
    expect(locked.params).toEqual({ minutes: 5 })

    harness.time.now += 5 * 60 * 1000 + 1
    expect((await login(harness, 'owner', OWNER.password)).status).toBe(200)
  })

  it('never writes a secret into the audit log', async () => {
    const { harness } = await onboarded()
    await login(harness, 'owner', 'super-secret-guess')
    const rows = await harness.deps.db.selectFrom('audit_log').selectAll().execute()
    expect(JSON.stringify(rows)).not.toContain('super-secret-guess')
  })
})

describe('sessions', () => {
  it('rejects a request with no session', async () => {
    const { harness } = await onboarded()
    expect((await harness.failure('GET', '/auth/me')).code).toBe('UNAUTHENTICATED')
  })

  it('expires after twelve hours', async () => {
    const { harness, owner } = await onboarded()
    harness.time.now += 12 * 60 * 60 * 1000
    expect((await harness.failure('GET', '/auth/me', { session: owner.token })).code).toBe('SESSION_EXPIRED')
  })

  it('stops working after logout', async () => {
    const { harness, owner } = await onboarded()
    await harness.json('POST', '/auth/logout', { session: owner.token })
    expect((await harness.failure('GET', '/auth/me', { session: owner.token })).code).toBe('UNAUTHENTICATED')
  })

  it('stores only a hash of the token', async () => {
    const { harness, owner } = await onboarded()
    const rows = await harness.deps.db.selectFrom('sessions').selectAll().execute()
    expect(JSON.stringify(rows)).not.toContain(owner.token)
  })
})

describe('PIN', () => {
  it('works once set, and requires the password to set it', async () => {
    const { harness, owner } = await onboarded()

    const missing = await harness.failure('POST', '/auth/pin-login', {
      body: { username: 'owner', pin: '1234' },
    })
    expect(missing.code).toBe('PIN_NOT_SET')

    const wrong = await harness.failure('POST', '/auth/pin', {
      session: owner.token,
      body: { currentPassword: 'wrong-password', pin: '1234' },
    })
    expect(wrong.code).toBe('CURRENT_PASSWORD_WRONG')

    await harness.json('POST', '/auth/pin', {
      session: owner.token,
      body: { currentPassword: OWNER.password, pin: '1234' },
    })
    const session = await harness.json<Session>('POST', '/auth/pin-login', {
      body: { username: 'owner', pin: '1234' },
    })
    expect(session.actor.hasPin).toBe(true)
  })
})

describe('account recovery', () => {
  it('resets the owner password with the recovery code and ends old sessions', async () => {
    const { harness, owner } = await onboarded()
    await harness.json('POST', '/auth/recover', {
      body: { username: 'owner', recoveryCode: owner.recoveryCode, newPassword: 'brand-new-password' },
    })

    expect((await login(harness, 'owner', OWNER.password)).status).toBe(401)
    expect((await login(harness, 'owner', 'brand-new-password')).status).toBe(200)
    expect((await harness.failure('GET', '/auth/me', { session: owner.token })).code).toBe('UNAUTHENTICATED')
  })

  it('refuses a wrong code', async () => {
    const { harness } = await onboarded()
    const failure = await harness.failure('POST', '/auth/recover', {
      body: {
        username: 'owner',
        recoveryCode: '0000-0000-0000-0000-0000-0000',
        newPassword: 'brand-new-password',
      },
    })
    expect(failure.code).toBe('INVALID_CREDENTIALS')
  })

  it('refuses to recover an account that is not an owner', async () => {
    const { harness, owner } = await onboarded()
    await harness.json<User>('POST', '/users', {
      session: owner.token,
      body: { fullName: 'كاشير', username: 'cashier1', password: 'cashier-password', roleId: 'cashier' },
    })
    const failure = await harness.failure('POST', '/auth/recover', {
      body: { username: 'cashier1', recoveryCode: owner.recoveryCode, newPassword: 'brand-new-password' },
    })
    expect(failure.code).toBe('INVALID_CREDENTIALS')
  })
})

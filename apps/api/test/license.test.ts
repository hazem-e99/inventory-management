import type { LicenseInfo, Product } from '@inv/contracts'
import { generateLicenseKeys, signLicenseToken, type LicensePayload } from '@inv/license-core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LicenseConfig } from '../src/http/context'
import { licenseHeartbeat } from '../src/modules/license'
import { OWNER, onboarded, type Harness } from './harness'

const DAY = 86_400_000
const DEVICE = 'a'.repeat(32)
const keys = generateLicenseKeys()

interface Server {
  respond: (path: string, body: Record<string, unknown>) => Response
  calls: Array<{ path: string; body: Record<string, unknown> }>
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function fakeServer(): Server & { fetch: typeof fetch } {
  const server: Server & { fetch: typeof fetch } = {
    calls: [],
    respond: () => reply(500, {}),
    fetch: (async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      server.calls.push({ path, body })
      return server.respond(path, body)
    }) as typeof fetch,
  }
  return server
}

interface Context {
  harness: Harness
  session: string
  server: ReturnType<typeof fakeServer>
  token: (changes?: Partial<LicensePayload>) => string
}

async function shop(config: Partial<LicenseConfig> = {}): Promise<Context> {
  const server = fakeServer()
  const { harness, owner } = await onboarded({
    license: { publicKey: keys.publicKey, serverUrl: 'https://licenses.test', fingerprint: DEVICE, fetch: server.fetch, ...config },
  })
  const token = (changes: Partial<LicensePayload> = {}) =>
    signLicenseToken(
      {
        v: 1,
        licenseId: 'l1',
        customer: 'صيدلية النور',
        fingerprint: DEVICE,
        issuedAt: harness.time.now,
        expiresAt: harness.time.now + 10 * DAY,
        suspended: false,
        ...changes,
      },
      keys.privateKey,
    )
  return { harness, session: owner.token, server, token }
}

const info = ({ harness, session }: Context) => harness.json<LicenseInfo>('GET', '/license', { session })

const install = ({ harness, session }: Context, code: string) => harness.json<LicenseInfo>('POST', '/license/offline', { session, body: { code } })

/** Moves the clock on and signs in again, because a session doesn't last that long. */
async function advance(context: Context, days: number): Promise<void> {
  context.harness.time.now += days * DAY
  const login = await context.harness.json<{ token: string }>('POST', '/auth/login', { body: { username: OWNER.username, password: OWNER.password } })
  context.session = login.token
}

const addCategory = ({ harness, session }: Context) => harness.call('POST', '/catalog/categories', { session, body: { name: 'تصنيف' } })

describe('before activation', () => {
  it('reports unlicensed, and shows the device id for an offline code', async () => {
    expect(await info(await shop())).toMatchObject({ enforced: true, status: 'unlicensed', reason: null, deviceId: DEVICE })
  })

  it('refuses changes but keeps reading', async () => {
    const context = await shop()
    const response = await addCategory(context)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'LICENSE_READ_ONLY' })
    expect((await context.harness.call('GET', '/products', { session: context.session })).status).toBe(200)
  })
})

describe('activating online', () => {
  let context: Context
  beforeEach(async () => {
    context = await shop()
  })

  const activate = (serial = 'AAAAA-BBBBB-CCCCC-DDDDD') => context.harness.call('POST', '/license/activate', { session: context.session, body: { serial } })

  it('sends the serial and this device, and keeps the token it gets back', async () => {
    context.server.respond = () => reply(200, { token: context.token() })
    expect((await activate()).status).toBe(200)

    expect(context.server.calls[0]).toMatchObject({ path: '/v1/activate', body: { serial: 'AAAAA-BBBBB-CCCCC-DDDDD', fingerprint: DEVICE } })
    expect(await info(context)).toMatchObject({ status: 'active', daysLeft: 10, customer: 'صيدلية النور' })
    expect((await addCategory(context)).status).toBe(200)
  })

  it.each([
    ['SERIAL_UNKNOWN', 404, 'LICENSE_SERIAL_INVALID'],
    ['LICENSE_BOUND', 409, 'LICENSE_TAKEN'],
    ['LICENSE_SUSPENDED', 403, 'LICENSE_STOPPED'],
    ['LICENSE_REVOKED', 403, 'LICENSE_STOPPED'],
    ['RATE_LIMITED', 429, 'LICENSE_RATE_LIMITED'],
  ])('explains %s', async (code, status, expected) => {
    context.server.respond = () => reply(status, { code })
    expect(await (await activate()).json()).toMatchObject({ code: expected })
  })

  it('says so when the server cannot be reached', async () => {
    context.server.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
    const offline = await shop({ fetch: () => Promise.reject(new Error('offline')) })
    const response = await offline.harness.call('POST', '/license/activate', { session: offline.session, body: { serial: 'x' } })
    expect(await response.json()).toMatchObject({ code: 'LICENSE_SERVER_UNREACHABLE' })
  })

  it('refuses a token that was not signed by the real key', async () => {
    const forged = signLicenseToken(
      { v: 1, licenseId: 'l', customer: 'x', fingerprint: DEVICE, issuedAt: 1, expiresAt: Date.now() + 1e12, suspended: false },
      generateLicenseKeys().privateKey,
    )
    context.server.respond = () => reply(200, { token: forged })
    expect(await (await activate()).json()).toMatchObject({ code: 'LICENSE_TOKEN_INVALID' })
    expect((await info(context)).status).toBe('unlicensed')
  })

  it('will not talk to a license server over plain http', async () => {
    const insecure = await shop({ serverUrl: 'http://licenses.test' })
    const response = await insecure.harness.call('POST', '/license/activate', { session: insecure.session, body: { serial: 'x' } })
    expect(await response.json()).toMatchObject({ code: 'LICENSE_SERVER_UNREACHABLE' })
    expect(insecure.server.calls).toEqual([])
  })

  it('leaves activation to whoever manages settings', async () => {
    const { harness, session } = context
    await install(context, context.token())
    await harness.json('POST', '/users', { session, body: { fullName: 'موظف', username: 'till', password: 'temporary-password', roleId: 'cashier' } })
    expect((await harness.failure('POST', '/license/activate', { session: await staffSession(harness), body: { serial: 'x' } })).code).toBe('FORBIDDEN')
  })
})

async function staffSession(harness: Harness): Promise<string> {
  const login = await harness.json<{ token: string }>('POST', '/auth/login', { body: { username: 'till', password: 'temporary-password' } })
  await harness.json('POST', '/auth/change-password', { session: login.token, body: { currentPassword: 'temporary-password', newPassword: 'staff-password' } })
  return login.token
}

describe('an offline code', () => {
  it('activates a shop with no internet', async () => {
    const context = await shop()
    expect(await install(context, context.token())).toMatchObject({ status: 'active' })
    expect(context.server.calls).toEqual([])
  })

  it('refuses a code made for another device, under the field', async () => {
    const context = await shop()
    const failure = await context.harness.failure('POST', '/license/offline', { session: context.session, body: { code: context.token({ fingerprint: 'b'.repeat(32) }) } })
    expect(failure.fields).toEqual({ code: ['LICENSE_OTHER_DEVICE'] })
  })

  it('refuses nonsense, under the field', async () => {
    const context = await shop()
    const failure = await context.harness.failure('POST', '/license/offline', { session: context.session, body: { code: 'not-a-code' } })
    expect(failure.fields).toEqual({ code: ['LICENSE_TOKEN_INVALID'] })
  })
})

describe('as time passes', () => {
  it('warns through the grace period, then reads only', async () => {
    const context = await shop()
    await install(context, context.token())

    await advance(context, 12)
    expect(await info(context)).toMatchObject({ status: 'grace', reason: 'expired', daysLeft: 5 })
    expect((await addCategory(context)).status).not.toBe(403)

    await advance(context, 6)
    expect(await info(context)).toMatchObject({ status: 'read_only', reason: 'expired' })
    expect(await (await addCategory(context)).json()).toMatchObject({ code: 'LICENSE_READ_ONLY' })
  })
})

describe('read-only mode', () => {
  let context: Context

  beforeEach(async () => {
    context = await shop()
    await install(context, context.token({ suspended: true }))
  })

  it('stops selling and editing', async () => {
    const { harness, session } = context
    const body = { requestId: 'request-one', lines: [], tenders: [] }
    expect((await harness.failure('POST', '/sales', { session, body })).code).toBe('LICENSE_READ_ONLY')
    expect((await harness.failure('POST', '/shifts', { session, body: { openingCashMinor: 0 } })).code).toBe('LICENSE_READ_ONLY')
    expect((await harness.failure('POST', '/products', { session, body: {} })).code).toBe('LICENSE_READ_ONLY')
    expect((await harness.failure('POST', '/suppliers', { session, body: { name: 'مورد' } })).code).toBe('LICENSE_READ_ONLY')
  })

  it('keeps viewing, reports, backups and signing in', async () => {
    const { harness, session } = context
    expect((await harness.call('GET', '/products', { session })).status).toBe(200)
    expect((await harness.call('GET', '/reports/sales', { session })).status).toBe(200)
    expect((await harness.call('POST', '/backups', { session })).status).toBe(200)
    expect((await harness.call('POST', '/auth/login', { body: { username: 'owner', password: 'wrong-password' } })).status).toBe(401)
  })

  it('still lets a new token in, or the shop could never be renewed', async () => {
    expect(await install(context, context.token())).toMatchObject({ status: 'active' })
  })
})

describe('checking in', () => {
  it('picks up an extension', async () => {
    const context = await shop()
    await install(context, context.token())
    context.server.respond = () => reply(200, { status: 'ok', token: context.token({ expiresAt: context.harness.time.now + 100 * DAY }) })

    const updated = await context.harness.json<LicenseInfo>('POST', '/license/check-in', { session: context.session })
    expect(updated).toMatchObject({ status: 'active', daysLeft: 100 })
  })

  it('picks up a suspension, the moment it is online', async () => {
    const context = await shop()
    await install(context, context.token())
    context.server.respond = () => reply(200, { status: 'ok', token: context.token({ suspended: true }) })

    const updated = await context.harness.json<LicenseInfo>('POST', '/license/check-in', { session: context.session })
    expect(updated).toMatchObject({ status: 'read_only', reason: 'suspended' })
  })

  it('lets go when the device was unbound', async () => {
    const context = await shop()
    await install(context, context.token())
    context.server.respond = () => reply(200, { status: 'unbound' })

    const updated = await context.harness.json<LicenseInfo>('POST', '/license/check-in', { session: context.session })
    expect(updated).toMatchObject({ status: 'unlicensed' })
  })

  it('reports the failure without touching the license when offline', async () => {
    const context = await shop({ fetch: () => Promise.reject(new Error('offline')) })
    await install(context, context.token())
    const failure = await context.harness.failure('POST', '/license/check-in', { session: context.session })
    expect(failure.code).toBe('LICENSE_SERVER_UNREACHABLE')
    expect(await info(context)).toMatchObject({ status: 'active' })
  })
})

describe('tampering', () => {
  it('gains nothing from winding the clock back', async () => {
    const context = await shop()
    const { harness } = context
    await install(context, context.token())

    harness.time.now += 18 * DAY
    await licenseHeartbeat(harness.deps)
    harness.time.now -= 18 * DAY

    expect(await info(context)).toMatchObject({ status: 'read_only', reason: 'expired' })
  })

  it('does not honour a license copied from another device', async () => {
    const context = await shop()
    await install(context, context.token())

    const other = await shop({ fingerprint: 'c'.repeat(32) })
    const stored = await context.harness.deps.db.selectFrom('settings').selectAll().where('key', '=', 'license').executeTakeFirstOrThrow()
    await other.harness.deps.db.insertInto('settings').values(stored).onConflict((oc) => oc.column('key').doUpdateSet({ value: stored.value })).execute()

    expect(await info(other)).toMatchObject({ status: 'unlicensed', reason: 'other_device' })
  })

  it('does not take a token edited in the database', async () => {
    const context = await shop()
    await install(context, context.token())
    const { db } = context.harness.deps
    const stored = await db.selectFrom('settings').selectAll().where('key', '=', 'license').executeTakeFirstOrThrow()
    const value = JSON.parse(stored.value) as { token: string }
    const [body, signature] = value.token.split('.') as [string, string]
    const changed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicensePayload
    changed.expiresAt += 3650 * DAY
    value.token = `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`
    await db.updateTable('settings').set({ value: JSON.stringify(value) }).where('key', '=', 'license').execute()

    expect((await info(context)).status).toBe('unlicensed')
  })
})

describe('without licensing configured', () => {
  it('is out of the way, as in every other test', async () => {
    const { harness, owner } = await onboarded()
    expect(await harness.json<LicenseInfo>('GET', '/license', { session: owner.token })).toMatchObject({ enforced: false, status: 'active' })
    const product = await harness.call('GET', '/products', { session: owner.token })
    expect(product.status).toBe(200)
    expect(((await product.json()) as { items: Product[] }).items).toEqual([])
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyLicenseToken } from '@inv/license-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, PUBLIC_URL, createHarness, type Harness } from './harness'

const DAY = 86_400_000
const DEVICE = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

async function addCustomer(harness: Harness, name = 'صيدلية النور') {
  const response = await harness.admin('POST', '/admin/customers', { name, phone: '01000000000', businessType: 'pharmacy' })
  return ((await response.json()) as { id: string }).id
}

async function issue(harness: Harness, customerId: string, amount = 7, unit = 'day') {
  const response = await harness.admin('POST', `/admin/customers/${customerId}/licenses`, { amount, unit })
  return (await response.json()) as { id: string; serial: string }
}

async function activate(harness: Harness, serial: string, fingerprint = DEVICE) {
  return harness.fetch('/v1/activate', json({ serial, fingerprint, deviceName: 'كاشير 1', appVersion: '0.0.1' }, { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` }))
}

async function tokenOf(harness: Harness, response: Response) {
  const { token } = (await response.json()) as { token: string }
  return verifyLicenseToken(token, harness.publicKey)
}

const checkIn = (harness: Harness, licenseId: string, fingerprint = DEVICE) =>
  harness.fetch('/v1/check-in', json({ licenseId, fingerprint }, { 'x-forwarded-for': '10.1.1.1' }))

const licenseOf = async (harness: Harness, id: string) => (await (await harness.admin('GET', `/admin/licenses/${id}`)).json()) as {
  state: string
  expiresAt: number | null
  fingerprint: string | null
  events: Array<{ action: string; actor: string }>
}

describe('getting into the panel', () => {
  it('has no public sign-up', async () => {
    const harness = await createHarness()
    const response = await harness.fetch('/api/auth/sign-up/email', json({ name: 'x', email: 'x@example.com', password: 'a-long-enough-password' }, { origin: PUBLIC_URL }))
    expect(response.ok).toBe(false)
  })

  it('turns away anyone without a session', async () => {
    const harness = await createHarness()
    expect((await harness.fetch('/admin/overview')).status).toBe(401)
  })

  it('reaches nothing until TOTP is set up', async () => {
    const harness = await createHarness({ enrol: false })
    const signedIn = await harness.fetch('/api/auth/sign-in/email', json({ email: ADMIN.email, password: ADMIN.password }, { origin: PUBLIC_URL }))
    const cookie = signedIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')

    const response = await harness.fetch('/admin/overview', { headers: { cookie } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'TOTP_REQUIRED' })
  })

  it('needs the code on every sign-in once it is set up', async () => {
    const harness = await createHarness()
    const first = await harness.fetch('/api/auth/sign-in/email', json({ email: ADMIN.email, password: ADMIN.password }, { origin: PUBLIC_URL }))
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true })

    const cookie = first.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    expect((await harness.fetch('/admin/overview', { headers: { cookie } })).status).toBe(401)

    await harness.signIn()
    expect((await harness.admin('GET', '/admin/overview')).status).toBe(200)
  })

  it('refuses a change sent from another site', async () => {
    const harness = await createHarness()
    const customerId = await addCustomer(harness)
    const cookie = await harness.signIn()

    const response = await harness.fetch(`/admin/customers/${customerId}/licenses`, json({ amount: 7, unit: 'day' }, { cookie, origin: 'https://evil.example' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'FORBIDDEN_ORIGIN' })
  })
})

describe('activating', () => {
  let harness: Harness
  beforeAll(async () => {
    harness = await createHarness()
  })

  it('shows a serial once and keeps only its hash', async () => {
    const customerId = await addCustomer(harness)
    const { id, serial } = await issue(harness, customerId)

    const row = await harness.deps.db.selectFrom('licenses').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    expect(JSON.stringify(row)).not.toContain(serial)
    expect(row.serial_hint).toBe(serial.slice(-5))
    expect(JSON.stringify(await (await harness.admin('GET', `/admin/licenses/${id}`)).json())).not.toContain(serial)
  })

  it('starts the clock at the first activation, not at issue', async () => {
    const customerId = await addCustomer(harness)
    const { id, serial } = await issue(harness, customerId, 7, 'day')

    harness.time.now += 30 * DAY
    const payload = await tokenOf(harness, await activate(harness, serial))

    expect(payload).toMatchObject({ licenseId: id, customer: 'صيدلية النور', fingerprint: DEVICE, suspended: false })
    expect(payload!.expiresAt).toBe(harness.time.now + 7 * DAY)
    expect((await licenseOf(harness, id)).events.map(({ action }) => action)).toEqual(['license.activated', 'license.issued'])
  })

  it('accepts a serial however it was typed', async () => {
    const { serial } = await issue(harness, await addCustomer(harness))
    expect((await activate(harness, serial.toLowerCase().replace(/-/g, ' '))).status).toBe(200)
  })

  it('lets the same device reinstall without moving the expiry', async () => {
    const { serial } = await issue(harness, await addCustomer(harness), 1, 'month')
    const first = await tokenOf(harness, await activate(harness, serial))
    harness.time.now += 5 * DAY
    const second = await tokenOf(harness, await activate(harness, serial))
    expect(second!.expiresAt).toBe(first!.expiresAt)
  })

  it('stays on one device', async () => {
    const { serial } = await issue(harness, await addCustomer(harness))
    await activate(harness, serial)
    const response = await activate(harness, serial, OTHER)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'LICENSE_BOUND' })
  })

  it('moves to a new device only after being unbound', async () => {
    const { id, serial } = await issue(harness, await addCustomer(harness))
    await activate(harness, serial)
    await harness.admin('POST', `/admin/licenses/${id}/unbind`)

    expect(await (await checkIn(harness, id)).json()).toEqual({ status: 'unbound' })
    expect((await activate(harness, serial, OTHER)).status).toBe(200)
  })

  it('knows nothing of a made-up serial', async () => {
    const response = await activate(harness, 'AAAAA-BBBBB-CCCCC-DDDDD')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'SERIAL_UNKNOWN' })
  })

  it('validates what a device sends', async () => {
    const response = await harness.fetch('/v1/activate', json({ serial: 'x', fingerprint: 'short' }, { 'x-forwarded-for': '10.9.9.9' }))
    expect(response.status).toBe(422)
  })

  it('slows down anyone guessing serials', async () => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await harness.fetch('/v1/activate', json({ serial: 'AAAAA-BBBBB-CCCCC-DDDDD', fingerprint: DEVICE }, { 'x-forwarded-for': '10.2.2.2' }))
      statuses.push(response.status)
    }
    expect(statuses.slice(0, 10).every((status) => status === 404)).toBe(true)
    expect(statuses.slice(10)).toEqual([429, 429])
  })
})

describe('managing a license', () => {
  let harness: Harness
  let id: string
  let serial: string

  beforeAll(async () => {
    harness = await createHarness()
    ;({ id, serial } = await issue(harness, await addCustomer(harness), 10, 'day'))
    await activate(harness, serial)
  })

  it('extends from the expiry when renewed early, and the device hears at check-in', async () => {
    const before = await licenseOf(harness, id)
    harness.time.now += 3 * DAY
    await harness.admin('POST', `/admin/licenses/${id}/extend`, { amount: 1, unit: 'month' })

    const after = await licenseOf(harness, id)
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt! + 27 * DAY)

    const payload = await tokenOf(harness, await checkIn(harness, id))
    expect(payload!.expiresAt).toBe(after.expiresAt)
  })

  it('extends from today once it has lapsed', async () => {
    const { expiresAt } = await licenseOf(harness, id)
    harness.time.now = expiresAt! + 20 * DAY
    await harness.admin('POST', `/admin/licenses/${id}/extend`, { amount: 10, unit: 'day' })
    expect((await licenseOf(harness, id)).expiresAt).toBe(harness.time.now + 10 * DAY)
  })

  it('tells a device it was suspended, and lets it back on resume', async () => {
    await harness.admin('POST', `/admin/licenses/${id}/suspend`)
    expect((await tokenOf(harness, await checkIn(harness, id)))!.suspended).toBe(true)
    expect(await (await activate(harness, serial)).json()).toEqual({ code: 'LICENSE_SUSPENDED' })

    await harness.admin('POST', `/admin/licenses/${id}/resume`)
    expect((await tokenOf(harness, await checkIn(harness, id)))!.suspended).toBe(false)
  })

  it('replaces a lost serial, and the old one stops working', async () => {
    const { serial: fresh } = (await (await harness.admin('POST', `/admin/licenses/${id}/reissue`)).json()) as { serial: string }
    expect((await activate(harness, serial)).status).toBe(404)
    expect((await activate(harness, fresh)).status).toBe(200)
    serial = fresh
  })

  it('binds a shop with no internet through an offline code', async () => {
    const offline = await issue(harness, await addCustomer(harness, 'محل بدون نت'), 1, 'year')
    const response = await harness.admin('POST', `/admin/licenses/${offline.id}/offline`, { fingerprint: OTHER })
    const payload = await tokenOf(harness, response)
    expect(payload).toMatchObject({ fingerprint: OTHER, suspended: false })

    const refused = await harness.admin('POST', `/admin/licenses/${offline.id}/offline`, { fingerprint: DEVICE })
    expect(refused.status).toBe(409)
  })

  it('cannot extend what never started', async () => {
    const unused = await issue(harness, await addCustomer(harness))
    const response = await harness.admin('POST', `/admin/licenses/${unused.id}/extend`, { amount: 1, unit: 'day' })
    expect(await response.json()).toEqual({ code: 'LICENSE_NOT_ACTIVATED' })
  })

  it('ends for good when revoked', async () => {
    const gone = await issue(harness, await addCustomer(harness))
    await activate(harness, gone.serial)
    await harness.admin('POST', `/admin/licenses/${gone.id}/revoke`)

    expect((await tokenOf(harness, await checkIn(harness, gone.id)))!.suspended).toBe(true)
    expect(await (await activate(harness, gone.serial)).json()).toEqual({ code: 'LICENSE_REVOKED' })
    expect((await harness.admin('POST', `/admin/licenses/${gone.id}/resume`)).status).toBe(409)
    expect((await harness.admin('POST', `/admin/licenses/${gone.id}/extend`, { amount: 1, unit: 'day' })).status).toBe(409)
  })
})

describe('the books', () => {
  it('records manual payments against the customer', async () => {
    const harness = await createHarness()
    const customerId = await addCustomer(harness)
    await harness.admin('POST', '/admin/payments', { customerId, amountMinor: 150_000, paidOn: '2026-06-15', method: 'vodafone_cash', note: 'سنة' })

    const customer = (await (await harness.admin('GET', `/admin/customers/${customerId}`)).json()) as { payments: Array<{ amountMinor: number; method: string; recordedBy: string }> }
    expect(customer.payments).toEqual([expect.objectContaining({ amountMinor: 150_000, method: 'vodafone_cash', recordedBy: ADMIN.email })])
  })

  it('refuses a payment method it does not know', async () => {
    const harness = await createHarness()
    const customerId = await addCustomer(harness)
    const response = await harness.admin('POST', '/admin/payments', { customerId, amountMinor: 100, paidOn: '2026-06-15', method: 'bitcoin' })
    expect(response.status).toBe(422)
  })

  it('counts what is active, expiring and lapsed', async () => {
    const harness = await createHarness()
    const customerId = await addCustomer(harness)
    await issue(harness, customerId)
    await activate(harness, (await issue(harness, customerId, 5, 'day')).serial)
    await activate(harness, (await issue(harness, customerId, 20, 'day')).serial, 'c'.repeat(32))
    await activate(harness, (await issue(harness, customerId, 1, 'year')).serial, 'd'.repeat(32))

    const before = (await (await harness.admin('GET', '/admin/overview')).json()) as { counts: Record<string, number>; expiring: unknown[] }
    expect(before.counts).toEqual({ active: 3, expiringIn7: 1, expiringIn30: 2, expired: 0, issued: 1, suspended: 0 })
    expect(before.expiring).toHaveLength(2)

    harness.time.now += 6 * DAY
    await harness.signIn()
    const after = (await (await harness.admin('GET', '/admin/overview')).json()) as { counts: Record<string, number> }
    expect(after.counts).toMatchObject({ active: 2, expired: 1 })
  })

  it('keeps an audit trail of who did what', async () => {
    const harness = await createHarness()
    const { id } = await issue(harness, await addCustomer(harness))
    await harness.admin('POST', `/admin/licenses/${id}/suspend`)

    const { items } = (await (await harness.admin('GET', '/admin/events')).json()) as { items: Array<{ action: string; actor: string; customerName: string }> }
    expect(items.map(({ action }) => action)).toEqual(['license.suspended', 'license.issued', 'customer.created'])
    expect(items[0]).toMatchObject({ actor: ADMIN.email, customerName: 'صيدلية النور' })
  })
})

describe('publishing updates', () => {
  it('serves the folder and nothing outside it', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'inv-updates-'))
    const folder = join(parent, 'updates')
    mkdirSync(folder)
    writeFileSync(join(folder, 'manifest.json'), '{"signed":true}')
    writeFileSync(join(parent, 'private.pem'), 'SECRET')

    try {
      const harness = await createHarness({ updatesDir: folder })
      const served = await harness.fetch('/updates/manifest.json')
      expect(served.status).toBe(200)
      expect(await served.text()).toBe('{"signed":true}')

      expect((await harness.fetch('/updates/missing.exe')).status).toBe(404)
      for (const path of ['/updates/../private.pem', '/updates/..%2fprivate.pem', '/updates/%2e%2e/private.pem', '/updates/..%5cprivate.pem']) {
        const response = await harness.fetch(path)
        expect(await response.text()).not.toContain('SECRET')
      }
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

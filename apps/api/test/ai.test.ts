import { signLicenseToken, generateLicenseKeys } from '@inv/license-core'
import { aiStatusSchema } from '@inv/contracts'
import { describe, expect, it } from 'vitest'
import { licenseHeartbeat } from '../src/modules/license'
import { storeSettings } from '../src/modules/store'
import { onboarded } from './harness'

const KEY = 'device-key-from-server'
const FINGERPRINT = 'c'.repeat(32)

async function licensed(ai: unknown) {
  const keys = generateLicenseKeys()
  let answer: unknown = { status: 'ok', ai }
  const { harness, owner } = await onboarded({
    license: {
      publicKey: keys.publicKey,
      serverUrl: 'http://127.0.0.1:1',
      fingerprint: FINGERPRINT,
      fetch: async () => new Response(JSON.stringify(answer), { status: 200 }),
    },
  })

  const token = signLicenseToken(
    { v: 1, licenseId: 'lic', customer: 'صيدلية', fingerprint: FINGERPRINT, issuedAt: harness.time.now, expiresAt: harness.time.now + 1e10, suspended: false },
    keys.privateKey,
  )
  await storeSettings(harness.deps.db).setLicense({ token, lastSeenAt: harness.time.now }, harness.time.now)
  answer = { status: 'ok', token, ai }
  const setAnswer = (next: unknown) => {
    answer = next
  }
  return { harness, owner, token, setAnswer }
}

const status = (harness: Awaited<ReturnType<typeof onboarded>>['harness'], session: string) => harness.json('GET', '/ai', { session }).then((value) => aiStatusSchema.parse(value))

describe('the AI add-on on the device', () => {
  it('starts off, for a shop that has never heard of it', async () => {
    const { harness, owner } = await onboarded()
    expect(await status(harness, owner.token)).toEqual({ available: false, consentedAt: null, used: 0, monthlyLimit: 0 })
  })

  it('learns about the add-on at check-in', async () => {
    const { harness, owner } = await licensed({ enabled: true, key: KEY, monthlyLimit: 100, used: 7 })
    await licenseHeartbeat(harness.deps)
    expect(await status(harness, owner.token)).toMatchObject({ available: true, used: 7, monthlyLimit: 100 })
  })

  it('never shows the device key to a screen', async () => {
    const { harness, owner } = await licensed({ enabled: true, key: KEY, monthlyLimit: 100, used: 0 })
    await licenseHeartbeat(harness.deps)

    expect((await storeSettings(harness.deps.db).ai()).key).toBe(KEY)
    const response = await harness.call('GET', '/ai', { session: owner.token })
    expect(await response.text()).not.toContain(KEY)
  })

  it('forgets the key when the add-on is switched off, but keeps the owner’s answer', async () => {
    const { harness, owner, token, setAnswer } = await licensed({ enabled: true, key: KEY, monthlyLimit: 100, used: 0 })
    await licenseHeartbeat(harness.deps)
    await harness.json('PUT', '/ai/consent', { session: owner.token, body: { accepted: true } })

    setAnswer({ status: 'ok', token, ai: { enabled: false } })
    await licenseHeartbeat(harness.deps)

    const stored = await storeSettings(harness.deps.db).ai()
    expect(stored).toMatchObject({ enabled: false, key: null })
    expect(stored.consentedAt).toBe(harness.time.now)
  })

  it('needs the owner’s word, records it, and lets it be taken back', async () => {
    const { harness, owner } = await onboarded()
    const given = aiStatusSchema.parse(await harness.json('PUT', '/ai/consent', { session: owner.token, body: { accepted: true } }))
    expect(given.consentedAt).toBe(harness.time.now)

    const withdrawn = aiStatusSchema.parse(await harness.json('PUT', '/ai/consent', { session: owner.token, body: { accepted: false } }))
    expect(withdrawn.consentedAt).toBeNull()

    const actions = await harness.deps.db.selectFrom('audit_log').select('action').where('action', 'like', 'ai.%').orderBy('occurred_at').execute()
    expect(actions.map(({ action }) => action).sort()).toEqual(['ai.consent_given', 'ai.consent_withdrawn'])
  })

  it('leaves the choice to whoever manages the shop', async () => {
    const { harness, owner } = await onboarded()
    await harness.json('POST', '/users', { session: owner.token, body: { fullName: 'كاشير', username: 'cashier', password: 'cashier-password', roleId: 'cashier' } })
    const login = await harness.json<{ token: string }>('POST', '/auth/login', { body: { username: 'cashier', password: 'cashier-password' } })
    await harness.json('POST', '/auth/change-password', { session: login.token, body: { currentPassword: 'cashier-password', newPassword: 'new-cashier-password' } })
    const cashier = await harness.json<{ token: string }>('POST', '/auth/login', { body: { username: 'cashier', password: 'new-cashier-password' } })

    expect((await harness.failure('PUT', '/ai/consent', { session: cashier.token, body: { accepted: true } })).status).toBe(403)
  })

  it('gives a new shop the same permissions an upgraded one gets', async () => {
    const { harness, owner } = await onboarded()
    const { items } = await harness.json<{ items: Array<{ id: string; permissions: string[] }> }>('GET', '/roles', { session: owner.token })
    const of = (id: string) => items.find((role) => role.id === id)!.permissions.filter((permission) => permission.startsWith('ai.')).sort()

    expect(of('manager')).toEqual(['ai.assistant', 'ai.invoices'])
    expect(of('storekeeper')).toEqual(['ai.invoices'])
    expect(of('cashier')).toEqual([])
  })

  it('lets a stopped shop take its consent back, and nothing else', async () => {
    const keys = generateLicenseKeys()
    const { harness, owner } = await onboarded({ license: { publicKey: keys.publicKey, serverUrl: 'http://127.0.0.1:1', fingerprint: FINGERPRINT } })
    const response = await harness.call('PUT', '/ai/consent', { session: owner.token, body: { accepted: false } })
    expect(response.status).toBe(200)
  })
})

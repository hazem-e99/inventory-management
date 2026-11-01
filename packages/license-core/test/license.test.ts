import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  GRACE_DAYS,
  addDuration,
  evaluateLicense,
  generateLicenseKeys,
  generateSerial,
  hashSerial,
  normalizeSerial,
  renewedExpiry,
  serialHint,
  signLicenseToken,
  verifyLicenseToken,
  type LicensePayload,
} from '../src'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 5, 15)
const keys = generateLicenseKeys()

const payload = (changes: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1,
  licenseId: 'l1',
  customer: 'صيدلية النور',
  fingerprint: 'device',
  issuedAt: NOW,
  expiresAt: NOW + 10 * DAY,
  suspended: false,
  ...changes,
})

describe('license tokens', () => {
  it('survive a round trip, Arabic names included', () => {
    expect(verifyLicenseToken(signLicenseToken(payload(), keys.privateKey), keys.publicKey)).toEqual(payload())
  })

  it('reject another key', () => {
    const other = generateLicenseKeys()
    expect(verifyLicenseToken(signLicenseToken(payload(), other.privateKey), keys.publicKey)).toBeNull()
  })

  it('reject any change to what was signed', () => {
    const token = signLicenseToken(payload(), keys.privateKey)
    const [, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify(payload({ expiresAt: NOW + 3650 * DAY }))).toString('base64url')
    expect(verifyLicenseToken(`${forged}.${signature}`, keys.publicKey)).toBeNull()
  })

  it('reject whatever else gets pasted in', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(verifyLicenseToken(text, keys.publicKey)).toBeNull()
      }),
    )
    expect(verifyLicenseToken('a.b.c', keys.publicKey)).toBeNull()
  })

  it('tolerate the spaces a paste brings', () => {
    expect(verifyLicenseToken(`  ${signLicenseToken(payload(), keys.privateKey)}\n`, keys.publicKey)).not.toBeNull()
  })
})

describe('serials', () => {
  it('come in four groups of five, and never repeat', () => {
    const serials = Array.from({ length: 200 }, generateSerial)
    for (const serial of serials) expect(serial).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){3}[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(new Set(serials).size).toBe(200)
  })

  it('forgive how people type them', () => {
    const serial = generateSerial()
    expect(normalizeSerial(serial)).toBe(serial)
    expect(normalizeSerial(serial.toLowerCase().replace(/-/g, ' '))).toBe(serial)
    expect(normalizeSerial('ABCD0-1234L-O0000-11111')).toBe('ABCD0-12341-00000-11111')
  })

  it('refuse what cannot be one', () => {
    expect(normalizeSerial('short')).toBeNull()
    expect(normalizeSerial('UUUUU-UUUUU-UUUUU-UUUUU')).toBeNull()
  })

  it('hash differently under another key, and hint only at the end', () => {
    const serial = generateSerial()
    expect(hashSerial(serial, 'a')).not.toBe(hashSerial(serial, 'b'))
    expect(serialHint('AAAAA-BBBBB-CCCCC-DDDDD')).toBe('DDDDD')
  })
})

describe('durations', () => {
  it('add days and weeks', () => {
    expect(addDuration(NOW, 3, 'day')).toBe(NOW + 3 * DAY)
    expect(addDuration(NOW, 2, 'week')).toBe(NOW + 14 * DAY)
  })

  it('keep to the calendar for months and years', () => {
    expect(new Date(addDuration(Date.UTC(2026, 0, 31), 1, 'month')).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(new Date(addDuration(Date.UTC(2028, 1, 29), 1, 'year')).toISOString().slice(0, 10)).toBe('2029-02-28')
    expect(new Date(addDuration(Date.UTC(2026, 10, 15), 3, 'month')).toISOString().slice(0, 10)).toBe('2027-02-15')
  })

  it('renew from the later of now and the expiry', () => {
    expect(renewedExpiry(NOW + 5 * DAY, NOW, 10, 'day')).toBe(NOW + 15 * DAY)
    expect(renewedExpiry(NOW - 5 * DAY, NOW, 10, 'day')).toBe(NOW + 10 * DAY)
    expect(renewedExpiry(null, NOW, 10, 'day')).toBe(NOW + 10 * DAY)
  })
})

describe('evaluateLicense', () => {
  const at = (moment: number, token: LicensePayload | null = payload(), lastSeenAt = 0, fingerprint = 'device') =>
    evaluateLicense(token, fingerprint, moment, lastSeenAt)

  it('starts unlicensed', () => {
    expect(at(NOW, null)).toMatchObject({ status: 'unlicensed', reason: null })
  })

  it('is active until the expiry, counting the days', () => {
    expect(at(NOW)).toMatchObject({ status: 'active', daysLeft: 10 })
    expect(at(NOW + 9.5 * DAY)).toMatchObject({ status: 'active', daysLeft: 1 })
  })

  it('then gives seven days of grace, then reads only', () => {
    expect(at(NOW + 10 * DAY)).toMatchObject({ status: 'grace', reason: 'expired', daysLeft: GRACE_DAYS })
    expect(at(NOW + 17 * DAY - 1)).toMatchObject({ status: 'grace', daysLeft: 1 })
    expect(at(NOW + 17 * DAY)).toMatchObject({ status: 'read_only', reason: 'expired', daysLeft: 0 })
  })

  it('reads only at once when suspended, whatever the date', () => {
    expect(at(NOW, payload({ suspended: true }))).toMatchObject({ status: 'read_only', reason: 'suspended' })
  })

  it('does not travel to another device', () => {
    expect(at(NOW, payload(), 0, 'elsewhere')).toMatchObject({ status: 'unlicensed', reason: 'other_device' })
  })

  it('gains nothing from winding the clock back', () => {
    expect(at(NOW, payload(), NOW + 30 * DAY)).toMatchObject({ status: 'read_only', reason: 'expired' })
  })

  it('only ever steps down as time passes', () => {
    const order = { active: 0, grace: 1, read_only: 2, unlicensed: 3 }
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 * DAY }), fc.integer({ min: 0, max: 40 * DAY }), (first, second) => {
        const [early, late] = first < second ? [first, second] : [second, first]
        expect(order[at(NOW + early).status]).toBeLessThanOrEqual(order[at(NOW + late).status])
      }),
    )
  })
})

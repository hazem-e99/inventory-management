import type { LicensePayload } from './token'

export const GRACE_DAYS = 7

const DAY_MS = 86_400_000

export const LICENSE_STATUSES = ['active', 'grace', 'read_only', 'unlicensed'] as const
export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

export const LICENSE_REASONS = ['expired', 'suspended', 'other_device'] as const
export type LicenseReason = (typeof LICENSE_REASONS)[number]

export interface LicenseState {
  status: LicenseStatus
  reason: LicenseReason | null
  expiresAt: number | null
  graceEndsAt: number | null
  /** Whole days until the next step down: to the expiry, then to the end of the grace period. */
  daysLeft: number | null
}

const daysUntil = (moment: number, now: number) => Math.max(Math.ceil((moment - now) / DAY_MS), 0)

/**
 * What the shop may do right now. Everything is decided here, offline, from a signed token.
 * `lastSeenAt` is the latest moment this device has been known to reach: time never runs
 * backwards for a license, so setting the clock back buys nothing.
 */
export function evaluateLicense(payload: LicensePayload | null, fingerprint: string, now: number, lastSeenAt: number): LicenseState {
  if (!payload) return { status: 'unlicensed', reason: null, expiresAt: null, graceEndsAt: null, daysLeft: null }
  if (payload.fingerprint !== fingerprint) {
    return { status: 'unlicensed', reason: 'other_device', expiresAt: null, graceEndsAt: null, daysLeft: null }
  }

  const { expiresAt } = payload
  const graceEndsAt = expiresAt + GRACE_DAYS * DAY_MS
  const moment = Math.max(now, lastSeenAt)

  if (payload.suspended) return { status: 'read_only', reason: 'suspended', expiresAt, graceEndsAt, daysLeft: null }
  if (moment < expiresAt) return { status: 'active', reason: null, expiresAt, graceEndsAt, daysLeft: daysUntil(expiresAt, moment) }
  if (moment < graceEndsAt) return { status: 'grace', reason: 'expired', expiresAt, graceEndsAt, daysLeft: daysUntil(graceEndsAt, moment) }
  return { status: 'read_only', reason: 'expired', expiresAt, graceEndsAt, daysLeft: 0 }
}

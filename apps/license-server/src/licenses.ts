import { randomUUID } from 'node:crypto'
import { addDuration, generateSerial, hashSerial, serialHint, signLicenseToken, type DurationUnit } from '@inv/license-core'
import type { Kysely, Selectable } from 'kysely'
import type { ServerDeps } from './app'
import type { LicenseDatabase, LicensesTable } from './schema'

export type LicenseRecord = Selectable<LicensesTable>

export interface EventInput {
  actor: string
  action: string
  customerId?: string | null
  licenseId?: string | null
  details?: Record<string, unknown>
}

export function recordEvent(db: Kysely<LicenseDatabase>, now: number, event: EventInput) {
  return db
    .insertInto('events')
    .values({
      occurred_at: now,
      actor: event.actor,
      action: event.action,
      customer_id: event.customerId ?? null,
      license_id: event.licenseId ?? null,
      details: event.details ? JSON.stringify(event.details) : null,
    })
    .execute()
}

/** The token a device holds. A stopped license still gets one, so the device learns it stopped. */
export async function tokenFor(deps: ServerDeps, license: LicenseRecord, fingerprint: string): Promise<string> {
  const customer = await deps.db.selectFrom('customers').select('name').where('id', '=', license.customer_id).executeTakeFirstOrThrow()
  return signLicenseToken(
    {
      v: 1,
      licenseId: license.id,
      customer: customer.name,
      fingerprint,
      issuedAt: deps.clock(),
      expiresAt: Number(license.expires_at),
      suspended: license.state === 'suspended' || license.state === 'revoked',
    },
    deps.privateKey,
  )
}

/** The first activation starts the clock, so a serial sold today isn't shortened by waiting. */
export async function bindDevice(
  deps: ServerDeps,
  license: LicenseRecord,
  device: { fingerprint: string; deviceName?: string | undefined; appVersion?: string | undefined },
  actor: string,
): Promise<LicenseRecord> {
  const now = deps.clock()
  const first = license.activated_at === null

  const updated = await deps.db
    .updateTable('licenses')
    .set({
      state: license.state === 'issued' ? 'active' : license.state,
      fingerprint: device.fingerprint,
      device_name: device.deviceName ?? license.device_name,
      app_version: device.appVersion ?? license.app_version,
      activated_at: license.activated_at ?? now,
      expires_at: license.expires_at ?? addDuration(now, license.duration_amount, license.duration_unit as DurationUnit),
      last_seen_at: now,
      updated_at: now,
    })
    .where('id', '=', license.id)
    .returningAll()
    .executeTakeFirstOrThrow()

  await recordEvent(deps.db, now, {
    actor,
    action: first ? 'license.activated' : 'license.device_bound',
    customerId: license.customer_id,
    licenseId: license.id,
    details: { deviceName: device.deviceName ?? null },
  })
  return updated
}

/** A serial is handed back once, here. Only its keyed hash is kept. */
export async function createLicense(
  deps: ServerDeps,
  input: { customerId: string; amount: number; unit: DurationUnit; notes?: string | null | undefined },
  actor: string,
) {
  const now = deps.clock()
  const serial = generateSerial()
  const id = randomUUID()

  await deps.db
    .insertInto('licenses')
    .values({
      id,
      customer_id: input.customerId,
      serial_hash: hashSerial(serial, deps.serialKey),
      serial_hint: serialHint(serial),
      state: 'issued',
      duration_amount: input.amount,
      duration_unit: input.unit,
      activated_at: null,
      expires_at: null,
      fingerprint: null,
      device_name: null,
      app_version: null,
      last_seen_at: null,
      notes: input.notes ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute()

  await recordEvent(deps.db, now, {
    actor,
    action: 'license.issued',
    customerId: input.customerId,
    licenseId: id,
    details: { amount: input.amount, unit: input.unit },
  })
  return { id, serial }
}

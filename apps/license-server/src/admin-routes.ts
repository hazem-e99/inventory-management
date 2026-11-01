import { randomUUID } from 'node:crypto'
import { DURATION_UNITS, generateSerial, hashSerial, renewedExpiry, serialHint, type DurationUnit } from '@inv/license-core'
import { Hono } from 'hono'
import { sql } from 'kysely'
import { z } from 'zod'
import { ApiError, type ServerDeps, type ServerEnv } from './app'
import { bindDevice, createLicense, recordEvent, tokenFor, type LicenseRecord } from './licenses'

const DAY_MS = 86_400_000
const LIST_LIMIT = 200

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(32).nullish(),
  businessType: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(1000).nullish(),
})

const durationSchema = z.object({
  amount: z.number().int().min(1).max(3650),
  unit: z.enum(DURATION_UNITS),
})

const issueSchema = durationSchema.extend({ notes: z.string().trim().max(500).nullish() })

const paymentSchema = z.object({
  customerId: z.string(),
  licenseId: z.string().nullish(),
  amountMinor: z.number().int().positive().max(100_000_000_000),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['instapay', 'vodafone_cash', 'cash', 'bank']),
  note: z.string().trim().max(500).nullish(),
})

const offlineSchema = z.object({ fingerprint: z.string().regex(/^[0-9a-f]{32}$/) })

async function bodyOf<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 422)
  return parsed.data
}

const toLicense = (row: LicenseRecord) => ({
  id: row.id,
  customerId: row.customer_id,
  serialHint: row.serial_hint,
  state: row.state,
  durationAmount: row.duration_amount,
  durationUnit: row.duration_unit,
  activatedAt: row.activated_at === null ? null : Number(row.activated_at),
  expiresAt: row.expires_at === null ? null : Number(row.expires_at),
  fingerprint: row.fingerprint,
  deviceName: row.device_name,
  appVersion: row.app_version,
  lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
  notes: row.notes,
  createdAt: Number(row.created_at),
})

export function adminRoutes(deps: ServerDeps) {
  const app = new Hono<ServerEnv>()
  const { db } = deps

  // TOTP is not optional here: a session without it reaches nothing but the setup screen.
  app.use('*', async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) throw new ApiError('UNAUTHENTICATED', 401)
    if (!(session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) throw new ApiError('TOTP_REQUIRED', 403)

    // Cookies travel with any request, so a change must come from this panel's own page.
    if (c.req.method !== 'GET' && c.req.header('origin') !== deps.publicUrl) throw new ApiError('FORBIDDEN_ORIGIN', 403)

    c.set('admin', session.user.email)
    await next()
  })

  async function findLicense(id: string): Promise<LicenseRecord> {
    const license = await db.selectFrom('licenses').selectAll().where('id', '=', id).executeTakeFirst()
    if (!license) throw new ApiError('NOT_FOUND', 404)
    return license
  }

  async function setState(id: string, state: string, action: string, actor: string) {
    const license = await findLicense(id)
    if (license.state === 'revoked') throw new ApiError('LICENSE_REVOKED', 409)

    const now = deps.clock()
    const next = state === 'resume' ? (license.activated_at === null ? 'issued' : 'active') : state
    const updated = await db
      .updateTable('licenses')
      .set({ state: next, updated_at: now })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
    await recordEvent(db, now, { actor, action, customerId: license.customer_id, licenseId: id })
    return toLicense(updated)
  }

  app.get('/overview', async (c) => {
    const now = deps.clock()
    const within = (days: number) => sql<number>`count(*) filter (where state = 'active' and expires_at >= ${now} and expires_at < ${now + days * DAY_MS})`

    const counts = await db
      .selectFrom('licenses')
      .select([
        sql<number>`count(*) filter (where state = 'active' and expires_at >= ${now})`.as('active'),
        within(7).as('expiringIn7'),
        within(30).as('expiringIn30'),
        sql<number>`count(*) filter (where state = 'active' and expires_at < ${now})`.as('expired'),
        sql<number>`count(*) filter (where state = 'issued')`.as('issued'),
        sql<number>`count(*) filter (where state = 'suspended')`.as('suspended'),
      ])
      .executeTakeFirstOrThrow()

    const expiring = await db
      .selectFrom('licenses')
      .innerJoin('customers', 'customers.id', 'licenses.customer_id')
      .selectAll('licenses')
      .select('customers.name as customer_name')
      .where('licenses.state', '=', 'active')
      .where('licenses.expires_at', '<', now + 30 * DAY_MS)
      .orderBy('licenses.expires_at')
      .limit(LIST_LIMIT)
      .execute()

    return c.json({
      counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])),
      expiring: expiring.map((row) => ({ ...toLicense(row), customerName: row.customer_name })),
    })
  })

  app.get('/customers', async (c) => {
    const search = c.req.query('search')?.trim()
    const rows = await db
      .selectFrom('customers')
      .selectAll('customers')
      .select((eb) => [
        eb.selectFrom('licenses').select((inner) => inner.fn.countAll<number>().as('count')).whereRef('licenses.customer_id', '=', 'customers.id').as('license_count'),
      ])
      .$if(Boolean(search), (query) =>
        query.where((eb) => eb.or([eb('name', 'ilike', `%${search}%`), eb('phone', 'ilike', `%${search}%`)])),
      )
      .orderBy('name')
      .limit(LIST_LIMIT)
      .execute()

    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        businessType: row.business_type,
        licenseCount: Number(row.license_count),
      })),
    })
  })

  app.post('/customers', async (c) => {
    const input = await bodyOf(c.req.raw, customerSchema)
    const now = deps.clock()
    const id = randomUUID()
    await db
      .insertInto('customers')
      .values({
        id,
        name: input.name,
        phone: input.phone ?? null,
        business_type: input.businessType ?? null,
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      })
      .execute()
    await recordEvent(db, now, { actor: c.get('admin'), action: 'customer.created', customerId: id })
    return c.json({ id })
  })

  app.get('/customers/:id', async (c) => {
    const id = c.req.param('id')
    const customer = await db.selectFrom('customers').selectAll().where('id', '=', id).executeTakeFirst()
    if (!customer) throw new ApiError('NOT_FOUND', 404)

    const [licenses, payments] = await Promise.all([
      db.selectFrom('licenses').selectAll().where('customer_id', '=', id).orderBy('created_at', 'desc').execute(),
      db.selectFrom('payments').selectAll().where('customer_id', '=', id).orderBy('paid_on', 'desc').execute(),
    ])

    return c.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      businessType: customer.business_type,
      notes: customer.notes,
      licenses: licenses.map(toLicense),
      payments: payments.map((row) => ({
        id: row.id,
        licenseId: row.license_id,
        amountMinor: Number(row.amount_minor),
        paidOn: row.paid_on,
        method: row.method,
        note: row.note,
        recordedBy: row.recorded_by,
      })),
    })
  })

  app.put('/customers/:id', async (c) => {
    const id = c.req.param('id')
    const input = await bodyOf(c.req.raw, customerSchema)
    const now = deps.clock()
    const result = await db
      .updateTable('customers')
      .set({
        name: input.name,
        phone: input.phone ?? null,
        business_type: input.businessType ?? null,
        notes: input.notes ?? null,
        updated_at: now,
      })
      .where('id', '=', id)
      .executeTakeFirst()
    if (result.numUpdatedRows === 0n) throw new ApiError('NOT_FOUND', 404)
    await recordEvent(db, now, { actor: c.get('admin'), action: 'customer.updated', customerId: id })
    return c.json({ ok: true })
  })

  app.post('/customers/:id/licenses', async (c) => {
    const customerId = c.req.param('id')
    const input = await bodyOf(c.req.raw, issueSchema)
    const customer = await db.selectFrom('customers').select('id').where('id', '=', customerId).executeTakeFirst()
    if (!customer) throw new ApiError('NOT_FOUND', 404)
    return c.json(await createLicense(deps, { customerId, amount: input.amount, unit: input.unit, notes: input.notes }, c.get('admin')))
  })

  app.get('/licenses/:id', async (c) => {
    const license = await findLicense(c.req.param('id'))
    const [customer, events] = await Promise.all([
      db.selectFrom('customers').select('name').where('id', '=', license.customer_id).executeTakeFirstOrThrow(),
      db.selectFrom('events').selectAll().where('license_id', '=', license.id).orderBy('id', 'desc').limit(LIST_LIMIT).execute(),
    ])
    return c.json({
      ...toLicense(license),
      customerName: customer.name,
      events: events.map((event) => ({
        id: Number(event.id),
        occurredAt: Number(event.occurred_at),
        actor: event.actor,
        action: event.action,
        details: event.details,
      })),
    })
  })

  app.post('/licenses/:id/extend', async (c) => {
    const id = c.req.param('id')
    const { amount, unit } = await bodyOf(c.req.raw, durationSchema)
    const license = await findLicense(id)
    if (license.state === 'revoked') throw new ApiError('LICENSE_REVOKED', 409)
    if (license.expires_at === null) throw new ApiError('LICENSE_NOT_ACTIVATED', 409)

    const now = deps.clock()
    const expiresAt = renewedExpiry(Number(license.expires_at), now, amount, unit as DurationUnit)
    const updated = await db
      .updateTable('licenses')
      .set({ expires_at: expiresAt, updated_at: now })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
    await recordEvent(db, now, {
      actor: c.get('admin'),
      action: 'license.extended',
      customerId: license.customer_id,
      licenseId: id,
      details: { amount, unit, expiresAt },
    })
    return c.json(toLicense(updated))
  })

  app.post('/licenses/:id/suspend', async (c) => c.json(await setState(c.req.param('id'), 'suspended', 'license.suspended', c.get('admin'))))
  app.post('/licenses/:id/resume', async (c) => c.json(await setState(c.req.param('id'), 'resume', 'license.resumed', c.get('admin'))))
  app.post('/licenses/:id/revoke', async (c) => c.json(await setState(c.req.param('id'), 'revoked', 'license.revoked', c.get('admin'))))

  app.post('/licenses/:id/unbind', async (c) => {
    const id = c.req.param('id')
    const license = await findLicense(id)
    const now = deps.clock()
    const updated = await db
      .updateTable('licenses')
      .set({ fingerprint: null, device_name: null, updated_at: now })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
    await recordEvent(db, now, { actor: c.get('admin'), action: 'license.unbound', customerId: license.customer_id, licenseId: id })
    return c.json(toLicense(updated))
  })

  app.post('/licenses/:id/reissue', async (c) => {
    const id = c.req.param('id')
    const license = await findLicense(id)
    if (license.state === 'revoked') throw new ApiError('LICENSE_REVOKED', 409)

    const now = deps.clock()
    const serial = generateSerial()
    await db
      .updateTable('licenses')
      .set({ serial_hash: hashSerial(serial, deps.serialKey), serial_hint: serialHint(serial), updated_at: now })
      .where('id', '=', id)
      .execute()
    await recordEvent(db, now, { actor: c.get('admin'), action: 'license.reissued', customerId: license.customer_id, licenseId: id })
    return c.json({ serial })
  })

  // For a shop with no internet: the code is read out and pasted in, and binds this device.
  app.post('/licenses/:id/offline', async (c) => {
    const { fingerprint } = await bodyOf(c.req.raw, offlineSchema)
    const license = await findLicense(c.req.param('id'))
    if (license.state === 'revoked') throw new ApiError('LICENSE_REVOKED', 409)
    if (license.fingerprint && license.fingerprint !== fingerprint) throw new ApiError('LICENSE_BOUND', 409)

    const bound = await bindDevice(deps, license, { fingerprint, deviceName: 'offline' }, c.get('admin'))
    return c.json({ token: await tokenFor(deps, bound, fingerprint) })
  })

  app.post('/payments', async (c) => {
    const input = await bodyOf(c.req.raw, paymentSchema)
    const customer = await db.selectFrom('customers').select('id').where('id', '=', input.customerId).executeTakeFirst()
    if (!customer) throw new ApiError('NOT_FOUND', 404)

    const now = deps.clock()
    const id = randomUUID()
    await db
      .insertInto('payments')
      .values({
        id,
        customer_id: input.customerId,
        license_id: input.licenseId ?? null,
        amount_minor: input.amountMinor,
        paid_on: input.paidOn,
        method: input.method,
        note: input.note ?? null,
        recorded_by: c.get('admin'),
        created_at: now,
      })
      .execute()
    await recordEvent(db, now, {
      actor: c.get('admin'),
      action: 'payment.recorded',
      customerId: input.customerId,
      licenseId: input.licenseId ?? null,
      details: { amountMinor: input.amountMinor, method: input.method },
    })
    return c.json({ id })
  })

  app.get('/events', async (c) => {
    const rows = await db
      .selectFrom('events')
      .leftJoin('customers', 'customers.id', 'events.customer_id')
      .selectAll('events')
      .select('customers.name as customer_name')
      .orderBy('events.id', 'desc')
      .limit(LIST_LIMIT)
      .execute()

    return c.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        occurredAt: Number(row.occurred_at),
        actor: row.actor,
        action: row.action,
        customerName: row.customer_name,
        licenseId: row.license_id,
        details: row.details,
      })),
    })
  })

  return app
}

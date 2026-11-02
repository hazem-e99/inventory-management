import { sql, type Generated, type Kysely } from 'kysely'

export const LICENSE_STATES = ['issued', 'active', 'suspended', 'revoked'] as const
export type LicenseState = (typeof LICENSE_STATES)[number]

export interface CustomersTable {
  id: string
  name: string
  phone: string | null
  business_type: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

export interface LicensesTable {
  id: string
  customer_id: string
  serial_hash: string
  serial_hint: string
  state: string
  duration_amount: number
  duration_unit: string
  activated_at: number | null
  expires_at: number | null
  fingerprint: string | null
  device_name: string | null
  app_version: string | null
  last_seen_at: number | null
  notes: string | null
  ai_enabled: Generated<boolean>
  /** Successful requests a month. The add-on is sold as this number. */
  ai_monthly_limit: Generated<number>
  /** Raised to cut off a key that got out, without touching anything else. */
  ai_key_version: Generated<number>
  created_at: number
  updated_at: number
}

export interface PaymentsTable {
  id: string
  customer_id: string
  license_id: string | null
  amount_minor: number
  paid_on: string
  method: string
  note: string | null
  recorded_by: string
  created_at: number
}

export interface EventsTable {
  id: Generated<number>
  occurred_at: number
  actor: string
  action: string
  customer_id: string | null
  license_id: string | null
  details: string | null
}

/** Counts and cost only. What a shop sent is never written down here. */
export interface AiUsageTable {
  id: Generated<number>
  license_id: string
  feature: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_micros: number
  succeeded: boolean
  occurred_at: number
}

export interface LicenseDatabase {
  customers: CustomersTable
  licenses: LicensesTable
  payments: PaymentsTable
  events: EventsTable
  ai_usage: AiUsageTable
}

/** Run at every start. Each step checks first, so a restart can never apply one twice. */
export async function migrateLicenseDatabase(db: Kysely<LicenseDatabase>): Promise<void> {
  const anyDb = db as unknown as Kysely<any>

  await anyDb.schema
    .createTable('customers')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('phone', 'text')
    .addColumn('business_type', 'text')
    .addColumn('notes', 'text')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute()

  await anyDb.schema
    .createTable('licenses')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('customer_id', 'text', (col) => col.notNull().references('customers.id').onDelete('restrict'))
    .addColumn('serial_hash', 'text', (col) => col.notNull().unique())
    .addColumn('serial_hint', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull().check(sql`state in ('issued', 'active', 'suspended', 'revoked')`))
    .addColumn('duration_amount', 'integer', (col) => col.notNull().check(sql`duration_amount > 0`))
    .addColumn('duration_unit', 'text', (col) => col.notNull().check(sql`duration_unit in ('day', 'week', 'month', 'year')`))
    .addColumn('activated_at', 'bigint')
    .addColumn('expires_at', 'bigint')
    .addColumn('fingerprint', 'text')
    .addColumn('device_name', 'text')
    .addColumn('app_version', 'text')
    .addColumn('last_seen_at', 'bigint')
    .addColumn('notes', 'text')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute()

  await anyDb.schema.createIndex('licenses_customer_idx').ifNotExists().on('licenses').column('customer_id').execute()
  await anyDb.schema.createIndex('licenses_expiry_idx').ifNotExists().on('licenses').column('expires_at').execute()

  await anyDb.schema
    .createTable('payments')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('customer_id', 'text', (col) => col.notNull().references('customers.id').onDelete('restrict'))
    .addColumn('license_id', 'text', (col) => col.references('licenses.id').onDelete('restrict'))
    .addColumn('amount_minor', 'bigint', (col) => col.notNull().check(sql`amount_minor > 0`))
    .addColumn('paid_on', 'text', (col) => col.notNull())
    .addColumn('method', 'text', (col) => col.notNull().check(sql`method in ('instapay', 'vodafone_cash', 'cash', 'bank')`))
    .addColumn('note', 'text')
    .addColumn('recorded_by', 'text', (col) => col.notNull())
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await anyDb.schema.createIndex('payments_customer_idx').ifNotExists().on('payments').column('customer_id').execute()

  await anyDb.schema
    .createTable('events')
    .ifNotExists()
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .addColumn('actor', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('customer_id', 'text')
    .addColumn('license_id', 'text')
    .addColumn('details', 'text')
    .execute()

  await anyDb.schema.createIndex('events_license_idx').ifNotExists().on('events').column('license_id').execute()

  await sql`alter table licenses add column if not exists ai_enabled boolean not null default false`.execute(db)
  await sql`alter table licenses add column if not exists ai_monthly_limit integer not null default 0 check (ai_monthly_limit >= 0)`.execute(db)
  await sql`alter table licenses add column if not exists ai_key_version integer not null default 1`.execute(db)

  await anyDb.schema
    .createTable('ai_usage')
    .ifNotExists()
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('license_id', 'text', (col) => col.notNull().references('licenses.id').onDelete('restrict'))
    .addColumn('feature', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('input_tokens', 'integer', (col) => col.notNull())
    .addColumn('output_tokens', 'integer', (col) => col.notNull())
    .addColumn('cost_micros', 'bigint', (col) => col.notNull())
    .addColumn('succeeded', 'boolean', (col) => col.notNull())
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .execute()

  await anyDb.schema.createIndex('ai_usage_license_idx').ifNotExists().on('ai_usage').columns(['license_id', 'occurred_at']).execute()
  await anyDb.schema.createIndex('ai_usage_time_idx').ifNotExists().on('ai_usage').column('occurred_at').execute()
}

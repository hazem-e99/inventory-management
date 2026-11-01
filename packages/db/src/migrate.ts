import type { Kysely } from 'kysely'
import { Migrator, type Migration } from 'kysely/migration'
import * as settings from './migrations/0001_settings'
import * as identity from './migrations/0002_identity'
import * as catalog from './migrations/0003_catalog'
import * as stock from './migrations/0004_stock'
import * as purchasing from './migrations/0005_purchasing'
import * as sales from './migrations/0006_sales'
import * as reports from './migrations/0007_reports'
import type { Database } from './schema'

// Listed by hand so the bundled desktop build has no filesystem lookups.
const migrations: Record<string, Migration> = {
  '0001_settings': settings,
  '0002_identity': identity,
  '0003_catalog': catalog,
  '0004_stock': stock,
  '0005_purchasing': purchasing,
  '0006_sales': sales,
  '0007_reports': reports,
}

export const LATEST_MIGRATION = Object.keys(migrations).sort().at(-1)!

const migratorFor = (db: Kysely<Database>) => new Migrator({ db, provider: { getMigrations: async () => migrations } })

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const { error } = await migratorFor(db).migrateToLatest()
  if (error) throw error
}

/** Stops at an older schema, so a test can upgrade a shop that already has history. */
export async function migrateTo(db: Kysely<Database>, name: string): Promise<void> {
  const { error } = await migratorFor(db).migrateTo(name)
  if (error) throw error
}

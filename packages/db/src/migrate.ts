import type { Kysely } from 'kysely'
import { Migrator, type Migration } from 'kysely/migration'
import * as settings from './migrations/0001_settings'
import * as identity from './migrations/0002_identity'
import * as catalog from './migrations/0003_catalog'
import * as stock from './migrations/0004_stock'
import * as purchasing from './migrations/0005_purchasing'
import type { Database } from './schema'

// Listed by hand so the bundled desktop build has no filesystem lookups.
const migrations: Record<string, Migration> = {
  '0001_settings': settings,
  '0002_identity': identity,
  '0003_catalog': catalog,
  '0004_stock': stock,
  '0005_purchasing': purchasing,
}

export const LATEST_MIGRATION = Object.keys(migrations).sort().at(-1)!

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

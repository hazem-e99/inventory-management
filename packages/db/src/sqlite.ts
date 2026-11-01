import { createRequire } from 'node:module'
import { Kysely, sql, SqliteDialect } from 'kysely'
import type BetterSqlite3 from 'better-sqlite3'
import type { Database } from './schema'

const CACHE_KIB = 64_000

const require = createRequire(import.meta.url)

export interface SqliteOptions {
  path: string
  /** 32-byte key as 64 hex characters. */
  hexKey: string
}

const HEX_KEY = /^[0-9a-f]{64}$/

function openEncrypted(options: SqliteOptions): BetterSqlite3.Database {
  // The key is interpolated into a PRAGMA, which cannot take bound parameters.
  if (!HEX_KEY.test(options.hexKey)) {
    throw new Error('Database key must be 64 lowercase hex characters')
  }

  const Driver = require('better-sqlite3-multiple-ciphers') as typeof BetterSqlite3
  const sqlite = new Driver(options.path)

  try {
    sqlite.pragma("cipher='sqlcipher'")
    sqlite.pragma(`hexkey='${options.hexKey}'`)
    // First real read: a wrong key fails here rather than on some later query.
    sqlite.pragma('schema_version')
    return sqlite
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export function createSqliteDb(options: SqliteOptions): Kysely<Database> {
  const sqlite = openEncrypted(options)

  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    // FULL because shops lose power: a posted sale must survive a sudden outage.
    sqlite.pragma('synchronous = FULL')
    sqlite.pragma('busy_timeout = 5000')
    // Every page read from disk is decrypted, so keeping pages in memory matters more than usual.
    sqlite.pragma(`cache_size = -${CACHE_KIB}`)
  } catch (error) {
    sqlite.close()
    throw error
  }

  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) })
}

/** Consistent copy of the live database, still encrypted with the same key. */
export async function snapshotSqliteDb(db: Kysely<Database>, destination: string): Promise<void> {
  await sql`VACUUM INTO ${destination}`.execute(db)
}

export function isSqliteDbHealthy(options: SqliteOptions): boolean {
  const sqlite = openEncrypted(options)
  try {
    return sqlite.pragma('integrity_check', { simple: true }) === 'ok'
  } finally {
    sqlite.close()
  }
}

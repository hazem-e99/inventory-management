import { createRequire } from 'node:module'
import { Kysely, SqliteDialect } from 'kysely'
import type BetterSqlite3 from 'better-sqlite3'
import type { Database } from './schema'

const require = createRequire(import.meta.url)

export interface SqliteOptions {
  path: string
  /** 32-byte key as 64 hex characters. */
  hexKey: string
}

const HEX_KEY = /^[0-9a-f]{64}$/

export function createSqliteDb(options: SqliteOptions): Kysely<Database> {
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
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    // FULL because shops lose power: a posted sale must survive a sudden outage.
    sqlite.pragma('synchronous = FULL')
    sqlite.pragma('busy_timeout = 5000')
  } catch (error) {
    sqlite.close()
    throw error
  }

  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) })
}

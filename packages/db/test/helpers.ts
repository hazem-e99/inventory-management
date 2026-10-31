import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect } from 'kysely'
import { afterAll } from 'vitest'
import { createSqliteDb, type Database } from '../src'

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inv-db-'))
  afterAll(() => {
    // Windows can hold the WAL briefly after close; a leftover temp dir must not fail a test.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return dir
}

export const newHexKey = (): string => randomBytes(32).toString('hex')

/** Every repository test runs on both, so a Postgres incompatibility fails CI immediately. */
export function dialects(dir: string): Array<[string, () => Kysely<Database>]> {
  return [
    ['sqlite', () => createSqliteDb({ path: join(dir, `${newHexKey()}.db`), hexKey: newHexKey() })],
    [
      'pglite',
      () => new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) }),
    ],
  ]
}

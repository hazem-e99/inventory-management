import { randomBytes } from 'node:crypto'
import { mkdtempSync, openSync, readSync, closeSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSqliteDb, migrateToLatest, settingsRepo, type Database } from '../src'

const dir = mkdtempSync(join(tmpdir(), 'inv-db-'))
const hexKey = randomBytes(32).toString('hex')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Every repository test runs on both dialects, so a Postgres incompatibility fails CI.
const dialects: Array<[string, () => Kysely<Database>]> = [
  ['sqlite', () => createSqliteDb({ path: join(dir, 'contract.db'), hexKey })],
  ['pglite', () => new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) })],
]

describe.each(dialects)('settings repository on %s', (_name, create) => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = create()
    await migrateToLatest(db)
  })

  afterAll(() => db.destroy())

  it('returns null for an unknown key', async () => {
    expect(await settingsRepo(db).get('missing')).toBeNull()
  })

  it('stores and overwrites a value', async () => {
    const repo = settingsRepo(db)
    await repo.set('locale', 'ar', 1)
    await repo.set('locale', 'en', 2)
    expect(await repo.get('locale')).toBe('en')
  })

  it('keeps Arabic text intact', async () => {
    const repo = settingsRepo(db)
    await repo.set('store_name', 'صيدلية النور', 3)
    expect(await repo.get('store_name')).toBe('صيدلية النور')
  })
})

describe('sqlite encryption', () => {
  const path = join(dir, 'encrypted.db')

  beforeAll(async () => {
    const db = createSqliteDb({ path, hexKey })
    await migrateToLatest(db)
    await settingsRepo(db).set('secret', 'sensitive-marker', 1)
    await db.destroy()
  })

  it('leaves no plain SQLite header on disk', () => {
    const header = Buffer.alloc(16)
    const fd = openSync(path, 'r')
    readSync(fd, header, 0, 16, 0)
    closeSync(fd)
    expect(header.toString('latin1')).not.toBe('SQLite format 3\0')
  })

  it('reopens with the right key', async () => {
    const db = createSqliteDb({ path, hexKey })
    expect(await settingsRepo(db).get('secret')).toBe('sensitive-marker')
    await db.destroy()
  })

  it('refuses the wrong key', () => {
    const wrongKey = randomBytes(32).toString('hex')
    expect(() => createSqliteDb({ path, hexKey: wrongKey })).toThrow()
  })

  it('rejects a malformed key before it reaches the PRAGMA', () => {
    expect(() => createSqliteDb({ path, hexKey: "x'; DROP TABLE settings;--" })).toThrow(/64 lowercase hex/)
  })
})

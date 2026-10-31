import { openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSqliteDb, migrateToLatest, settingsRepo, type Database } from '../src'
import { dialects, newHexKey, tempDir } from './helpers'

const dir = tempDir()
const hexKey = newHexKey()

describe.each(dialects(dir))('settings repository on %s', (_name, create) => {
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

  it('round-trips JSON values', async () => {
    const repo = settingsRepo(db)
    await repo.setJson('prefs', { locale: 'ar', nested: { digits: 'latin' } }, 4)
    expect(await repo.getJson('prefs')).toEqual({ locale: 'ar', nested: { digits: 'latin' } })
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
    expect(() => createSqliteDb({ path, hexKey: newHexKey() })).toThrow()
  })

  it('rejects a malformed key before it reaches the PRAGMA', () => {
    expect(() => createSqliteDb({ path, hexKey: "x'; DROP TABLE settings;--" })).toThrow(/64 lowercase hex/)
  })
})

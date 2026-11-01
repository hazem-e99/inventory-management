import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyStorageError, migrateTo } from '@inv/db'
import { localDayStart } from '@inv/domain'
import { describe, expect, it } from 'vitest'
import { fileLogger } from '../src/log'
import { upgradeSafely } from '../src/modules/backups'
import { onboarded } from './harness'

describe('upgrading an existing shop', () => {
  it('backs the data up before changing the schema', async () => {
    const { harness } = await onboarded()
    await migrateTo(harness.deps.db, '0006_sales')

    await upgradeSafely(harness.deps)

    const backups = readdirSync(harness.deps.backupsDir).filter((name) => name.endsWith('.invbak'))
    expect(backups).toHaveLength(1)
    expect(statSync(join(harness.deps.backupsDir, backups[0]!)).size).toBeGreaterThan(1000)

    // The column came back with the newest migration, so the shop did get upgraded afterwards.
    await expect(harness.deps.db.selectFrom('sales').select('cost_minor').execute()).resolves.toEqual([])
  })

  it('leaves the shop on its old schema when the backup cannot be taken', async () => {
    const { harness } = await onboarded()
    await migrateTo(harness.deps.db, '0006_sales')
    writeFileSync(join(harness.deps.backupsDir, '..', 'blocked'), '')

    await expect(upgradeSafely({ ...harness.deps, backupsDir: join(harness.deps.backupsDir, '..', 'blocked') })).rejects.toThrow()
    await expect(harness.deps.db.selectFrom('sales').select('cost_minor').execute()).rejects.toThrow()
  })

  it('takes no backup when nothing is changing', async () => {
    const { harness } = await onboarded()
    await upgradeSafely(harness.deps)
    expect(existsSync(harness.deps.backupsDir) ? readdirSync(harness.deps.backupsDir) : []).toEqual([])
  })
})

describe('a full disk', () => {
  it('is told apart from any other failure, on both databases', () => {
    expect(classifyStorageError({ code: 'SQLITE_FULL' })).toBe(true)
    expect(classifyStorageError({ code: 'ENOSPC' })).toBe(true)
    expect(classifyStorageError({ code: '53100' })).toBe(true)
    expect(classifyStorageError({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(false)
    expect(classifyStorageError(new Error('other'))).toBe(false)
  })
})

describe('the log', () => {
  it('writes one line per problem and rolls over when it gets large', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-log-'))
    try {
      const log = fileLogger(dir)
      log('Broke', { traceId: 't1' })
      expect(JSON.parse(readFileSync(join(dir, 'app.log'), 'utf8'))).toMatchObject({ message: 'Broke', traceId: 't1' })

      writeFileSync(join(dir, 'app.log'), 'x'.repeat(6 * 1024 * 1024))
      log('Again', {})
      expect(existsSync(join(dir, 'app.1.log'))).toBe(true)
      expect(readFileSync(join(dir, 'app.log'), 'utf8')).toContain('Again')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never takes the app down when it cannot write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-log-'))
    const log = fileLogger(dir)
    rmSync(dir, { recursive: true, force: true })
    expect(() => log('Gone', {})).not.toThrow()
  })
})

describe('a day', () => {
  it('starts at local midnight, which is what the shop means by a day', () => {
    const start = new Date(localDayStart('2026-06-15'))
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2026, 5, 15, 0, 0])
  })
})

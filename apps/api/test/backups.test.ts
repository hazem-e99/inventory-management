import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Backup } from '@inv/contracts'
import { createSqliteDb, settingsRepo } from '@inv/db'
import { extractBackup, readBackupHeader, unwrapKey } from '@inv/db/backup'
import { describe, expect, it } from 'vitest'
import { createBackup, runAutomaticBackup } from '../src/modules/backups'
import { createHarness, onboarded } from './harness'

interface BackupList {
  items: Backup[]
  directory: string
}

const DAY_MS = 24 * 60 * 60 * 1000

describe('manual backups', () => {
  it('creates a backup that restores with only the file and the recovery code', async () => {
    const { harness, owner } = await onboarded()
    const backup = await harness.json<Backup>('POST', '/backups', { session: owner.token })

    const path = join(harness.deps.backupsDir, backup.fileName)
    const read = await readBackupHeader(path)
    const hexKey = await unwrapKey(read!.header.envelope, owner.recoveryCode.replace(/-/g, ''))
    expect(hexKey).toBe(harness.deps.databaseKey)

    const restored = join(harness.deps.backupsDir, 'restored.db')
    await extractBackup(path, read!.dataOffset, read!.header, restored)
    const db = createSqliteDb({ path: restored, hexKey: hexKey! })
    expect(await settingsRepo(db).get('store')).toContain('صيدلية النور')
    await db.destroy()
  })

  it('leaves no snapshot behind', async () => {
    const { harness, owner } = await onboarded()
    await harness.json('POST', '/backups', { session: owner.token })
    expect(readdirSync(harness.deps.backupsDir).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('lists backups newest first', async () => {
    const { harness, owner } = await onboarded()
    await harness.json('POST', '/backups', { session: owner.token })
    harness.time.now += 60_000
    const latest = await harness.json<Backup>('POST', '/backups', { session: owner.token })

    const list = await harness.json<BackupList>('GET', '/backups', { session: owner.token })
    expect(list.items).toHaveLength(2)
    expect(list.items[0]?.fileName).toBe(latest.fileName)
  })

  it('exports to a chosen path and rejects other extensions', async () => {
    const { harness, owner } = await onboarded()
    const destination = join(harness.deps.backupsDir, '..', 'usb-copy.invbak')
    await harness.json('POST', '/backups/export', { session: owner.token, body: { destination } })
    expect(await readBackupHeader(destination)).not.toBeNull()

    const failure = await harness.failure('POST', '/backups/export', {
      session: owner.token,
      body: { destination: 'C:\\Windows\\system32\\notes.txt' },
    })
    expect(failure.fields).toEqual({ destination: ['BACKUP_PATH_INVALID'] })
  })

  it('reports a failure in the standard format when the destination is unusable', async () => {
    const { harness, owner } = await onboarded()
    const failure = await harness.failure('POST', '/backups/export', {
      session: owner.token,
      body: { destination: join(harness.deps.backupsDir, 'no', 'such', 'folder.invbak') },
    })
    expect(failure.code).toBe('BACKUP_FAILED')
  })
})

describe('automatic backups', () => {
  it('does nothing before onboarding', async () => {
    const harness = await createHarness()
    await runAutomaticBackup(harness.deps)
    await expect(createBackup(harness.deps, { automatic: true })).rejects.toThrow('NOT_ONBOARDED')
  })

  it('runs once a day', async () => {
    const { harness } = await onboarded()
    await runAutomaticBackup(harness.deps)
    await runAutomaticBackup(harness.deps)
    expect(readdirSync(harness.deps.backupsDir)).toHaveLength(1)

    harness.time.now += DAY_MS
    await runAutomaticBackup(harness.deps)
    expect(readdirSync(harness.deps.backupsDir)).toHaveLength(2)
  })

  it('keeps the newest fourteen and never touches manual backups', { timeout: 30_000 }, async () => {
    const { harness, owner } = await onboarded()
    const manual = await harness.json<Backup>('POST', '/backups', {
      session: owner.token,
    })

    for (let day = 0; day < 16; day++) {
      await runAutomaticBackup(harness.deps)
      harness.time.now += DAY_MS
    }

    const files = readdirSync(harness.deps.backupsDir)
    expect(files.filter((name) => name.startsWith('auto-'))).toHaveLength(14)
    expect(files).toContain(manual.fileName)
  })
})

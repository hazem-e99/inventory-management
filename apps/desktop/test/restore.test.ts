import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateRecoveryCode, wrapKey, writeBackup } from '@inv/db/backup'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreBackup, type RestoreRequest } from '../src/main/restore'

const root = mkdtempSync(join(tmpdir(), 'inv-restore-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const NEW_DATA = 'data from the backup'
const OLD_DATA = 'data on this machine'
const OLD_KEY = 'key on this machine'

let run = 0
let dir: string
let databasePath: string
let keyPath: string
let recoveryCode: string
let hexKey: string
let backupPath: string

async function makeBackup(latestMigration = '0002_identity'): Promise<void> {
  const snapshot = join(dir, 'snapshot')
  writeFileSync(snapshot, NEW_DATA)
  backupPath = join(dir, 'file.invbak')
  await writeBackup(snapshot, backupPath, {
    createdAt: 1,
    appVersion: '0.0.1',
    latestMigration,
    automatic: false,
    envelope: await wrapKey(hexKey, recoveryCode),
  })
}

function request(overrides: Partial<RestoreRequest> = {}): RestoreRequest {
  return {
    backupPath,
    recoveryCode,
    databasePath,
    keyPath,
    writeKey: (key) => writeFileSync(keyPath, key),
    latestMigration: '0002_identity',
    stopApi: vi.fn(async () => {}),
    startApi: vi.fn(async () => {}),
    ...overrides,
  }
}

beforeEach(async () => {
  dir = join(root, String(run++))
  mkdirSync(dir)
  databasePath = join(dir, 'inventory.db')
  keyPath = join(dir, 'db.key')
  writeFileSync(databasePath, OLD_DATA)
  writeFileSync(`${databasePath}-wal`, 'old wal')
  writeFileSync(keyPath, OLD_KEY)
  recoveryCode = generateRecoveryCode()
  hexKey = randomBytes(32).toString('hex')
  await makeBackup()
})

const expectUntouched = () => {
  expect(readFileSync(databasePath, 'utf8')).toBe(OLD_DATA)
  expect(readFileSync(keyPath, 'utf8')).toBe(OLD_KEY)
}

describe('restoreBackup', () => {
  it('replaces the database and key, keeping the old ones aside', async () => {
    const input = request()
    expect(await restoreBackup(input)).toEqual({ ok: true })

    expect(readFileSync(databasePath, 'utf8')).toBe(NEW_DATA)
    expect(readFileSync(keyPath, 'utf8')).toBe(hexKey)
    expect(existsSync(`${databasePath}-wal`)).toBe(false)
    expect(input.stopApi).toHaveBeenCalledOnce()
    expect(input.startApi).toHaveBeenCalledOnce()
  })

  it('works on a fresh machine with no database or key yet', async () => {
    rmSync(databasePath)
    rmSync(`${databasePath}-wal`)
    rmSync(keyPath)
    expect(await restoreBackup(request())).toEqual({ ok: true })
    expect(readFileSync(databasePath, 'utf8')).toBe(NEW_DATA)
  })

  it('refuses a wrong code without touching anything or stopping the app', async () => {
    const input = request({ recoveryCode: generateRecoveryCode() })
    expect(await restoreBackup(input)).toEqual({ ok: false, code: 'RECOVERY_CODE_INVALID' })
    expect(input.stopApi).not.toHaveBeenCalled()
    expectUntouched()
  })

  it('refuses a file that is not a backup', async () => {
    const path = join(dir, 'other.invbak')
    writeFileSync(path, 'not a backup')
    expect(await restoreBackup(request({ backupPath: path }))).toEqual({ ok: false, code: 'BACKUP_INVALID' })
    expectUntouched()
  })

  it('refuses a missing file', async () => {
    const result = await restoreBackup(request({ backupPath: join(dir, 'missing.invbak') }))
    expect(result).toEqual({ ok: false, code: 'BACKUP_INVALID' })
  })

  it('refuses a corrupted backup before stopping the app', async () => {
    const bytes = readFileSync(backupPath)
    const last = bytes.length - 1
    bytes.writeUInt8(bytes.readUInt8(last) ^ 0xff, last)
    writeFileSync(backupPath, bytes)

    const input = request()
    expect(await restoreBackup(input)).toEqual({ ok: false, code: 'BACKUP_INVALID' })
    expect(input.stopApi).not.toHaveBeenCalled()
    expectUntouched()
  })

  it('refuses a backup from a newer version', async () => {
    await makeBackup('0099_future')
    expect(await restoreBackup(request())).toEqual({ ok: false, code: 'BACKUP_TOO_NEW' })
    expectUntouched()
  })

  it('puts everything back when the restored database will not open', async () => {
    const startApi = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => {
        // Opening a bad database leaves its own journal files behind.
        writeFileSync(`${databasePath}-wal`, 'failed open')
        throw new Error('file is not a database')
      })
      .mockResolvedValue()

    expect(await restoreBackup(request({ startApi }))).toEqual({ ok: false, code: 'RESTORE_FAILED' })

    expectUntouched()
    expect(readFileSync(`${databasePath}-wal`, 'utf8')).toBe('old wal')
    expect(startApi).toHaveBeenCalledTimes(2)
  })
})

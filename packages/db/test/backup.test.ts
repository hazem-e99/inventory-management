import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createSqliteDb,
  isSqliteDbHealthy,
  migrateToLatest,
  settingsRepo,
  snapshotSqliteDb,
} from '../src'
import {
  extractBackup,
  formatRecoveryCode,
  generateRecoveryCode,
  readBackupHeader,
  unwrapKey,
  wrapKey,
  writeBackup,
} from '../src/backup'
import { newHexKey, tempDir } from './helpers'

const dir = tempDir()
const meta = { createdAt: 1, appVersion: '0.0.1', latestMigration: '0002', automatic: false }

async function createBackup(name: string, marker: string) {
  const hexKey = newHexKey()
  const recoveryCode = generateRecoveryCode()
  const db = createSqliteDb({ path: join(dir, `${name}.db`), hexKey })
  await migrateToLatest(db)
  await settingsRepo(db).set('marker', marker, 1)

  const snapshot = join(dir, `${name}.snapshot`)
  await snapshotSqliteDb(db, snapshot)
  await db.destroy()

  const destination = join(dir, `${name}.invbak`)
  const envelope = await wrapKey(hexKey, recoveryCode)
  await writeBackup(snapshot, destination, { ...meta, envelope })
  return { hexKey, recoveryCode, destination }
}

describe('recovery codes', () => {
  it('generates 24 unambiguous characters', () => {
    for (let run = 0; run < 50; run++) {
      expect(generateRecoveryCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/)
    }
  })

  it('groups the code for reading aloud', () => {
    expect(formatRecoveryCode('ABCD1234EFGH5678JKMN9012')).toBe('ABCD-1234-EFGH-5678-JKMN-9012')
  })

  it('unwraps the key with the right code and refuses a wrong one', async () => {
    const hexKey = newHexKey()
    const code = generateRecoveryCode()
    const envelope = await wrapKey(hexKey, code)
    expect(await unwrapKey(envelope, code)).toBe(hexKey)
    expect(await unwrapKey(envelope, generateRecoveryCode())).toBeNull()
  })
})

describe('backup files', () => {
  it('restores a working database using only the file and the recovery code', async () => {
    const { recoveryCode, destination } = await createBackup('full', 'صيدلية النور')

    const read = await readBackupHeader(destination)
    const hexKey = await unwrapKey(read!.header.envelope, recoveryCode)
    const restored = join(dir, 'restored.db')
    expect(await extractBackup(destination, read!.dataOffset, read!.header, restored)).toBe(true)

    expect(isSqliteDbHealthy({ path: restored, hexKey: hexKey! })).toBe(true)
    const db = createSqliteDb({ path: restored, hexKey: hexKey! })
    expect(await settingsRepo(db).get('marker')).toBe('صيدلية النور')
    await db.destroy()
  })

  it('contains no readable customer data', async () => {
    const { destination } = await createBackup('opaque', 'very-visible-marker')
    expect(readFileSync(destination).includes('very-visible-marker')).toBe(false)
  })

  it('rejects a file that is not a backup', async () => {
    const path = join(dir, 'random.invbak')
    writeFileSync(path, 'this is not a backup file at all')
    expect(await readBackupHeader(path)).toBeNull()
  })

  it('rejects a truncated header', async () => {
    const { destination } = await createBackup('short', 'x')
    const path = join(dir, 'truncated.invbak')
    writeFileSync(path, readFileSync(destination).subarray(0, 20))
    expect(await readBackupHeader(path)).toBeNull()
  })

  it('detects corrupted snapshot bytes', async () => {
    const { destination } = await createBackup('tampered', 'x')
    const bytes = readFileSync(destination)
    const lastByte = bytes.length - 1
    bytes.writeUInt8(bytes.readUInt8(lastByte) ^ 0xff, lastByte)
    const path = join(dir, 'corrupted.invbak')
    writeFileSync(path, bytes)

    const read = await readBackupHeader(path)
    const output = join(dir, 'corrupted.db')
    expect(await extractBackup(path, read!.dataOffset, read!.header, output)).toBe(false)
  })
})

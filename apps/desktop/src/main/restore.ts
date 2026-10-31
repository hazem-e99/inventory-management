import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ErrorCode } from '@inv/contracts'
import { extractBackup, readBackupHeader, unwrapKey } from '@inv/db/backup'

export type RestoreResult = { ok: true } | { ok: false; code: ErrorCode }

export interface RestoreRequest {
  backupPath: string
  recoveryCode: string
  databasePath: string
  keyPath: string
  writeKey: (hexKey: string) => void
  /** Sorted migration name this build knows, to refuse data from a newer version. */
  latestMigration: string
  stopApi: () => Promise<void>
  startApi: () => Promise<void>
}

const DATABASE_SUFFIXES = ['', '-wal', '-shm']

async function removeDatabase(path: string): Promise<void> {
  for (const suffix of DATABASE_SUFFIXES) await rm(`${path}${suffix}`, { force: true })
}

async function moveDatabase(from: string, to: string): Promise<void> {
  for (const suffix of DATABASE_SUFFIXES) {
    if (existsSync(`${from}${suffix}`)) await rename(`${from}${suffix}`, `${to}${suffix}`)
  }
}

export async function restoreBackup(request: RestoreRequest): Promise<RestoreResult> {
  const { backupPath, recoveryCode, databasePath, keyPath, writeKey } = request

  const read = await readBackupHeader(backupPath).catch(() => null)
  if (!read) return { ok: false, code: 'BACKUP_INVALID' }
  if (read.header.latestMigration > request.latestMigration) {
    return { ok: false, code: 'BACKUP_TOO_NEW' }
  }

  const hexKey = await unwrapKey(read.header.envelope, recoveryCode)
  if (!hexKey) return { ok: false, code: 'RECOVERY_CODE_INVALID' }

  // Everything that can fail cheaply happens before the running database is touched.
  const incoming = `${databasePath}.incoming`
  const intact = await extractBackup(backupPath, read.dataOffset, read.header, incoming)
  if (!intact) return { ok: false, code: 'BACKUP_INVALID' }

  const safetyDir = join(databasePath, '..', 'pre-restore', String(Date.now()))
  const safetyCopy = join(safetyDir, 'inventory.db')
  const safetyKey = join(safetyDir, 'db.key')

  await request.stopApi()
  await mkdir(safetyDir, { recursive: true })
  await moveDatabase(databasePath, safetyCopy)
  const hadKey = existsSync(keyPath)
  if (hadKey) await rename(keyPath, safetyKey)

  try {
    await rename(incoming, databasePath)
    writeKey(hexKey)
    await request.startApi()
    return { ok: true }
  } catch {
    // The backup could not be opened, so the customer's previous data goes straight back.
    await removeDatabase(databasePath)
    await rm(incoming, { force: true })
    await moveDatabase(safetyCopy, databasePath)
    await rm(keyPath, { force: true })
    if (hadKey) await rename(safetyKey, keyPath)
    await request.startApi().catch(() => {})
    return { ok: false, code: 'RESTORE_FAILED' }
  }
}

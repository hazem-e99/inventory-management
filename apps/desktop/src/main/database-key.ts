import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

/**
 * Returns the database key, creating it on first run. A database with no key file is
 * refused: a fresh key could never open it, and the customer's data must not be replaced.
 */
export function loadDatabaseKey(keyPath: string, databasePath: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is unavailable')
  }

  if (existsSync(keyPath)) {
    return safeStorage.decryptString(readFileSync(keyPath))
  }

  if (existsSync(databasePath)) {
    throw new Error('Database key is missing. Restore from a backup to continue')
  }

  const hexKey = randomBytes(32).toString('hex')
  writeFileSync(keyPath, safeStorage.encryptString(hexKey), { mode: 0o600 })
  return hexKey
}

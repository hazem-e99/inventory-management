import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

export class DatabaseKeyUnavailable extends Error {}

export function storeDatabaseKey(keyPath: string, hexKey: string): void {
  writeFileSync(keyPath, safeStorage.encryptString(hexKey), { mode: 0o600 })
}

/**
 * Returns the database key, creating it on first run. A database with no readable key is
 * refused rather than replaced: a fresh key could never open it, and the customer's data
 * must survive so that it can be restored.
 */
export function loadDatabaseKey(keyPath: string, databasePath: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is unavailable')
  }

  if (existsSync(keyPath)) {
    try {
      return safeStorage.decryptString(readFileSync(keyPath))
    } catch {
      // Happens after a Windows profile reset: the key file exists but can no longer open.
      throw new DatabaseKeyUnavailable('Database key cannot be decrypted')
    }
  }

  if (existsSync(databasePath)) throw new DatabaseKeyUnavailable('Database key is missing')

  const hexKey = randomBytes(32).toString('hex')
  storeDatabaseKey(keyPath, hexKey)
  return hexKey
}

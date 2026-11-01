import type { Actor } from '@inv/contracts'
import type { Database, Kysely } from '@inv/db'

export interface LicenseConfig {
  /** Built into the app. Whatever it can verify is a license; nothing else is. */
  publicKey: string
  serverUrl: string
  fingerprint: string
  fetch?: typeof fetch
}

export interface AppDeps {
  db: Kysely<Database>
  token: string
  allowedOrigin: string
  version: string
  bootCount: number
  /** Wrapped with the recovery code at onboarding, so backups can restore anywhere. */
  databaseKey: string
  backupsDir: string
  clock: () => number
  /** Left out only in tests. A real start always passes it, so it can't be switched off. */
  license?: LicenseConfig
  logError: (message: string, details: Record<string, unknown>) => void
}

export interface AppEnv {
  Variables: {
    traceId: string
    actor: Actor
    sessionHash: string
  }
}

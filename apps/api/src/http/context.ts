import type { Actor } from '@inv/contracts'
import type { Database, Kysely } from '@inv/db'

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
  logError: (message: string, details: Record<string, unknown>) => void
}

export interface AppEnv {
  Variables: {
    traceId: string
    actor: Actor
    sessionHash: string
  }
}

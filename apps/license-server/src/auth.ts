import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { twoFactor } from 'better-auth/plugins'
import type { Kysely } from 'kysely'
import type { LicenseDatabase } from './schema'

const SESSION_SECONDS = 8 * 60 * 60

export interface AuthOptions {
  db: Kysely<LicenseDatabase>
  secret: string
  publicUrl: string
  /** Only the create-admin command turns this on. There is no public sign-up. */
  allowSignUp?: boolean
  limitRequests?: boolean
}

export function authOptions({ db, secret, publicUrl, allowSignUp = false, limitRequests = true }: AuthOptions) {
  return {
    appName: 'Inventory licenses',
    secret,
    baseURL: publicUrl,
    basePath: '/api/auth',
    trustedOrigins: [publicUrl],
    database: { db, type: 'postgres' as const },
    emailAndPassword: { enabled: true, disableSignUp: !allowSignUp, minPasswordLength: 12 },
    session: { expiresIn: SESSION_SECONDS, updateAge: 0 },
    rateLimit: { enabled: limitRequests, window: 60, max: 30 },
    advanced: { useSecureCookies: publicUrl.startsWith('https://') },
    plugins: [twoFactor({ issuer: 'Inventory licenses' })],
  }
}

export const createAuth = (options: AuthOptions) => betterAuth(authOptions(options))

export type Auth = ReturnType<typeof createAuth>

export async function migrateAuthTables(options: AuthOptions): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(options))
  await runMigrations()
}

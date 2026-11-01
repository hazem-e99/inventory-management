import { PGlite } from '@electric-sql/pglite'
import { generateLicenseKeys } from '@inv/license-core'
import { Kysely, PGliteDialect } from 'kysely'
import * as OTPAuth from 'otpauth'
import { createServerApp, type ServerDeps } from '../src/app'
import { createAuth, migrateAuthTables } from '../src/auth'
import { migrateLicenseDatabase, type LicenseDatabase } from '../src/schema'

export const PUBLIC_URL = 'http://licenses.test'
export const ADMIN = { name: 'Hazem', email: 'admin@example.com', password: 'a-long-admin-password' }
const SECRET = 'test-secret-that-is-long-enough-for-better-auth'

export interface Harness {
  deps: ServerDeps
  publicKey: string
  time: { now: number }
  fetch(path: string, init?: RequestInit): Promise<Response>
  admin(method: string, path: string, body?: unknown): Promise<Response>
  /** Signs in again as the enrolled admin, the way a browser would. */
  signIn(): Promise<string>
  totp(): string
}

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ')
}

export async function createHarness(options: { enrol?: boolean } = {}): Promise<Harness> {
  const db = new Kysely<LicenseDatabase>({ dialect: new PGliteDialect({ pglite: new PGlite() }) })
  await migrateLicenseDatabase(db)
  const authSettings = { db, secret: SECRET, publicUrl: PUBLIC_URL, limitRequests: false }
  await migrateAuthTables(authSettings)

  const keys = generateLicenseKeys()
  const time = { now: Date.UTC(2026, 5, 15) }
  const deps: ServerDeps = {
    db,
    auth: createAuth(authSettings),
    privateKey: keys.privateKey,
    serialKey: 'serial-key',
    publicUrl: PUBLIC_URL,
    clock: () => time.now,
    trustProxy: true,
    logError: (message, details) => console.error(message, details),
  }
  const app = createServerApp(deps)
  const call = (path: string, init?: RequestInit) => Promise.resolve(app.request(`${PUBLIC_URL}${path}`, init))

  const owner = createAuth({ ...authSettings, allowSignUp: true })
  await owner.api.signUpEmail({ body: ADMIN })

  let secret = ''
  let cookie = ''

  const json = (method: string, body: unknown, extra: Record<string, string> = {}) => ({
    method,
    headers: { 'content-type': 'application/json', origin: PUBLIC_URL, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const totp = () => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate()

  const signIn = async (): Promise<string> => {
    const first = await call('/api/auth/sign-in/email', json('POST', { email: ADMIN.email, password: ADMIN.password }))
    const partial = cookiesFrom(first)
    const verified = await call('/api/auth/two-factor/verify-totp', json('POST', { code: totp() }, { cookie: partial }))
    if (!verified.ok) throw new Error(`TOTP failed: ${verified.status} ${await verified.text()}`)
    cookie = cookiesFrom(verified)
    return cookie
  }

  if (options.enrol !== false) {
    const first = await call('/api/auth/sign-in/email', json('POST', { email: ADMIN.email, password: ADMIN.password }))
    const session = cookiesFrom(first)
    const enabled = await call('/api/auth/two-factor/enable', json('POST', { password: ADMIN.password }, { cookie: session }))
    if (!enabled.ok) throw new Error(`enable failed: ${enabled.status} ${await enabled.text()}`)
    const { totpURI } = (await enabled.json()) as { totpURI: string }
    secret = new URL(totpURI).searchParams.get('secret')!

    const verified = await call('/api/auth/two-factor/verify-totp', json('POST', { code: totp() }, { cookie: session }))
    if (!verified.ok) throw new Error(`enrol failed: ${verified.status} ${await verified.text()}`)
    await signIn()
  }

  return {
    deps,
    publicKey: keys.publicKey,
    time,
    fetch: call,
    totp,
    signIn,
    admin: (method, path, body) => call(path, json(method, body, { cookie })),
  }
}

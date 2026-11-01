import { createInterface } from 'node:readline/promises'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { createAuth, migrateAuthTables } from './auth'
import { loadConfig } from './config'
import { migrateLicenseDatabase, type LicenseDatabase } from './schema'

// The only way an account is made. Sign-up is closed on the running server.
const config = loadConfig(process.env)
const db = new Kysely<LicenseDatabase>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: config.DATABASE_URL }) }),
})

// Read line by line, so this also works with the answers piped in.
const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
async function ask(question: string): Promise<string> {
  process.stdout.write(question)
  const { value } = await lines.next()
  return String(value ?? '').trim()
}

const email = await ask('Email: ')
const name = await ask('Name: ')
const password = await ask('Password (12 characters or more): ')

await migrateLicenseDatabase(db)
const settings = { db, secret: config.BETTER_AUTH_SECRET, publicUrl: config.PUBLIC_URL, allowSignUp: true }
await migrateAuthTables(settings)
await createAuth(settings).api.signUpEmail({ body: { email, name, password } })

console.log('Admin created. Set up the authenticator app on first sign-in.')
await db.destroy()

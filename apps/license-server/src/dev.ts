import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { PGlite } from '@electric-sql/pglite'
import { generateLicenseKeys } from '@inv/license-core'
import { Kysely, PGliteDialect } from 'kysely'
import { geminiProvider } from './ai/gemini'
import { createServerApp } from './app'
import { createAuth, migrateAuthTables } from './auth'
import { servePanel } from './panel'
import { migrateLicenseDatabase, type LicenseDatabase } from './schema'

// A throwaway server for development and end-to-end tests: in-memory, one known admin.
const port = Number(process.env.PORT ?? 8787)
const publicUrl = `http://127.0.0.1:${port}`
const privateKey = process.env.LICENSE_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? generateLicenseKeys().privateKey

const db = new Kysely<LicenseDatabase>({ dialect: new PGliteDialect({ pglite: new PGlite() }) })
const settings = { db, secret: randomBytes(32).toString('hex'), publicUrl, limitRequests: false }

await migrateLicenseDatabase(db)
await migrateAuthTables(settings)
await createAuth({ ...settings, allowSignUp: true }).api.signUpEmail({
  body: { email: 'admin@example.com', name: 'Developer', password: 'development-password' },
})

const app = createServerApp({
  db,
  auth: createAuth(settings),
  privateKey,
  serialKey: randomBytes(32).toString('hex'),
  publicUrl,
  ...(process.env.UPDATES_DIR ? { updatesDir: process.env.UPDATES_DIR } : {}),
  ...(process.env.GEMINI_API_KEY
    ? { ai: { provider: geminiProvider(process.env.GEMINI_API_KEY, process.env.AI_INVOICE_MODEL ?? 'gemini-3.1-flash-lite'), dailyBudgetMicros: 1_000_000 } }
    : {}),
  clock: () => Date.now(),
  trustProxy: false,
  logError: (message, details) => console.error(message, details),
})

const panel = resolve(import.meta.dirname, '../../license-admin/dist')
if (existsSync(panel)) servePanel(app, panel)

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`READY ${publicUrl}`))

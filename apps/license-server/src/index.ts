import { serve } from '@hono/node-server'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { createServerApp } from './app'
import { createAuth, migrateAuthTables } from './auth'
import { loadConfig } from './config'
import { servePanel } from './panel'
import { migrateLicenseDatabase, type LicenseDatabase } from './schema'

const config = loadConfig(process.env)

const db = new Kysely<LicenseDatabase>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: config.DATABASE_URL }) }),
})

const authSettings = { db, secret: config.BETTER_AUTH_SECRET, publicUrl: config.PUBLIC_URL }
await migrateLicenseDatabase(db)
await migrateAuthTables(authSettings)

const app = createServerApp({
  db,
  auth: createAuth(authSettings),
  privateKey: config.LICENSE_PRIVATE_KEY,
  serialKey: config.SERIAL_HMAC_KEY,
  publicUrl: config.PUBLIC_URL,
  updatesDir: config.UPDATES_DIR,
  clock: () => Date.now(),
  trustProxy: config.TRUST_PROXY === 'true',
  logError: (message, details) => console.error(message, details),
})
servePanel(app, config.ADMIN_DIST)

serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => console.log(`License server listening on ${port}`))

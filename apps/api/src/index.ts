import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { createSqliteDb, migrateToLatest, settingsRepo, type SqliteOptions } from '@inv/db'
import { createApp } from './app'

export interface StartOptions {
  database: SqliteOptions
  token: string
  allowedOrigin: string
  version: string
}

export interface RunningApi {
  port: number
  stop(): Promise<void>
}

export async function startApi(options: StartOptions): Promise<RunningApi> {
  const db = createSqliteDb(options.database)
  await migrateToLatest(db)

  const settings = settingsRepo(db)
  const bootCount = Number((await settings.get('boot_count')) ?? 0) + 1
  await settings.set('boot_count', String(bootCount), Date.now())

  const app = createApp({
    token: options.token,
    allowedOrigin: options.allowedOrigin,
    version: options.version,
    bootCount,
  })

  return new Promise((resolve) => {
    // Port 0 lets the OS pick; the loopback bind keeps the API off the shop network.
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info: AddressInfo) => {
      resolve({
        port: info.port,
        stop: async () => {
          await new Promise<void>((done) => server.close(() => done()))
          await db.destroy()
        },
      })
    })
  })
}

export { createApp } from './app'

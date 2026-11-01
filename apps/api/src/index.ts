import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { createSqliteDb, sessionsRepo, settingsRepo, type SqliteOptions } from '@inv/db'
import { createApp } from './app'
import { fileLogger } from './log'
import type { AppDeps, LicenseConfig } from './http/context'
import { runAutomaticBackup, upgradeSafely } from './modules/backups'
import { licenseHeartbeat } from './modules/license'

export type { LicenseConfig }

export interface StartOptions {
  database: SqliteOptions
  backupsDir: string
  logsDir: string
  token: string
  allowedOrigin: string
  version: string
  license: LicenseConfig
}

export interface RunningApi {
  port: number
  stop(): Promise<void>
}

const AUTOMATIC_BACKUP_CHECK_MS = 60 * 60 * 1000
const LICENSE_CHECK_IN_MS = 60 * 60 * 1000

export async function startApi(options: StartOptions): Promise<RunningApi> {
  const db = createSqliteDb(options.database)
  const clock = () => Date.now()

  const deps: AppDeps = {
    db,
    token: options.token,
    allowedOrigin: options.allowedOrigin,
    version: options.version,
    bootCount: 0,
    databaseKey: options.database.hexKey,
    backupsDir: options.backupsDir,
    clock,
    license: options.license,
    logError: fileLogger(options.logsDir),
  }
  await upgradeSafely(deps)

  const settings = settingsRepo(db)
  deps.bootCount = Number((await settings.get('boot_count')) ?? 0) + 1
  await settings.set('boot_count', String(deps.bootCount), clock())
  await sessionsRepo(db).deleteExpired(clock())

  const app = createApp(deps)

  const backUp = () => {
    runAutomaticBackup(deps).catch((error: unknown) => {
      deps.logError('Automatic backup failed', { message: String(error) })
    })
  }
  backUp()
  const backupTimer = setInterval(backUp, AUTOMATIC_BACKUP_CHECK_MS)
  backupTimer.unref()

  void licenseHeartbeat(deps)
  const licenseTimer = setInterval(() => void licenseHeartbeat(deps), LICENSE_CHECK_IN_MS)
  licenseTimer.unref()

  return new Promise((resolve) => {
    // Port 0 lets the OS pick; the loopback bind keeps the API off the shop network.
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info: AddressInfo) => {
      resolve({
        port: info.port,
        stop: async () => {
          clearInterval(backupTimer)
          clearInterval(licenseTimer)
          await new Promise<void>((done) => server.close(() => done()))
          await db.destroy()
        },
      })
    })
  })
}

export { createApp } from './app'
export type { AppDeps } from './http/context'

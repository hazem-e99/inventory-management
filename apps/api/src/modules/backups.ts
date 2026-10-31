import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRoute } from '@hono/zod-openapi'
import { backupSchema, backupsListSchema, exportBackupSchema, type Backup } from '@inv/contracts'
import { auditRepo, isSqliteDbHealthy, LATEST_MIGRATION, newId, snapshotSqliteDb } from '@inv/db'
import { readBackupHeader, writeBackup } from '@inv/db/backup'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { storeSettings } from './store'

const EXTENSION = '.invbak'
const AUTOMATIC_PREFIX = 'auto-'
const AUTOMATIC_RETENTION = 14
const AUTOMATIC_INTERVAL_MS = 24 * 60 * 60 * 1000

function backupFileName(now: number, automatic: boolean): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `${automatic ? AUTOMATIC_PREFIX : ''}inventory-${stamp}${EXTENSION}`
}

export async function listBackups(deps: AppDeps): Promise<Backup[]> {
  await mkdir(deps.backupsDir, { recursive: true })
  const files = (await readdir(deps.backupsDir)).filter((name) => name.endsWith(EXTENSION))

  const backups: Backup[] = []
  for (const fileName of files) {
    const read = await readBackupHeader(join(deps.backupsDir, fileName))
    if (!read) continue
    backups.push({
      fileName,
      sizeBytes: read.header.sizeBytes,
      createdAt: read.header.createdAt,
      automatic: read.header.automatic,
    })
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createBackup(
  deps: AppDeps,
  options: { automatic: boolean; destination?: string },
): Promise<Backup> {
  const envelope = await storeSettings(deps.db).recovery()
  if (!envelope) throw new AppError('NOT_ONBOARDED')

  await mkdir(deps.backupsDir, { recursive: true })
  const now = deps.clock()
  const snapshot = join(deps.backupsDir, `.snapshot-${newId()}`)
  const fileName = backupFileName(now, options.automatic)
  const destination = options.destination ?? join(deps.backupsDir, fileName)

  try {
    await snapshotSqliteDb(deps.db, snapshot)
    // A backup is only worth keeping if it is proven readable when it is made.
    if (!isSqliteDbHealthy({ path: snapshot, hexKey: deps.databaseKey })) {
      throw new AppError('BACKUP_FAILED')
    }
    const header = await writeBackup(snapshot, destination, {
      createdAt: now,
      appVersion: deps.version,
      latestMigration: LATEST_MIGRATION,
      automatic: options.automatic,
      envelope,
    })
    return { fileName, sizeBytes: header.sizeBytes, createdAt: now, automatic: options.automatic }
  } catch (error) {
    if (error instanceof AppError) throw error
    deps.logError('Backup failed', { message: error instanceof Error ? error.message : String(error) })
    throw new AppError('BACKUP_FAILED')
  } finally {
    await rm(snapshot, { force: true })
  }
}

export async function runAutomaticBackup(deps: AppDeps): Promise<void> {
  if (!(await storeSettings(deps.db).recovery())) return

  const automatic = (await listBackups(deps)).filter((backup) => backup.automatic)
  const newest = automatic[0]
  if (newest && deps.clock() - newest.createdAt < AUTOMATIC_INTERVAL_MS) return

  await createBackup(deps, { automatic: true })

  for (const old of automatic.slice(AUTOMATIC_RETENTION - 1)) {
    await rm(join(deps.backupsDir, old.fileName), { force: true })
  }
}

export function backupRoutes(deps: AppDeps) {
  const guard = [
    requireAuth(deps),
    requirePasswordCurrent,
    requirePermission('backups.manage'),
  ]

  const listRoute = createRoute({
    method: 'get',
    path: '/backups',
    middleware: guard,
    responses: { 200: jsonOk(backupsListSchema) },
  })

  const createBackupRoute = createRoute({
    method: 'post',
    path: '/backups',
    middleware: guard,
    responses: { 200: jsonOk(backupSchema) },
  })

  const exportRoute = createRoute({
    method: 'post',
    path: '/backups/export',
    middleware: guard,
    request: { body: jsonBody(exportBackupSchema) },
    responses: { 200: jsonOk(backupSchema) },
  })

  async function audited(actorId: string, options: { destination?: string }) {
    const backup = await createBackup(deps, { automatic: false, ...options })
    await auditRepo(deps.db).record({
      actorId,
      action: options.destination ? 'backup.exported' : 'backup.created',
      details: { fileName: backup.fileName },
      occurredAt: deps.clock(),
    })
    return backup
  }

  return router()
    .openapi(listRoute, async (c) =>
      c.json({ items: await listBackups(deps), directory: deps.backupsDir }, 200),
    )
    .openapi(createBackupRoute, async (c) => c.json(await audited(c.get('actor').id, {}), 200))
    .openapi(exportRoute, async (c) => {
      const { destination } = c.req.valid('json')
      return c.json(await audited(c.get('actor').id, { destination }), 200)
    })
}

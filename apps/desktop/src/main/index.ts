import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from 'electron'
import type { StartOptions } from '@inv/api'
import { LATEST_MIGRATION } from '@inv/db'
import type { ApiProcessEvent, ApiProcessRequest } from './api-process'
import { DatabaseKeyUnavailable, loadDatabaseKey, storeDatabaseKey } from './database-key'
import { restoreBackup } from './restore'

const RENDERER_ORIGIN = 'app://renderer'
const API_START_TIMEOUT_MS = 15_000
const API_STOP_TIMEOUT_MS = 2_000
const BACKUP_FILTER = { name: 'Inventory backup', extensions: ['invbak'] }
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  'connect-src http://127.0.0.1:*',
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const allowedOrigin = devServerUrl ? new URL(devServerUrl).origin : RENDERER_ORIGIN

type Startup = { kind: 'ready'; baseUrl: string; token: string } | { kind: 'restore-required' }

let apiProcess: UtilityProcess | undefined
let startup: Startup = { kind: 'restore-required' }
let quitting = false
let restarting = false

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const paths = () => {
  const userData = app.getPath('userData')
  return {
    database: join(userData, 'inventory.db'),
    key: join(userData, 'db.key'),
    backups: join(userData, 'backups'),
  }
}

function forkApi(options: StartOptions): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const child = utilityProcess.fork(join(__dirname, 'api-process.js'), [], {
      serviceName: 'inventory-api',
    })
    apiProcess = child

    const timeout = setTimeout(() => reject(new Error('API did not start in time')), API_START_TIMEOUT_MS)

    let startFailed = false

    child.on('message', (event: ApiProcessEvent) => {
      clearTimeout(timeout)
      if (event.type === 'ready') {
        resolvePort(event.port)
        return
      }
      // A failed process must not stay alive holding the database file open.
      startFailed = true
      child.kill()
      reject(new Error(event.message))
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (apiProcess === child) apiProcess = undefined
      reject(new Error(`API exited with code ${code}`))
      if (quitting || restarting || startFailed) return
      dialog.showErrorBox('Inventory', `The data service stopped unexpectedly (code ${code}).`)
      app.quit()
    })

    child.postMessage({ type: 'start', options } satisfies ApiProcessRequest)
  })
}

function stopApi(): Promise<void> {
  const child = apiProcess
  if (!child) return Promise.resolve()

  return new Promise((done) => {
    const timeout = setTimeout(() => {
      child.kill()
      done()
    }, API_STOP_TIMEOUT_MS)

    child.once('exit', () => {
      clearTimeout(timeout)
      done()
    })
    child.postMessage({ type: 'stop' } satisfies ApiProcessRequest)
  })
}

async function startApi(): Promise<void> {
  const { database, key, backups } = paths()
  const hexKey = loadDatabaseKey(key, database)
  const token = randomBytes(32).toString('hex')

  const port = await forkApi({
    database: { path: database, hexKey },
    backupsDir: backups,
    token,
    allowedOrigin,
    version: app.getVersion(),
  })
  startup = { kind: 'ready', baseUrl: `http://127.0.0.1:${port}`, token }
}

function isAppFrame(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  return url.startsWith(devServerUrl ?? RENDERER_ORIGIN)
}

function handle<T extends unknown[], R>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: T) => R,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppFrame(event)) throw new Error('Refused IPC from an unknown frame')
    return listener(event, ...(args as T))
  })
}

function registerIpc(): void {
  handle('startup', () => startup)

  handle('backup:choose-file', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [BACKUP_FILTER],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('backup:choose-destination', async (event, defaultName: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showSaveDialog(window, {
      defaultPath: defaultName,
      filters: [BACKUP_FILTER],
    })
    return result.canceled ? null : (result.filePath ?? null)
  })

  handle('catalog:choose-file', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'csv'] }],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('catalog:choose-destination', async (event, defaultName: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showSaveDialog(window, {
      defaultPath: defaultName,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })
    return result.canceled ? null : (result.filePath ?? null)
  })

  handle('print:printers', async (event) => {
    const printers = await event.sender.getPrintersAsync()
    return printers.map(({ name }) => name)
  })

  // A chosen printer prints silently, so a cashier never meets a dialog with a customer waiting.
  handle(
    'print:run',
    (event, job: { deviceName: string | null; widthMm: number | null; heightMm: number | null }) =>
      new Promise<{ ok: boolean }>((resolve) => {
        event.sender.print(
          {
            silent: job.deviceName !== null,
            printBackground: true,
            margins: { marginType: 'none' },
            ...(job.deviceName ? { deviceName: job.deviceName } : {}),
            ...(job.widthMm && job.heightMm
              ? { pageSize: { width: Math.round(job.widthMm * 1000), height: Math.round(job.heightMm * 1000) } }
              : {}),
          },
          (success) => resolve({ ok: success }),
        )
      }),
  )

  handle('print:pdf', async (event, job: { defaultName: string; landscape: boolean }) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { saved: false }
    const target = await dialog.showSaveDialog(window, {
      defaultPath: job.defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (target.canceled || !target.filePath) return { saved: false }

    const pdf = await event.sender.printToPDF({ pageSize: 'A4', landscape: job.landscape, printBackground: true })
    await writeFile(target.filePath, pdf)
    return { saved: true }
  })

  handle(
    'backup:restore',
    async (event, input: { path: string; recoveryCode: string }) => {
      const { database, key } = paths()
      restarting = true
      try {
        const result = await restoreBackup({
          backupPath: input.path,
          recoveryCode: input.recoveryCode,
          databasePath: database,
          keyPath: key,
          writeKey: (hexKey) => storeDatabaseKey(key, hexKey),
          latestMigration: LATEST_MIGRATION,
          stopApi,
          startApi,
        })
        if (result.ok) event.sender.reload()
        return result
      } finally {
        restarting = false
      }
    },
  )
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
}

function registerRendererProtocol(): void {
  const root = join(__dirname, '../renderer')

  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url)
    const target = pathname === '/' ? join(root, 'index.html') : resolve(root, `.${decodeURIComponent(pathname)}`)
    const inside = relative(root, target)
    if (inside.startsWith('..') || isAbsolute(inside)) return new Response(null, { status: 403 })

    const response = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    const contentType = CONTENT_TYPES[extname(target)]
    if (contentType) headers.set('Content-Type', contentType)
    return new Response(response.body, { status: response.status, headers })
  })
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl ?? RENDERER_ORIGIN
    if (!url.startsWith(allowed)) event.preventDefault()
  })

  await window.loadURL(devServerUrl ?? `${RENDERER_ORIGIN}/`)
}

async function bootstrap(): Promise<void> {
  registerIpc()
  registerRendererProtocol()

  try {
    await startApi()
  } catch (error) {
    // Unreadable key: open the window on the restore screen instead of failing closed.
    if (!(error instanceof DatabaseKeyUnavailable)) throw error
  }

  await createWindow()
}

if (!app.requestSingleInstanceLock()) {
  // Two instances would mean two writers on one customer database.
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })

  app.on('window-all-closed', () => app.quit())

  app.on('before-quit', (event) => {
    if (quitting || !apiProcess) return
    event.preventDefault()
    quitting = true
    void stopApi().finally(() => app.quit())
  })

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Inventory', message)
    app.quit()
  })
}

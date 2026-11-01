import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from 'electron'
import type { StartOptions } from '@inv/api'
import { LATEST_MIGRATION } from '@inv/db'
import type { ApiProcessEvent, ApiProcessRequest } from './api-process'
import { DatabaseKeyUnavailable, loadDatabaseKey, storeDatabaseKey } from './database-key'
import { fileLogger } from '@inv/api/log'
import { licenseConfig, updateConfig } from './license-config'
import { restoreBackup } from './restore'
import { startUpdates, type Updater } from './updates'

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
let updater: Updater | undefined

process.on('uncaughtException', (error) => {
  fileLogger(paths().logs)('App crashed', { message: error.message, stack: error.stack })
  dialog.showErrorBox('Inventory', error.message)
  app.exit(1)
})

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const paths = () => {
  const userData = app.getPath('userData')
  return {
    database: join(userData, 'inventory.db'),
    key: join(userData, 'db.key'),
    backups: join(userData, 'backups'),
    logs: join(userData, 'logs'),
    updates: join(userData, 'updates'),
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
  const { database, key, backups, logs } = paths()
  const hexKey = loadDatabaseKey(key, database)
  const token = randomBytes(32).toString('hex')

  const port = await forkApi({
    database: { path: database, hexKey },
    backupsDir: backups,
    logsDir: logs,
    token,
    allowedOrigin,
    version: app.getVersion(),
    license: await licenseConfig(app.isPackaged),
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

  handle('logs:open', async () => {
    await shell.openPath(paths().logs)
  })

  handle('update:ready', () => updater?.readyVersion() ?? null)

  handle('update:install', () => {
    if (updater?.install(true)) app.quit()
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
      devTools: !app.isPackaged,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl ?? RENDERER_ORIGIN
    if (!url.startsWith(allowed)) event.preventDefault()
  })

  await window.loadURL(devServerUrl ?? `${RENDERER_ORIGIN}/`)
}

/** A customer's copy opens for its window and nothing else. */
function lockDown(): void {
  // The app asks the browser for nothing but putting a code on the clipboard.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, allow) => allow(permission === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write')
  if (!app.isPackaged) return

  // No menu means no reload, zoom or developer tools by shortcut, in the middle of a sale or not.
  Menu.setApplicationMenu(null)
}

function debuggingRequested(): boolean {
  return ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'].some((name) => app.commandLine.hasSwitch(name))
}

function checkForUpdates(): void {
  const config = updateConfig(app.isPackaged)
  if (!config) return

  updater = startUpdates({
    ...config,
    currentVersion: app.getVersion(),
    folder: paths().updates,
    log: fileLogger(paths().logs),
    onReady: (version) => BrowserWindow.getAllWindows()[0]?.webContents.send('update:ready', version),
  })
}

async function bootstrap(): Promise<void> {
  if (app.isPackaged && debuggingRequested() && !import.meta.env.MAIN_VITE_ALLOW_DEBUGGING) {
    app.quit()
    return
  }

  lockDown()
  registerIpc()
  registerRendererProtocol()

  try {
    await startApi()
  } catch (error) {
    // Unreadable key: open the window on the restore screen instead of failing closed.
    if (!(error instanceof DatabaseKeyUnavailable)) throw error
  }

  await createWindow()
  checkForUpdates()
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
    // Closing up at night is the natural moment: the next morning opens on the new version.
    updater?.install(false)
    void stopApi().finally(() => app.quit())
  })

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Inventory', message)
    app.quit()
  })
}

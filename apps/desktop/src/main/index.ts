import { randomBytes } from 'node:crypto'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  utilityProcess,
  type UtilityProcess,
} from 'electron'
import type { StartOptions } from '@inv/api'
import type { ApiProcessEvent, ApiProcessRequest } from './api-process'
import { loadDatabaseKey } from './database-key'

const RENDERER_ORIGIN = 'app://renderer'
const API_START_TIMEOUT_MS = 15_000
const API_STOP_TIMEOUT_MS = 2_000
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

let apiProcess: UtilityProcess | undefined
let apiConfig: { baseUrl: string; token: string } | undefined
let quitting = false

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function startApiProcess(options: StartOptions): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const child = utilityProcess.fork(join(__dirname, 'api-process.js'), [], {
      serviceName: 'inventory-api',
    })
    apiProcess = child

    const timeout = setTimeout(() => reject(new Error('API did not start in time')), API_START_TIMEOUT_MS)

    child.on('message', (event: ApiProcessEvent) => {
      clearTimeout(timeout)
      if (event.type === 'ready') resolvePort(event.port)
      else reject(new Error(event.message))
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      apiProcess = undefined
      if (quitting) return
      reject(new Error(`API exited with code ${code}`))
      dialog.showErrorBox('Inventory', `The data service stopped unexpectedly (code ${code}).`)
      app.quit()
    })

    child.postMessage({ type: 'start', options } satisfies ApiProcessRequest)
  })
}

function stopApiProcess(): Promise<void> {
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

function registerRendererProtocol(): void {
  const root = join(__dirname, '../renderer')

  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url)
    const file = resolve(root, `.${decodeURIComponent(pathname)}`)
    const inside = relative(root, file)
    if (inside.startsWith('..') || isAbsolute(inside)) return new Response(null, { status: 403 })

    const target = pathname === '/' ? join(root, 'index.html') : file
    const response = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
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
  const userData = app.getPath('userData')
  const databasePath = join(userData, 'inventory.db')
  const hexKey = loadDatabaseKey(join(userData, 'db.key'), databasePath)
  const token = randomBytes(32).toString('hex')

  const port = await startApiProcess({
    database: { path: databasePath, hexKey },
    token,
    allowedOrigin: devServerUrl ? new URL(devServerUrl).origin : RENDERER_ORIGIN,
    version: app.getVersion(),
  })
  apiConfig = { baseUrl: `http://127.0.0.1:${port}`, token }

  ipcMain.handle('api:config', () => apiConfig)
  registerRendererProtocol()
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
    void stopApiProcess().finally(() => app.quit())
  })

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Inventory', message)
    app.quit()
  })
}

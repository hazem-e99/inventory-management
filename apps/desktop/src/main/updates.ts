import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isNewerVersion, verifyUpdateManifest, type UpdateManifest } from '@inv/license-core'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

export interface UpdateOptions {
  serverUrl: string
  publicKey: string
  currentVersion: string
  folder: string
  log: (message: string, details: Record<string, unknown>) => void
  onReady: (version: string) => void
}

export interface Updater {
  readyVersion(): string | null
  /** Starts the silent installer, which waits for this app to close. */
  install(relaunch: boolean): boolean
  stop(): void
}

async function hashOf(path: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function isValid(path: string, manifest: UpdateManifest): Promise<boolean> {
  if (!existsSync(path)) return false
  return (await stat(path)).size === manifest.size && (await hashOf(path)) === manifest.sha512
}

async function download(url: string, target: string, manifest: UpdateManifest): Promise<void> {
  const partial = `${target}.partial`
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`)

  // Counted while it arrives, so a wrong file stops here rather than filling the disk.
  let received = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length
      done(received > manifest.size ? new Error('Download is larger than announced') : null, chunk)
    },
  })

  try {
    await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(partial))
    if (!(await isValid(partial, manifest))) throw new Error('Download does not match the signed manifest')
    await rename(partial, target)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }
}

/**
 * Nothing is run unless it matches a manifest signed with the offline key. Installation waits
 * for the shop: it happens on closing the app, or when someone chooses it, never during a sale.
 */
export function startUpdates(options: UpdateOptions): Updater {
  let ready: { manifest: UpdateManifest; path: string } | null = null
  let checking = false

  async function check(): Promise<void> {
    if (checking || ready) return
    checking = true
    try {
      const response = await fetch(`${options.serverUrl}/updates/manifest.json`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!response.ok) return

      const manifest = verifyUpdateManifest(await response.text(), options.publicKey)
      if (!manifest) {
        options.log('Update manifest refused', {})
        return
      }
      if (!isNewerVersion(manifest.version, options.currentVersion)) {
        // Up to date, so the installer that brought this version has done its job.
        await rm(options.folder, { recursive: true, force: true })
        return
      }

      await mkdir(options.folder, { recursive: true })
      const path = join(options.folder, manifest.file)
      if (!(await isValid(path, manifest))) {
        await download(`${options.serverUrl}/updates/${manifest.file}`, path, manifest)
      }
      ready = { manifest, path }
      options.onReady(manifest.version)
    } catch (error) {
      // No internet is the normal case in a shop, so a failed check stays quiet.
      options.log('Update check failed', { message: String(error) })
    } finally {
      checking = false
    }
  }

  void check()
  const timer = setInterval(() => void check(), CHECK_EVERY_MS)
  timer.unref()

  return {
    readyVersion: () => ready?.manifest.version ?? null,
    install(relaunch) {
      if (!ready) return false
      const child = spawn(ready.path, ['/S', ...(relaunch ? ['--force-run'] : [])], { detached: true, stdio: 'ignore' })
      child.unref()
      ready = null
      return true
    },
    stop: () => clearInterval(timer),
  }
}

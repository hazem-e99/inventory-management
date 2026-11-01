import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateLicenseKeys, signUpdateManifest, type UpdateManifest } from '@inv/license-core'
import { afterEach, describe, expect, it } from 'vitest'
import { startUpdates } from '../src/main/updates'

const keys = generateLicenseKeys()
const INSTALLER = Buffer.from('a real installer')
const FILE = 'Inventory-Setup-1.1.0.exe'

const manifestFor = (overrides: Partial<UpdateManifest> = {}): UpdateManifest => ({
  version: '1.1.0',
  file: FILE,
  sha512: createHash('sha512').update(INSTALLER).digest('hex'),
  size: INSTALLER.length,
  publishedAt: 1,
  ...overrides,
})

const servers: Server[] = []
const folders: string[] = []

afterEach(() => {
  servers.splice(0).forEach((server) => server.close())
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }))
})

async function publish(manifest: string, file: Buffer = INSTALLER): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === '/updates/manifest.json') response.end(manifest)
    else if (request.url === `/updates/${FILE}`) response.end(file)
    else response.writeHead(404).end()
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Runs one check and says how it ended, without waiting on the six-hour timer. */
async function check(serverUrl: string, currentVersion = '1.0.0', folder = mkdtempSync(join(tmpdir(), 'inv-updates-'))) {
  folders.push(folder)
  const problems: string[] = []
  const outcome = await new Promise<string>((done) => {
    const updater = startUpdates({
      serverUrl,
      publicKey: keys.publicKey,
      currentVersion,
      folder,
      log: (message, details) => {
        problems.push(`${message} ${String(details['message'] ?? '')}`)
        done('refused')
      },
      onReady: (version) => done(version),
    })
    updater.stop()
    setTimeout(() => done('nothing'), 500)
  })
  return { outcome, problems, folder }
}

describe('checking for an update', () => {
  it('fetches a signed release and keeps it ready', async () => {
    const { outcome, folder } = await check(await publish(signUpdateManifest(manifestFor(), keys.privateKey)))
    expect(outcome).toBe('1.1.0')
    expect(readFileSync(join(folder, FILE))).toEqual(INSTALLER)
  })

  it('refuses a file that was swapped behind a real signature, and keeps nothing of it', async () => {
    const swapped = Buffer.from('a fake installer')
    expect(swapped.length).toBe(INSTALLER.length)

    const { outcome, problems, folder } = await check(await publish(signUpdateManifest(manifestFor(), keys.privateKey), swapped))
    expect(outcome).toBe('refused')
    expect(problems[0]).toContain('does not match')
    expect(readdirSync(folder)).toEqual([])
  })

  it('stops a download that runs past its announced size', async () => {
    const { outcome, problems, folder } = await check(await publish(signUpdateManifest(manifestFor(), keys.privateKey), Buffer.alloc(100_000, 1)))
    expect(outcome).toBe('refused')
    expect(problems[0]).toContain('larger than announced')
    expect(readdirSync(folder)).toEqual([])
  })

  it('refuses a release signed by anyone else, before downloading it', async () => {
    const { outcome, problems, folder } = await check(await publish(signUpdateManifest(manifestFor(), generateLicenseKeys().privateKey)))
    expect(outcome).toBe('refused')
    expect(problems[0]).toContain('manifest refused')
    expect(readdirSync(folder)).toEqual([])
  })

  it('ignores an older release, and clears the installer that is no longer needed', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'inv-updates-'))
    writeFileSync(join(folder, 'Inventory-Setup-1.0.0.exe'), 'used')

    const { outcome } = await check(await publish(signUpdateManifest(manifestFor(), keys.privateKey)), '1.2.0', folder)
    expect(outcome).toBe('nothing')
    expect(existsSync(folder)).toBe(false)
  })

  it('stays quiet about the shop having no internet beyond a line in the log', async () => {
    const { outcome } = await check('http://127.0.0.1:9')
    expect(outcome).toBe('refused')
  })
})

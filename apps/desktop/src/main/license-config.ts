import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { promisify } from 'node:util'
import type { LicenseConfig } from '@inv/api'

// Development only. Its private half sits in the e2e folder, so a release must never use it:
// `pnpm dist` refuses to build without the real key, and a packaged app refuses it below.
const DEVELOPMENT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3TjdpQQoUPrRZu4PAeOHXPTnBxRt5qkW/7CvfbM4EEw=
-----END PUBLIC KEY-----`

const RELEASE_PUBLIC_KEY = import.meta.env.MAIN_VITE_LICENSE_PUBLIC_KEY?.replace(/\\n/g, '\n')
const RELEASE_SERVER_URL = import.meta.env.MAIN_VITE_LICENSE_SERVER_URL

const DEVELOPMENT_SERVER_URL = 'http://127.0.0.1:8787'

const run = promisify(execFile)

async function machineId(): Promise<string> {
  try {
    const { stdout } = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true })
    return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(stdout)?.[1] ?? hostname()
  } catch {
    return hostname()
  }
}

/** The same on every run of this install of Windows, and meaningless anywhere else. */
async function deviceFingerprint(): Promise<string> {
  return createHash('sha256').update(`inventory-license:${await machineId()}`).digest('hex').slice(0, 32)
}

export async function licenseConfig(packaged: boolean): Promise<LicenseConfig> {
  const fingerprint = await deviceFingerprint()
  if (!packaged) {
    return {
      publicKey: RELEASE_PUBLIC_KEY ?? DEVELOPMENT_PUBLIC_KEY,
      serverUrl: process.env['INV_LICENSE_SERVER'] ?? RELEASE_SERVER_URL ?? DEVELOPMENT_SERVER_URL,
      fingerprint,
    }
  }

  if (!RELEASE_PUBLIC_KEY || !RELEASE_SERVER_URL) throw new Error('This build has no license key.')
  return { publicKey: RELEASE_PUBLIC_KEY, serverUrl: RELEASE_SERVER_URL, fingerprint }
}

import { describe, expect, it } from 'vitest'
import { generateLicenseKeys, isNewerVersion, signUpdateManifest, verifyUpdateManifest, type UpdateManifest } from '../src'

const keys = generateLicenseKeys()
const manifest: UpdateManifest = { version: '1.2.0', file: 'Inventory-Setup-1.2.0.exe', sha512: 'a'.repeat(128), size: 1000, publishedAt: 1 }

describe('update manifests', () => {
  it('round trip', () => {
    expect(verifyUpdateManifest(signUpdateManifest(manifest, keys.privateKey), keys.publicKey)).toEqual(manifest)
  })

  it('reject another key, so a broken-into server cannot publish', () => {
    expect(verifyUpdateManifest(signUpdateManifest(manifest, generateLicenseKeys().privateKey), keys.publicKey)).toBeNull()
  })

  it('reject a changed file behind a real signature', () => {
    const signed = JSON.parse(signUpdateManifest(manifest, keys.privateKey)) as { manifest: string; signature: string }
    signed.manifest = signed.manifest.replace('a'.repeat(128), 'b'.repeat(128))
    expect(verifyUpdateManifest(JSON.stringify(signed), keys.publicKey)).toBeNull()
  })

  it('reject a file name that climbs out of the updates folder', () => {
    const escaped = { ...manifest, file: '../../evil.exe' }
    expect(verifyUpdateManifest(signUpdateManifest(escaped, keys.privateKey), keys.publicKey)).toBeNull()
  })

  it('reject whatever else comes back', () => {
    expect(verifyUpdateManifest('<html>404</html>', keys.publicKey)).toBeNull()
    expect(verifyUpdateManifest('{}', keys.publicKey)).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('compares numbers, not text', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true)
  })

  it('never goes backwards or sideways', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false)
  })
})

import { sign, verify } from 'node:crypto'
import { z } from 'zod'

export const updateManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  file: z.string().regex(/^[\w.-]+$/),
  sha512: z.string().regex(/^[0-9a-f]{128}$/),
  size: z.number().int().positive(),
  publishedAt: z.number(),
})

export type UpdateManifest = z.infer<typeof updateManifestSchema>

const signedManifestSchema = z.object({ manifest: z.string(), signature: z.string() })

/**
 * Signed offline, with a key that never sits on the server. Whoever breaks into the server can
 * replace the file, but can't make an installed app run it.
 */
export function signUpdateManifest(manifest: UpdateManifest, privateKey: string): string {
  const body = JSON.stringify(manifest)
  return JSON.stringify({ manifest: body, signature: sign(null, Buffer.from(body), privateKey).toString('base64url') })
}

export function verifyUpdateManifest(text: string, publicKey: string): UpdateManifest | null {
  try {
    const signed = signedManifestSchema.parse(JSON.parse(text))
    if (!verify(null, Buffer.from(signed.manifest), publicKey, Buffer.from(signed.signature, 'base64url'))) return null
    const parsed = updateManifestSchema.safeParse(JSON.parse(signed.manifest))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Compares a.b.c numerically, because 1.10.0 comes after 1.9.0 and text says otherwise. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (version: string) => version.split('.').map(Number)
  const [a, b] = [parts(candidate), parts(current)]
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { z } from 'zod'

export const licensePayloadSchema = z.object({
  v: z.literal(1),
  licenseId: z.string(),
  customer: z.string(),
  fingerprint: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
  // Suspended or revoked on the server. Only reaches a device when it next checks in.
  suspended: z.boolean(),
})

export type LicensePayload = z.infer<typeof licensePayloadSchema>

const encode = (data: Buffer | string) => Buffer.from(data).toString('base64url')

export function generateLicenseKeys(): { publicKey: string; privateKey: string } {
  return generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

export function signLicenseToken(payload: LicensePayload, privateKey: string): string {
  const body = encode(JSON.stringify(payload))
  return `${body}.${encode(sign(null, Buffer.from(body), privateKey))}`
}

/** Null for anything not signed by the matching key, whatever the reason. */
export function verifyLicenseToken(token: string, publicKey: string): LicensePayload | null {
  const [body, signature, extra] = token.trim().split('.')
  if (!body || !signature || extra !== undefined) return null

  try {
    if (!verify(null, Buffer.from(body), publicKey, Buffer.from(signature, 'base64url'))) return null
    const parsed = licensePayloadSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

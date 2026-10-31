import { hash, verify } from '@node-rs/argon2'

// OWASP's minimum Argon2id profile: it stays quick on the low-end PCs shops run.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

export const hashSecret = (secret: string): Promise<string> => hash(secret, OPTIONS)

export const verifySecret = (stored: string, secret: string): Promise<boolean> =>
  verify(stored, secret)

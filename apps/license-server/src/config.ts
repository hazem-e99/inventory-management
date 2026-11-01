import { z } from 'zod'

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Ed25519 PEM. The matching public key is built into the desktop app.
  LICENSE_PRIVATE_KEY: z.string().includes('PRIVATE KEY'),
  SERIAL_HMAC_KEY: z.string().min(32),
  BETTER_AUTH_SECRET: z.string().min(32),
  PUBLIC_URL: z.url(),
  PORT: z.coerce.number().int().default(3000),
  ADMIN_DIST: z.string().default('./admin'),
  // Set behind Caddy, so rate limits see the real client and not the proxy.
  TRUST_PROXY: z.enum(['true', 'false']).default('true'),
})

export type Config = z.infer<typeof configSchema>

/** A server missing a key must refuse to start, never run with a default secret. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = configSchema.safeParse({
    ...env,
    // Environment files keep a PEM on one line.
    LICENSE_PRIVATE_KEY: env.LICENSE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  })
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map(({ path }) => path.join('.')).join(', ')}`)
  }
  if (!parsed.data.PUBLIC_URL.startsWith('https://') && env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_URL must be https in production')
  }
  return parsed.data
}

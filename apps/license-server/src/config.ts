import { z } from 'zod'
import { PRICED_MODELS } from './ai/pricing'

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Ed25519 PEM. The matching public key is built into the desktop app.
  LICENSE_PRIVATE_KEY: z.string().includes('PRIVATE KEY'),
  SERIAL_HMAC_KEY: z.string().min(32),
  BETTER_AUTH_SECRET: z.string().min(32),
  PUBLIC_URL: z.url(),
  PORT: z.coerce.number().int().default(3000),
  ADMIN_DIST: z.string().default('./admin'),
  UPDATES_DIR: z.string().default('./updates'),
  // Off until set on purpose. Needs a key from a billed Google Cloud project: the free tier may
  // show what it is sent to human reviewers, so a shop's documents must never go there.
  AI_ENABLED: z.enum(['true', 'false']).default('false'),
  GEMINI_API_KEY: z.string().optional(),
  AI_INVOICE_MODEL: z.string().default('gemini-3.1-flash-lite'),
  AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(10),
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
  if (parsed.data.AI_ENABLED === 'true' && !parsed.data.GEMINI_API_KEY) throw new Error('Invalid configuration: GEMINI_API_KEY')
  if (!PRICED_MODELS.includes(parsed.data.AI_INVOICE_MODEL)) throw new Error('Invalid configuration: AI_INVOICE_MODEL has no price')
  if (!parsed.data.PUBLIC_URL.startsWith('https://') && env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_URL must be https in production')
  }
  return parsed.data
}

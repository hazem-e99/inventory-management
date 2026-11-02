import { z } from 'zod'

export const aiStatusSchema = z.object({
  /** The add-on is switched on for this license, from the developer's panel. */
  available: z.boolean(),
  /** When the owner agreed to documents leaving this device, or null. */
  consentedAt: z.number().nullable(),
  used: z.number(),
  monthlyLimit: z.number(),
})

export type AiStatus = z.infer<typeof aiStatusSchema>

export const aiConsentSchema = z.object({ accepted: z.boolean() })

export type AiConsent = z.infer<typeof aiConsentSchema>

import { z } from 'zod'

export const licenseInfoSchema = z.object({
  /** False only in tests and builds with licensing left out. */
  enforced: z.boolean(),
  status: z.enum(['active', 'grace', 'read_only', 'unlicensed']),
  reason: z.enum(['expired', 'suspended', 'other_device']).nullable(),
  expiresAt: z.number().nullable(),
  graceEndsAt: z.number().nullable(),
  daysLeft: z.number().nullable(),
  customer: z.string().nullable(),
  /** Read out to the developer when a shop has no internet. */
  deviceId: z.string(),
})

export type LicenseInfo = z.infer<typeof licenseInfoSchema>

export const activateLicenseSchema = z.object({ serial: z.string().trim().min(1, 'REQUIRED').max(64, 'TEXT_TOO_LONG') })

export const offlineLicenseSchema = z.object({ code: z.string().trim().min(1, 'REQUIRED').max(4000, 'TEXT_TOO_LONG') })

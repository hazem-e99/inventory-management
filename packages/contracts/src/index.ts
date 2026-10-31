import { z } from 'zod'

export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  bootCount: z.number().int().positive(),
})

export type Health = z.infer<typeof healthSchema>

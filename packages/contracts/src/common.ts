import { z } from 'zod'

export const idSchema = z.string().min(1, 'REQUIRED')

export const requiredText = (max: number) =>
  z.string({ error: 'REQUIRED' }).trim().min(1, 'REQUIRED').max(max, 'TEXT_TOO_LONG')

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'TEXT_TOO_LONG')
    .transform((value) => value || null)
    .nullable()
    .optional()

export const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

export const okSchema = z.object({ ok: z.literal(true) })

import { z } from 'zod'

export * from './auth'
export * from './backups'
export * from './catalog'
export * from './catalog-import'
export * from './common'
export * from './errors'
export * from './permissions'
export * from './settings'
export * from './stock'
export * from './users'

export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  bootCount: z.number().int().positive(),
})

export type Health = z.infer<typeof healthSchema>

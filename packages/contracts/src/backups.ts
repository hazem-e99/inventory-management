import { z } from 'zod'

export const backupSchema = z.object({
  fileName: z.string(),
  sizeBytes: z.number(),
  createdAt: z.number(),
  automatic: z.boolean(),
})

export type Backup = z.infer<typeof backupSchema>

export const backupsListSchema = z.object({
  items: z.array(backupSchema),
  directory: z.string(),
})

export const exportBackupSchema = z.object({
  destination: z
    .string({ error: 'REQUIRED' })
    .regex(/\.invbak$/i, 'BACKUP_PATH_INVALID'),
})

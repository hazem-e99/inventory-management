import { z } from 'zod'
import { fullNameSchema, passwordSchema, pinSchema, usernameSchema } from './auth'
import { idSchema, pageOf } from './common'
import { PERMISSIONS } from './permissions'

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  roleId: z.string(),
  isActive: z.boolean(),
  hasPin: z.boolean(),
  createdAt: z.number(),
})

export type User = z.infer<typeof userSchema>

export const createUserSchema = z.object({
  fullName: fullNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  roleId: idSchema,
  pin: pinSchema.optional(),
})

export type CreateUserInput = z.input<typeof createUserSchema>

export const updateUserSchema = z.object({
  fullName: fullNameSchema.optional(),
  roleId: idSchema.optional(),
  isActive: z.boolean().optional(),
})

export type UpdateUserInput = z.input<typeof updateUserSchema>

export const resetPasswordSchema = z.object({ password: passwordSchema })

export const usersListSchema = z.object({ items: z.array(userSchema) })

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(z.enum(PERMISSIONS)),
  userCount: z.number(),
})

export type Role = z.infer<typeof roleSchema>

export const rolesListSchema = z.object({ items: z.array(roleSchema) })

export const roleInputSchema = z.object({
  name: fullNameSchema,
  permissions: z.array(z.enum(PERMISSIONS)),
})

export type RoleInput = z.input<typeof roleInputSchema>

export const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  actorName: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: z.number(),
})

export type AuditEntry = z.infer<typeof auditEntrySchema>

export const auditPageSchema = pageOf(auditEntrySchema)

export type AuditPage = z.infer<typeof auditPageSchema>

import { z } from 'zod'
import { PERMISSIONS } from './permissions'
import { LOCALES, preferencesSchema, storeProfileSchema, storeSchema } from './settings'

export const usernameSchema = z
  .string({ error: 'REQUIRED' })
  .trim()
  .min(1, 'REQUIRED')
  .transform((value) => value.normalize('NFC').toLowerCase())
  .pipe(z.string().regex(/^[\p{L}\p{N}._-]{3,32}$/u, 'USERNAME_INVALID'))

export const passwordSchema = z
  .string({ error: 'REQUIRED' })
  .min(1, 'REQUIRED')
  .min(8, 'PASSWORD_TOO_SHORT')
  .max(128, 'PASSWORD_TOO_LONG')

export const pinSchema = z.string({ error: 'REQUIRED' }).regex(/^\d{4,6}$/, 'PIN_INVALID')

export const fullNameSchema = z
  .string({ error: 'REQUIRED' })
  .trim()
  .min(2, 'NAME_TOO_SHORT')
  .max(120, 'TEXT_TOO_LONG')

export const recoveryCodeSchema = z
  .string({ error: 'REQUIRED' })
  .trim()
  .min(1, 'REQUIRED')
  // Crockford spelling: the alphabet has no O, I or L, so those are misread 0 and 1.
  .transform((value) =>
    value.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1'),
  )
  .pipe(z.string().regex(/^[0-9A-Z]{24}$/, 'RECOVERY_CODE_INVALID'))

export const onboardingSchema = z.object({
  locale: z.enum(LOCALES),
  store: storeProfileSchema,
  owner: z.object({
    fullName: fullNameSchema,
    username: usernameSchema,
    password: passwordSchema,
  }),
})

export type OnboardingInput = z.input<typeof onboardingSchema>

export const loginSchema = z.object({
  username: z.string({ error: 'REQUIRED' }).trim().min(1, 'REQUIRED'),
  password: z.string({ error: 'REQUIRED' }).min(1, 'REQUIRED'),
})

export const pinLoginSchema = z.object({
  username: z.string({ error: 'REQUIRED' }).trim().min(1, 'REQUIRED'),
  pin: pinSchema,
})

export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'REQUIRED' }).min(1, 'REQUIRED'),
  newPassword: passwordSchema,
})

export const setPinSchema = z.object({
  currentPassword: z.string({ error: 'REQUIRED' }).min(1, 'REQUIRED'),
  pin: pinSchema,
})

export const recoverAccountSchema = z.object({
  username: z.string({ error: 'REQUIRED' }).trim().min(1, 'REQUIRED'),
  recoveryCode: recoveryCodeSchema,
  newPassword: passwordSchema,
})

export const actorSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  roleId: z.string(),
  permissions: z.array(z.enum(PERMISSIONS)),
  mustChangePassword: z.boolean(),
  hasPin: z.boolean(),
})

export type Actor = z.infer<typeof actorSchema>

export const sessionSchema = z.object({ token: z.string(), actor: actorSchema })

export type Session = z.infer<typeof sessionSchema>

export const onboardingResultSchema = sessionSchema.extend({ recoveryCode: z.string() })

export type OnboardingResult = z.infer<typeof onboardingResultSchema>

export const bootstrapSchema = z.object({
  onboarded: z.boolean(),
  store: storeSchema.nullable(),
  preferences: preferencesSchema,
  version: z.string(),
})

export type Bootstrap = z.infer<typeof bootstrapSchema>

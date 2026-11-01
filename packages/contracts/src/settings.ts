import { z } from 'zod'
import { optionalText } from './common'

export const LOCALES = ['ar', 'en'] as const
export const THEMES = ['system', 'light', 'dark'] as const
export const DIGIT_STYLES = ['latin', 'arabic'] as const
export const BUSINESS_TYPES = ['pharmacy', 'supermarket', 'clothing', 'general'] as const

export type Locale = (typeof LOCALES)[number]
export type Theme = (typeof THEMES)[number]
export type DigitStyle = (typeof DIGIT_STYLES)[number]
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const storeProfileSchema = z.object({
  name: z.string({ error: 'REQUIRED' }).trim().min(2, 'NAME_TOO_SHORT').max(120, 'TEXT_TOO_LONG'),
  businessType: z.enum(BUSINESS_TYPES, { error: 'REQUIRED' }),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?[0-9][0-9\s()-]{5,19})?$/, 'PHONE_INVALID')
    .transform((value) => value || null)
    .nullable()
    .optional(),
  address: optionalText(240),
  // Egyptian tax registration numbers are nine digits.
  taxNumber: z
    .string()
    .trim()
    .regex(/^(\d{9})?$/, 'TAX_NUMBER_INVALID')
    .transform((value) => value || null)
    .nullable()
    .optional(),
})

export type StoreProfileInput = z.input<typeof storeProfileSchema>

// The business type decides how stock is recorded, so it is fixed once data exists.
export const updateStoreSchema = storeProfileSchema.omit({ businessType: true })

export type UpdateStoreInput = z.input<typeof updateStoreSchema>

export const storeSchema = z.object({
  name: z.string(),
  businessType: z.enum(BUSINESS_TYPES),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  taxNumber: z.string().nullable(),
  currency: z.string(),
})

export type Store = z.infer<typeof storeSchema>

export const preferencesSchema = z.object({
  locale: z.enum(LOCALES),
  theme: z.enum(THEMES),
  digits: z.enum(DIGIT_STYLES),
})

export type Preferences = z.infer<typeof preferencesSchema>

export const featuresSchema = z.object({
  lots: z.boolean(),
  expiryRequired: z.boolean(),
  fractionalQuantities: z.boolean(),
  variantsMatrix: z.boolean(),
  serialNumbers: z.boolean(),
})

export type Features = z.infer<typeof featuresSchema>

export const settingsSchema = z.object({
  store: storeSchema,
  preferences: preferencesSchema,
  features: featuresSchema,
  stockPolicy: z.object({ allowNegative: z.boolean() }),
  pos: z.object({
    warehouseId: z.string(),
    receiptPaper: z.enum(['80mm', '58mm', 'a4']),
    printerName: z.string().nullable(),
    autoPrint: z.boolean(),
  }),
})

export type Settings = z.infer<typeof settingsSchema>

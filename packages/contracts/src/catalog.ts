import { z } from 'zod'
import { idSchema, optionalText, pageOf, pageQuerySchema, requiredText } from './common'

export const MAX_AMOUNT_MINOR = 1_000_000_000_000

export const moneyMinorSchema = z.number({ error: 'PRICE_INVALID' }).int('PRICE_INVALID').min(0, 'PRICE_INVALID').max(MAX_AMOUNT_MINOR, 'PRICE_INVALID')

const nameSchema = requiredText(120)
const optionalId = idSchema.nullable().optional()

/** Names of the built-in units, also accepted when importing a spreadsheet. */
export const SYSTEM_UNITS = {
  piece: { ar: 'قطعة', en: 'Piece' },
  box: { ar: 'علبة', en: 'Box' },
  strip: { ar: 'شريط', en: 'Strip' },
  carton: { ar: 'كرتونة', en: 'Carton' },
  bottle: { ar: 'زجاجة', en: 'Bottle' },
  kilogram: { ar: 'كيلوجرام', en: 'Kilogram' },
  gram: { ar: 'جرام', en: 'Gram' },
  liter: { ar: 'لتر', en: 'Liter' },
  meter: { ar: 'متر', en: 'Meter' },
} as const

export const REFERENCE_KINDS = ['categories', 'brands', 'units', 'tax-rates', 'price-lists'] as const
export type ReferenceKind = (typeof REFERENCE_KINDS)[number]

export const referenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  archived: z.boolean(),
  usageCount: z.number(),
  parentId: z.string().nullable().optional(),
  allowsFraction: z.boolean().optional(),
  rateBp: z.number().optional(),
})

export type Reference = z.infer<typeof referenceSchema>

export const referenceListSchema = z.object({ items: z.array(referenceSchema) })

export const referenceInputSchema = z.object({
  name: nameSchema,
  parentId: optionalId,
  allowsFraction: z.boolean().optional(),
  // Basis points: 14% is 1400, so a rate never becomes a float.
  rateBp: z.number().int('INVALID_VALUE').min(0, 'INVALID_VALUE').max(10_000, 'INVALID_VALUE').optional(),
  archived: z.boolean().optional(),
})

export type ReferenceInput = z.input<typeof referenceInputSchema>

export const attributeValueSchema = z.object({ id: z.string(), attributeId: z.string(), value: z.string() })

export const attributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  values: z.array(attributeValueSchema),
})

export type Attribute = z.infer<typeof attributeSchema>

export const attributesListSchema = z.object({ items: z.array(attributeSchema) })

export const attributeValueInputSchema = z.object({ value: requiredText(60) })

const barcodeCodeSchema = z.string({ error: 'REQUIRED' }).trim().min(1, 'REQUIRED').max(32, 'BARCODE_INVALID')

export const barcodeInputSchema = z.object({ code: barcodeCodeSchema, unitId: idSchema })

export const priceInputSchema = z.object({
  priceListId: idSchema,
  unitId: idSchema,
  amountMinor: moneyMinorSchema,
})

export const variantInputSchema = z.object({
  id: idSchema.optional(),
  label: optionalText(120),
  sku: z.string().trim().max(40, 'TEXT_TOO_LONG').optional(),
  costMinor: moneyMinorSchema,
  barcodes: z.array(barcodeInputSchema),
  prices: z.array(priceInputSchema),
  attributeValueIds: z.array(idSchema),
})

export const conversionInputSchema = z.object({
  unitId: idSchema,
  // Thousandths of the base unit, so a box of 10 strips is 10000.
  factorMilli: z.number({ error: 'FACTOR_INVALID' }).int('FACTOR_INVALID').min(1, 'FACTOR_INVALID'),
})

export const productInputSchema = z.object({
  name: nameSchema,
  nameEn: optionalText(120),
  genericName: optionalText(160),
  description: optionalText(1000),
  categoryId: optionalId,
  brandId: optionalId,
  taxRateId: optionalId,
  baseUnitId: idSchema,
  prescriptionRequired: z.boolean(),
  trackLots: z.boolean(),
  trackSerials: z.boolean(),
  conversions: z.array(conversionInputSchema),
  variants: z.array(variantInputSchema).min(1, 'VARIANT_REQUIRED'),
})

export type ProductInput = z.input<typeof productInputSchema>
export type ProductOutput = z.output<typeof productInputSchema>

const variantSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  sku: z.string(),
  costMinor: z.number(),
  isDefault: z.boolean(),
  barcodes: z.array(z.object({ code: z.string(), unitId: z.string() })),
  prices: z.array(z.object({ priceListId: z.string(), unitId: z.string(), amountMinor: z.number() })),
  attributeValueIds: z.array(z.string()),
})

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  genericName: z.string().nullable(),
  description: z.string().nullable(),
  categoryId: z.string().nullable(),
  brandId: z.string().nullable(),
  taxRateId: z.string().nullable(),
  baseUnitId: z.string(),
  prescriptionRequired: z.boolean(),
  trackLots: z.boolean(),
  trackSerials: z.boolean(),
  archived: z.boolean(),
  conversions: z.array(z.object({ unitId: z.string(), factorMilli: z.number() })),
  variants: z.array(variantSchema),
})

export type Product = z.infer<typeof productSchema>

export const productRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  genericName: z.string().nullable(),
  categoryName: z.string().nullable(),
  brandName: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  priceMinor: z.number().nullable(),
  variantCount: z.number(),
  archived: z.boolean(),
})

export type ProductRow = z.infer<typeof productRowSchema>

export const productPageSchema = pageOf(productRowSchema).extend({ total: z.number() })

export type ProductPage = z.infer<typeof productPageSchema>

export const productQuerySchema = pageQuerySchema.extend({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  archived: z.enum(['true', 'false']).optional(),
})

export const productLabelSchema = z.object({
  variantId: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  barcode: z.string(),
  priceMinor: z.number().nullable(),
})

export type ProductLabel = z.infer<typeof productLabelSchema>

export const productLabelsSchema = z.object({ items: z.array(productLabelSchema) })

export const generatedBarcodeSchema = z.object({ code: z.string() })

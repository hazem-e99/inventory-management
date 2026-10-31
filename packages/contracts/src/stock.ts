import { z } from 'zod'
import { idSchema, optionalText, pageOf, pageQuerySchema } from './common'
import { moneyMinorSchema } from './catalog'

export const STOCK_DOCUMENT_KINDS = ['adjustment', 'transfer', 'count'] as const
export type StockDocumentKind = (typeof STOCK_DOCUMENT_KINDS)[number]

export const STOCK_DOCUMENT_STATUSES = ['draft', 'posted', 'voided'] as const
export type StockDocumentStatus = (typeof STOCK_DOCUMENT_STATUSES)[number]

export const ADJUSTMENT_REASONS = ['opening', 'correction', 'damage', 'expired', 'theft', 'gift', 'other'] as const
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]

/** Document numbers read like the shop's paper books: ADJ-000012. */
export const STOCK_DOCUMENT_PREFIX: Record<StockDocumentKind, string> = {
  adjustment: 'ADJ',
  transfer: 'TRF',
  count: 'CNT',
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'EXPIRY_INVALID')

export const stockLineInputSchema = z.object({
  variantId: idSchema,
  unitId: idSchema,
  // Thousandths of the chosen unit. Signed on adjustments, the counted amount on a count.
  qtyMilli: z.number({ error: 'QUANTITY_INVALID' }).int('QUANTITY_INVALID'),
  lotId: idSchema.nullable().optional(),
  lotNo: optionalText(60),
  expiryDate: dateSchema.nullable().optional(),
  unitCostMinor: moneyMinorSchema.nullable().optional(),
})

export type StockLineInput = z.input<typeof stockLineInputSchema>

export const stockDocumentInputSchema = z.object({
  kind: z.enum(STOCK_DOCUMENT_KINDS),
  warehouseId: idSchema,
  toWarehouseId: idSchema.nullable().optional(),
  reason: z.enum(ADJUSTMENT_REASONS).nullable().optional(),
  notes: optionalText(500),
  lines: z.array(stockLineInputSchema).max(5000, 'TEXT_TOO_LONG'),
})

export type StockDocumentInput = z.input<typeof stockDocumentInputSchema>

export const stockLineSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  productId: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string(),
  baseUnitId: z.string(),
  unitId: z.string(),
  qtyMilli: z.number(),
  lotId: z.string().nullable(),
  lotNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  unitCostMinor: z.number().nullable(),
  expectedMilli: z.number().nullable(),
  trackLots: z.boolean(),
})

export type StockLine = z.infer<typeof stockLineSchema>

export const stockDocumentSchema = z.object({
  id: z.string(),
  kind: z.enum(STOCK_DOCUMENT_KINDS),
  status: z.enum(STOCK_DOCUMENT_STATUSES),
  number: z.string().nullable(),
  warehouseId: z.string(),
  toWarehouseId: z.string().nullable(),
  reason: z.enum(ADJUSTMENT_REASONS).nullable(),
  notes: z.string().nullable(),
  businessDate: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
  postedAt: z.number().nullable(),
  voidedAt: z.number().nullable(),
  lines: z.array(stockLineSchema),
})

export type StockDocument = z.infer<typeof stockDocumentSchema>

export const stockDocumentRowSchema = stockDocumentSchema.omit({ lines: true }).extend({
  lineCount: z.number(),
})

export type StockDocumentRow = z.infer<typeof stockDocumentRowSchema>

export const stockDocumentPageSchema = pageOf(stockDocumentRowSchema)

export const stockDocumentQuerySchema = pageQuerySchema.extend({
  kind: z.enum(STOCK_DOCUMENT_KINDS).optional(),
  status: z.enum(STOCK_DOCUMENT_STATUSES).optional(),
})

export const countSheetInputSchema = z.object({
  warehouseId: idSchema,
  categoryId: idSchema.nullable().optional(),
})

export const stockPickRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string(),
  baseUnitId: z.string(),
  unitId: z.string(),
  allowsFraction: z.boolean(),
  trackLots: z.boolean(),
  onHandMilli: z.number(),
  costMinor: z.number(),
  units: z.array(z.object({ unitId: z.string(), factorMilli: z.number() })),
  lots: z.array(
    z.object({
      lotId: z.string(),
      lotNo: z.string(),
      expiryDate: z.string().nullable(),
      availableMilli: z.number(),
    }),
  ),
})

export type StockPickRow = z.infer<typeof stockPickRowSchema>

export const stockPickListSchema = z.object({ items: z.array(stockPickRowSchema) })

export const stockPickQuerySchema = z.object({
  search: z.string().optional(),
  warehouseId: idSchema,
})

export const stockBalanceSchema = z.object({
  warehouseId: z.string(),
  warehouseName: z.string(),
  lotId: z.string().nullable(),
  lotNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  qtyMilli: z.number(),
})

export const productStockSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  baseUnitId: z.string(),
  variants: z.array(
    z.object({
      variantId: z.string(),
      label: z.string().nullable(),
      sku: z.string(),
      onHandMilli: z.number(),
      valueMinor: z.number(),
      averageCostMinor: z.number(),
      balances: z.array(stockBalanceSchema),
    }),
  ),
})

export type ProductStock = z.infer<typeof productStockSchema>

export const stockMovementSchema = z.object({
  id: z.string(),
  occurredAt: z.number(),
  variantLabel: z.string().nullable(),
  warehouseName: z.string(),
  lotNo: z.string().nullable(),
  qtyMilli: z.number(),
  valueMinor: z.number(),
  documentId: z.string(),
  documentKind: z.enum(STOCK_DOCUMENT_KINDS),
  documentNumber: z.string().nullable(),
  reversal: z.boolean(),
  actorName: z.string().nullable(),
})

export type StockMovement = z.infer<typeof stockMovementSchema>

export const stockMovementPageSchema = pageOf(stockMovementSchema)

export const stockPolicySchema = z.object({ allowNegative: z.boolean() })

export type StockPolicy = z.infer<typeof stockPolicySchema>

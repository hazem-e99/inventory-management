import { z } from 'zod'
import { idSchema, optionalText, pageOf, pageQuerySchema, requiredText } from './common'
import { moneyMinorSchema, MAX_AMOUNT_MINOR } from './catalog'

export const PURCHASE_KINDS = ['invoice', 'return'] as const
export type PurchaseKind = (typeof PURCHASE_KINDS)[number]

export const PURCHASE_STATUSES = ['draft', 'posted', 'voided'] as const
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]

export const ORDER_STATUSES = ['draft', 'open', 'partial', 'received', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_METHODS = ['cash', 'bank', 'wallet', 'cheque'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PURCHASE_PREFIX: Record<PurchaseKind, string> = { invoice: 'PUR', return: 'PRT' }
export const ORDER_PREFIX = 'PO'
export const PAYMENT_PREFIX = 'PAY'

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_VALUE')

export const supplierInputSchema = z.object({
  name: requiredText(160),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?[0-9][0-9\s()-]{5,19})?$/, 'PHONE_INVALID')
    .transform((value) => value || null)
    .nullable()
    .optional(),
  address: optionalText(240),
  taxNumber: z
    .string()
    .trim()
    .regex(/^(\d{9})?$/, 'TAX_NUMBER_INVALID')
    .transform((value) => value || null)
    .nullable()
    .optional(),
  notes: optionalText(500),
  // Only read on creation: what is owed before the app existed. Negative means they owe us.
  openingBalanceMinor: z
    .number({ error: 'PRICE_INVALID' })
    .int('PRICE_INVALID')
    .min(-MAX_AMOUNT_MINOR, 'PRICE_INVALID')
    .max(MAX_AMOUNT_MINOR, 'PRICE_INVALID')
    .optional(),
})

export type SupplierInput = z.input<typeof supplierInputSchema>

export const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  taxNumber: z.string().nullable(),
  notes: z.string().nullable(),
  balanceMinor: z.number(),
  archived: z.boolean(),
})

export type Supplier = z.infer<typeof supplierSchema>

export const supplierPageSchema = pageOf(supplierSchema)

export const supplierQuerySchema = pageQuerySchema.extend({
  search: z.string().optional(),
  archived: z.enum(['true', 'false']).optional(),
})

export const LEDGER_SOURCES = ['opening', 'purchase', 'purchase_return', 'payment'] as const
export type LedgerSource = (typeof LEDGER_SOURCES)[number]

export const statementEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.number(),
  source: z.enum(LEDGER_SOURCES),
  documentId: z.string(),
  documentNumber: z.string().nullable(),
  amountMinor: z.number(),
  balanceMinor: z.number(),
  reversal: z.boolean(),
  // Set on a payment made with an invoice, which only voiding that invoice can undo.
  purchaseId: z.string().nullable(),
})

export type StatementEntry = z.infer<typeof statementEntrySchema>

export const statementPageSchema = pageOf(statementEntrySchema)

export const paymentInputSchema = z.object({
  amountMinor: moneyMinorSchema.refine((value) => value > 0, 'PRICE_INVALID'),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(80),
  notes: optionalText(240),
})

export type PaymentInput = z.input<typeof paymentInputSchema>

export const paymentSchema = z.object({
  id: z.string(),
  number: z.string(),
  supplierId: z.string(),
  amountMinor: z.number(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  status: z.enum(['posted', 'voided']),
  createdAt: z.number(),
})

export type Payment = z.infer<typeof paymentSchema>

const quantitySchema = z.number({ error: 'QUANTITY_INVALID' }).int('QUANTITY_INVALID')

export const orderLineInputSchema = z.object({
  variantId: idSchema,
  unitId: idSchema,
  qtyMilli: quantitySchema,
  unitCostMinor: moneyMinorSchema,
})

export const orderInputSchema = z.object({
  supplierId: idSchema,
  warehouseId: idSchema,
  expectedDate: dateText.nullable().optional(),
  notes: optionalText(500),
  lines: z.array(orderLineInputSchema).max(2000, 'TEXT_TOO_LONG'),
})

export type OrderInput = z.input<typeof orderInputSchema>

const itemFields = {
  variantId: z.string(),
  productId: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string(),
  baseUnitId: z.string(),
  unitId: z.string(),
  trackLots: z.boolean(),
  trackSerials: z.boolean(),
}

export const orderLineSchema = z.object({
  id: z.string(),
  ...itemFields,
  taxRateBp: z.number(),
  qtyMilli: z.number(),
  unitCostMinor: z.number(),
  orderedBaseMilli: z.number(),
  receivedBaseMilli: z.number(),
})

export type OrderLine = z.infer<typeof orderLineSchema>

const orderHeader = {
  id: z.string(),
  number: z.string().nullable(),
  status: z.enum(ORDER_STATUSES),
  supplierId: z.string(),
  supplierName: z.string(),
  warehouseId: z.string(),
  expectedDate: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.number(),
  totalMinor: z.number(),
}

export const orderSchema = z.object({ ...orderHeader, lines: z.array(orderLineSchema) })
export type Order = z.infer<typeof orderSchema>

export const orderRowSchema = z.object({ ...orderHeader, lineCount: z.number() })
export type OrderRow = z.infer<typeof orderRowSchema>

export const orderPageSchema = pageOf(orderRowSchema)

export const orderQuerySchema = pageQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  supplierId: z.string().optional(),
})

export const purchaseLineInputSchema = z.object({
  variantId: idSchema,
  unitId: idSchema,
  qtyMilli: quantitySchema,
  unitCostMinor: moneyMinorSchema,
  discountMinor: moneyMinorSchema,
  taxRateBp: z.number({ error: 'INVALID_VALUE' }).int('INVALID_VALUE').min(0, 'INVALID_VALUE').max(10_000, 'INVALID_VALUE'),
  lotId: idSchema.nullable().optional(),
  lotNo: optionalText(60),
  expiryDate: dateText.nullable().optional(),
  serials: z.array(z.string().trim().min(1, 'REQUIRED').max(80, 'TEXT_TOO_LONG')).max(5000, 'TEXT_TOO_LONG').optional(),
  orderLineId: idSchema.nullable().optional(),
})

export type PurchaseLineInput = z.input<typeof purchaseLineInputSchema>

export const purchaseInputSchema = z.object({
  kind: z.enum(PURCHASE_KINDS),
  supplierId: idSchema,
  warehouseId: idSchema,
  orderId: idSchema.nullable().optional(),
  supplierReference: optionalText(80),
  notes: optionalText(500),
  paidMinor: moneyMinorSchema.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  lines: z.array(purchaseLineInputSchema).max(2000, 'TEXT_TOO_LONG'),
})

export type PurchaseInput = z.input<typeof purchaseInputSchema>

export const purchaseLineSchema = z.object({
  id: z.string(),
  ...itemFields,
  qtyMilli: z.number(),
  unitCostMinor: z.number(),
  discountMinor: z.number(),
  taxRateBp: z.number(),
  lotId: z.string().nullable(),
  lotNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  serials: z.array(z.string()),
  orderLineId: z.string().nullable(),
})

export type PurchaseLine = z.infer<typeof purchaseLineSchema>

const purchaseHeader = {
  id: z.string(),
  kind: z.enum(PURCHASE_KINDS),
  status: z.enum(PURCHASE_STATUSES),
  number: z.string().nullable(),
  supplierId: z.string(),
  supplierName: z.string(),
  warehouseId: z.string(),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  supplierReference: z.string().nullable(),
  notes: z.string().nullable(),
  paidMinor: z.number(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  businessDate: z.string().nullable(),
  createdAt: z.number(),
  grossMinor: z.number(),
  discountMinor: z.number(),
  netMinor: z.number(),
  taxMinor: z.number(),
  totalMinor: z.number(),
}

export const purchaseSchema = z.object({ ...purchaseHeader, lines: z.array(purchaseLineSchema) })
export type Purchase = z.infer<typeof purchaseSchema>

export const purchaseRowSchema = z.object({ ...purchaseHeader, lineCount: z.number() })
export type PurchaseRow = z.infer<typeof purchaseRowSchema>

export const purchasePageSchema = pageOf(purchaseRowSchema)

export const purchaseQuerySchema = pageQuerySchema.extend({
  kind: z.enum(PURCHASE_KINDS).optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  supplierId: z.string().optional(),
})

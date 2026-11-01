import { z } from 'zod'
import { moneyMinorSchema, MAX_AMOUNT_MINOR } from './catalog'
import { idSchema, optionalText, pageOf, pageQuerySchema, requiredText } from './common'
import { stockPickRowSchema } from './stock'

export const SALE_KINDS = ['sale', 'return'] as const
export type SaleKind = (typeof SALE_KINDS)[number]

export const SALE_STATUSES = ['posted', 'voided'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export const TENDER_METHODS = ['cash', 'card', 'wallet', 'credit'] as const
export type TenderMethod = (typeof TENDER_METHODS)[number]

/** Money that actually changes hands. Credit only moves the customer's balance. */
export const RECEIPT_METHODS = ['cash', 'card', 'wallet'] as const
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number]

export const SALE_PREFIX: Record<SaleKind, string> = { sale: 'INV', return: 'RET' }
export const SHIFT_PREFIX = 'SH'
export const RECEIPT_PREFIX = 'RCT'

const PHONE_PATTERN = /^(\+?[0-9][0-9\s()-]{5,19})?$/

export const customerInputSchema = z.object({
  name: requiredText(160),
  phone: z
    .string()
    .trim()
    .regex(PHONE_PATTERN, 'PHONE_INVALID')
    .transform((value) => value || null)
    .nullable()
    .optional(),
  address: optionalText(240),
  notes: optionalText(500),
  creditLimitMinor: moneyMinorSchema.nullable().optional(),
  // Only read on creation: what they owed before the app existed. Negative is their credit.
  openingBalanceMinor: z
    .number({ error: 'PRICE_INVALID' })
    .int('PRICE_INVALID')
    .min(-MAX_AMOUNT_MINOR, 'PRICE_INVALID')
    .max(MAX_AMOUNT_MINOR, 'PRICE_INVALID')
    .optional(),
})

export type CustomerInput = z.input<typeof customerInputSchema>

export const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  creditLimitMinor: z.number().nullable(),
  balanceMinor: z.number(),
  archived: z.boolean(),
})

export type Customer = z.infer<typeof customerSchema>

export const customerPageSchema = pageOf(customerSchema)

export const customerQuerySchema = pageQuerySchema.extend({
  search: z.string().optional(),
  archived: z.enum(['true', 'false']).optional(),
})

export const CUSTOMER_LEDGER_SOURCES = ['opening', 'sale', 'sale_return', 'receipt'] as const
export type CustomerLedgerSource = (typeof CUSTOMER_LEDGER_SOURCES)[number]

export const customerEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.number(),
  source: z.enum(CUSTOMER_LEDGER_SOURCES),
  documentId: z.string(),
  documentNumber: z.string().nullable(),
  amountMinor: z.number(),
  balanceMinor: z.number(),
  reversal: z.boolean(),
})

export type CustomerEntry = z.infer<typeof customerEntrySchema>

export const customerStatementSchema = pageOf(customerEntrySchema)

export const receiptInputSchema = z.object({
  amountMinor: moneyMinorSchema.refine((value) => value > 0, 'PRICE_INVALID'),
  method: z.enum(RECEIPT_METHODS),
  reference: optionalText(80),
  notes: optionalText(240),
})

export type ReceiptInput = z.input<typeof receiptInputSchema>

export const receiptSchema = z.object({
  id: z.string(),
  number: z.string(),
  customerId: z.string(),
  amountMinor: z.number(),
  method: z.enum(RECEIPT_METHODS),
  status: z.enum(['posted', 'voided']),
  createdAt: z.number(),
})

export type Receipt = z.infer<typeof receiptSchema>

/** What the cashier needs for one item, in a single round trip, so a scan feels instant. */
export const posItemSchema = stockPickRowSchema.extend({
  prescriptionRequired: z.boolean(),
  prices: z.array(z.object({ unitId: z.string(), amountMinor: z.number() })),
  // Set when the code was a scale label, which carries its own weight.
  scaleQtyMilli: z.number().nullable(),
})

export type PosItem = z.infer<typeof posItemSchema>

export const posLookupSchema = z.object({ items: z.array(posItemSchema) })

export const posLookupQuerySchema = z.object({ search: z.string().min(1).max(120) })

const quantitySchema = z.number({ error: 'QUANTITY_INVALID' }).int('QUANTITY_INVALID').positive('QUANTITY_INVALID')

const serialsSchema = z.array(z.string().trim().min(1, 'REQUIRED').max(80, 'TEXT_TOO_LONG')).max(5000, 'TEXT_TOO_LONG')

export const saleLineInputSchema = z.object({
  variantId: idSchema,
  unitId: idSchema,
  qtyMilli: quantitySchema,
  unitPriceMinor: moneyMinorSchema,
  discountMinor: moneyMinorSchema,
  lotId: idSchema.nullable().optional(),
  serials: serialsSchema.optional(),
})

export type SaleLineInput = z.input<typeof saleLineInputSchema>

export const tenderInputSchema = z.object({
  method: z.enum(TENDER_METHODS),
  amountMinor: moneyMinorSchema,
})

export const checkoutSchema = z.object({
  // Sent again on a retry, so a slow response can't ring the same sale up twice.
  requestId: z.string().min(8).max(64),
  customerId: idSchema.nullable().optional(),
  discountMinor: moneyMinorSchema.optional(),
  notes: optionalText(500),
  heldId: idSchema.nullable().optional(),
  lines: z.array(saleLineInputSchema).max(2000, 'TEXT_TOO_LONG'),
  tenders: z.array(tenderInputSchema).max(8, 'TEXT_TOO_LONG'),
})

export type CheckoutInput = z.input<typeof checkoutSchema>

export const saleLineSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  itemName: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string(),
  unitId: z.string(),
  qtyMilli: z.number(),
  baseQtyMilli: z.number(),
  unitPriceMinor: z.number(),
  discountMinor: z.number(),
  taxRateBp: z.number(),
  taxMinor: z.number(),
  totalMinor: z.number(),
  serials: z.array(z.string()),
  returnedBaseMilli: z.number(),
  refundedMinor: z.number(),
  lots: z.array(z.object({ lotNo: z.string().nullable(), expiryDate: z.string().nullable(), qtyMilli: z.number() })),
})

export type SaleLine = z.infer<typeof saleLineSchema>

export const salePaymentSchema = z.object({
  id: z.string(),
  method: z.enum(TENDER_METHODS),
  amountMinor: z.number(),
  reversal: z.boolean(),
})

const saleHeader = {
  id: z.string(),
  kind: z.enum(SALE_KINDS),
  status: z.enum(SALE_STATUSES),
  number: z.string(),
  returnOfId: z.string().nullable(),
  returnOfNumber: z.string().nullable(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  shiftId: z.string(),
  warehouseId: z.string(),
  grossMinor: z.number(),
  discountMinor: z.number(),
  taxMinor: z.number(),
  totalMinor: z.number(),
  tenderedMinor: z.number(),
  changeMinor: z.number(),
  notes: z.string().nullable(),
  cashierName: z.string().nullable(),
  createdAt: z.number(),
  voidedAt: z.number().nullable(),
}

export const saleSchema = z.object({ ...saleHeader, lines: z.array(saleLineSchema), payments: z.array(salePaymentSchema) })
export type Sale = z.infer<typeof saleSchema>

export const saleRowSchema = z.object({ ...saleHeader, lineCount: z.number() })
export type SaleRow = z.infer<typeof saleRowSchema>

export const salePageSchema = pageOf(saleRowSchema)

export const saleQuerySchema = pageQuerySchema.extend({
  kind: z.enum(SALE_KINDS).optional(),
  status: z.enum(SALE_STATUSES).optional(),
  customerId: z.string().optional(),
  shiftId: z.string().optional(),
  search: z.string().optional(),
})

export const returnInputSchema = z.object({
  requestId: z.string().min(8).max(64),
  method: z.enum(TENDER_METHODS),
  reason: optionalText(240),
  lines: z
    .array(
      z.object({
        saleLineId: idSchema,
        qtyMilli: quantitySchema,
        serials: serialsSchema.optional(),
      }),
    )
    .max(2000, 'TEXT_TOO_LONG'),
})

export type ReturnInput = z.input<typeof returnInputSchema>

/** A parked cart keeps what the screen needs to pick up where it stopped, without any lookup. */
export const heldLineSchema = z.object({
  item: posItemSchema,
  unitId: z.string(),
  qtyMilli: z.number(),
  unitPriceMinor: z.number(),
  discountMinor: z.number(),
  lotId: z.string().nullable(),
  serials: z.array(z.string()),
})

export type HeldLine = z.infer<typeof heldLineSchema>

export const heldInputSchema = z.object({
  label: optionalText(80),
  customer: z.object({ id: z.string(), name: z.string() }).nullable(),
  discountMinor: moneyMinorSchema,
  lines: z.array(heldLineSchema).min(1, 'REQUIRED').max(2000, 'TEXT_TOO_LONG'),
})

export type HeldInput = z.input<typeof heldInputSchema>

export const heldSaleSchema = heldInputSchema.extend({
  id: z.string(),
  label: z.string().nullable(),
  createdAt: z.number(),
  totalMinor: z.number(),
})

export type HeldSale = z.infer<typeof heldSaleSchema>

export const heldListSchema = z.object({ items: z.array(heldSaleSchema) })

export const SHIFT_STATUSES = ['open', 'closed'] as const
export type ShiftStatus = (typeof SHIFT_STATUSES)[number]

export const openShiftSchema = z.object({ openingCashMinor: moneyMinorSchema })

export const closeShiftSchema = z.object({
  countedCashMinor: moneyMinorSchema,
  notes: optionalText(240),
})

export const CASH_MOVEMENT_KINDS = ['in', 'out', 'receipt'] as const
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number]

export const cashMovementInputSchema = z.object({
  kind: z.enum(['in', 'out']),
  amountMinor: moneyMinorSchema.refine((value) => value > 0, 'PRICE_INVALID'),
  reason: requiredText(160),
})

export type CashMovementInput = z.input<typeof cashMovementInputSchema>

export const cashMovementSchema = z.object({
  id: z.string(),
  kind: z.enum(CASH_MOVEMENT_KINDS),
  amountMinor: z.number(),
  reason: z.string().nullable(),
  occurredAt: z.number(),
})

export type CashMovement = z.infer<typeof cashMovementSchema>

const shiftHeader = {
  id: z.string(),
  number: z.string(),
  status: z.enum(SHIFT_STATUSES),
  userId: z.string(),
  userName: z.string(),
  openedAt: z.number(),
  closedAt: z.number().nullable(),
  openingCashMinor: z.number(),
  expectedCashMinor: z.number().nullable(),
  countedCashMinor: z.number().nullable(),
  differenceMinor: z.number().nullable(),
  notes: z.string().nullable(),
}

export const shiftRowSchema = z.object(shiftHeader)
export type ShiftRow = z.infer<typeof shiftRowSchema>

export const shiftPageSchema = pageOf(shiftRowSchema)

export const shiftSummarySchema = z.object({
  ...shiftHeader,
  expectedCashMinor: z.number(),
  salesCount: z.number(),
  returnsCount: z.number(),
  salesMinor: z.number(),
  returnsMinor: z.number(),
  taxMinor: z.number(),
  discountMinor: z.number(),
  byMethod: z.array(z.object({ method: z.enum(TENDER_METHODS), amountMinor: z.number() })),
  cashInMinor: z.number(),
  cashOutMinor: z.number(),
  receiptsMinor: z.number(),
  movements: z.array(cashMovementSchema),
})

export type ShiftSummary = z.infer<typeof shiftSummarySchema>

export const currentShiftSchema = z.object({ shift: shiftSummarySchema.nullable() })

export const RECEIPT_PAPERS = ['80mm', '58mm', 'a4'] as const
export type ReceiptPaper = (typeof RECEIPT_PAPERS)[number]

export const posSettingsSchema = z.object({
  warehouseId: idSchema,
  receiptPaper: z.enum(RECEIPT_PAPERS),
  printerName: z.string().max(200).nullable(),
  autoPrint: z.boolean(),
})

export type PosSettings = z.infer<typeof posSettingsSchema>

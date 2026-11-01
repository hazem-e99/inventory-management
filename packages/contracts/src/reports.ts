import { z } from 'zod'
import { pageOf } from './common'

export const REPORT_KEYS = ['sales', 'items', 'inventory', 'movements', 'reorder', 'expiry', 'dead', 'suppliers', 'customers', 'shifts'] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_VALUE')

/** Screens page through rows; a PDF asks for one long page, so the limit is higher than a list's. */
export const REPORT_PAGE_LIMIT = 5000

export const reportQuerySchema = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(REPORT_PAGE_LIMIT).default(50),
})

export type ReportQuery = z.input<typeof reportQuerySchema>
export type ReportFilter = z.output<typeof reportQuerySchema>

/** Cost is hidden from whoever may not see it, by the server: a null, never a zero. */
const hidden = z.number().nullable()

export const salesDayRowSchema = z.object({
  date: z.string(),
  salesCount: z.number(),
  returnsCount: z.number(),
  salesMinor: z.number(),
  returnsMinor: z.number(),
  netMinor: z.number(),
  discountMinor: z.number(),
  taxMinor: z.number(),
  costMinor: hidden,
  profitMinor: hidden,
})

export const itemRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  qtyMilli: z.number(),
  salesMinor: z.number(),
  costMinor: hidden,
  profitMinor: hidden,
  abc: z.enum(['A', 'B', 'C']),
})

export const inventoryRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  category: z.string().nullable(),
  onHandMilli: z.number(),
  averageCostMinor: hidden,
  valueMinor: hidden,
})

export const movementRowSchema = z.object({
  id: z.string(),
  occurredAt: z.number(),
  productId: z.string(),
  name: z.string(),
  warehouse: z.string(),
  lotNo: z.string().nullable(),
  kind: z.string(),
  documentId: z.string(),
  documentNumber: z.string().nullable(),
  reversal: z.boolean(),
  qtyMilli: z.number(),
  valueMinor: hidden,
})

export const reorderRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  name: z.string(),
  baseUnitId: z.string(),
  onHandMilli: z.number(),
  levelMilli: z.number(),
  soldLastMonthMilli: z.number(),
  suggestedMilli: z.number(),
  costMinor: z.number(),
  supplier: z.string().nullable(),
})

export const expiryRowSchema = z.object({
  lotId: z.string(),
  productId: z.string(),
  name: z.string(),
  lotNo: z.string(),
  expiryDate: z.string(),
  daysLeft: z.number(),
  warehouse: z.string(),
  qtyMilli: z.number(),
})

export const deadRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  name: z.string(),
  onHandMilli: z.number(),
  valueMinor: hidden,
  lastSoldOn: z.string().nullable(),
})

export const supplierReportRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  purchasesMinor: z.number(),
  returnsMinor: z.number(),
  paidMinor: z.number(),
  balanceMinor: z.number(),
})

export const customerReportRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  salesMinor: z.number(),
  returnsMinor: z.number(),
  collectedMinor: z.number(),
  balanceMinor: z.number(),
})

export const shiftReportRowSchema = z.object({
  id: z.string(),
  number: z.string(),
  cashier: z.string(),
  openedAt: z.number(),
  closedAt: z.number().nullable(),
  salesMinor: z.number(),
  returnsMinor: z.number(),
  expectedCashMinor: z.number().nullable(),
  countedCashMinor: z.number().nullable(),
  differenceMinor: z.number().nullable(),
})

/** Each report's rows, which the screen checks against what the server sent. */
export const REPORT_ROWS = {
  sales: salesDayRowSchema,
  items: itemRowSchema,
  inventory: inventoryRowSchema,
  movements: movementRowSchema,
  reorder: reorderRowSchema,
  expiry: expiryRowSchema,
  dead: deadRowSchema,
  suppliers: supplierReportRowSchema,
  customers: customerReportRowSchema,
  shifts: shiftReportRowSchema,
} as const

export type ReportRow<K extends ReportKey> = z.infer<(typeof REPORT_ROWS)[K]>

const reportEnvelope = { totals: z.record(z.string(), z.number().nullable()) }

export const reportPageSchema = <T extends z.ZodType>(row: T) => pageOf(row).extend(reportEnvelope)

export const anyReportPageSchema = reportPageSchema(z.record(z.string(), z.unknown()))

export const reportParamsSchema = z.object({ key: z.enum(REPORT_KEYS) })

export const COLUMN_KINDS = ['text', 'money', 'quantity', 'number', 'date', 'dateTime'] as const
export type ColumnKind = (typeof COLUMN_KINDS)[number]

export const reportExportSchema = z.object({
  destination: z.string().min(1),
  from: dateText.optional(),
  to: dateText.optional(),
  days: z.number().int().min(1).max(3650).optional(),
  // Headers come from the screen, because the server never holds translated text.
  columns: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        kind: z.enum(COLUMN_KINDS),
        // Translated cell text, for columns holding a code such as a document type.
        values: z.record(z.string(), z.string()).optional(),
      }),
    )
    .min(1),
  rightToLeft: z.boolean(),
})

export const alertsSchema = z.object({
  lowStock: z.number(),
  nearExpiry: z.number(),
  expired: z.number(),
})

export type Alerts = z.infer<typeof alertsSchema>

export const dashboardSchema = z.object({
  today: z.object({
    salesCount: z.number(),
    netMinor: z.number(),
    returnsMinor: z.number(),
    profitMinor: hidden,
  }),
  days: z.array(z.object({ date: z.string(), netMinor: z.number() })),
  alerts: alertsSchema,
})

export type Dashboard = z.infer<typeof dashboardSchema>

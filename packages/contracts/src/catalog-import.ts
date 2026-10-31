import { z } from 'zod'
import { ERROR_CODES } from './errors'
import { LOCALES } from './settings'

/** Every spelling accepted in a header row; the first of each language names exported files. */
export const IMPORT_COLUMNS = {
  name: { required: true, ar: ['اسم الصنف', 'الصنف', 'الاسم'], en: ['Item name', 'Name', 'Product'] },
  nameEn: { required: false, ar: ['الاسم بالإنجليزية'], en: ['English name', 'Name EN'] },
  genericName: { required: false, ar: ['الاسم العلمي', 'المادة الفعالة'], en: ['Generic name'] },
  category: { required: false, ar: ['التصنيف', 'القسم'], en: ['Category'] },
  brand: { required: false, ar: ['الماركة', 'الشركة'], en: ['Brand', 'Manufacturer'] },
  unit: { required: false, ar: ['الوحدة'], en: ['Unit'] },
  barcode: { required: false, ar: ['الباركود'], en: ['Barcode'] },
  sku: { required: false, ar: ['كود الصنف', 'الكود'], en: ['SKU', 'Code'] },
  price: { required: false, ar: ['سعر البيع', 'السعر'], en: ['Sale price', 'Price'] },
  cost: { required: false, ar: ['سعر الشراء', 'التكلفة'], en: ['Cost price', 'Cost'] },
} as const satisfies Record<string, { required: boolean; ar: readonly string[]; en: readonly string[] }>

export type ImportColumn = keyof typeof IMPORT_COLUMNS

export const IMPORT_COLUMN_KEYS = Object.keys(IMPORT_COLUMNS) as ImportColumn[]

export const MAX_IMPORT_ROWS = 50_000

export const catalogFileSchema = z.object({
  path: z.string({ error: 'REQUIRED' }).regex(/\.(xlsx|csv)$/i, 'IMPORT_FILE_INVALID'),
})

export const catalogDestinationSchema = z.object({
  destination: z.string({ error: 'REQUIRED' }).regex(/\.xlsx$/i, 'IMPORT_FILE_INVALID'),
  locale: z.enum(LOCALES),
})

export const importIssueSchema = z.object({
  row: z.number(),
  column: z.enum(IMPORT_COLUMN_KEYS as [ImportColumn, ...ImportColumn[]]).nullable(),
  code: z.enum(ERROR_CODES),
  value: z.string().nullable(),
})

export type ImportIssue = z.infer<typeof importIssueSchema>

export const importReportSchema = z.object({
  totalRows: z.number(),
  validRows: z.number(),
  importedRows: z.number(),
  newCategories: z.array(z.string()),
  newBrands: z.array(z.string()),
  issues: z.array(importIssueSchema),
})

export type ImportReport = z.infer<typeof importReportSchema>

export const importIssuesExportSchema = z.object({
  destination: z.string({ error: 'REQUIRED' }).regex(/\.xlsx$/i, 'IMPORT_FILE_INVALID'),
  rows: z.array(z.array(z.string())).max(MAX_IMPORT_ROWS + 1),
})

export const fileSavedSchema = z.object({ rows: z.number() })

import { z } from 'zod'

export const AI_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const
export type AiMediaType = (typeof AI_MEDIA_TYPES)[number]

const printedDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Numbers stay as printed. Turning them into piastres is the shop's side of the line. */
export const invoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  lineTotal: z.number().nullable(),
  batch: z.string().nullable(),
  expiry: printedDate.nullable(),
  /** Low when the model had to work the value out rather than read it clearly. */
  confidence: z.enum(['high', 'low']),
})

export const invoiceReadingSchema = z.object({
  supplierName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: printedDate.nullable(),
  lines: z.array(invoiceLineSchema),
  total: z.number().nullable(),
})

export type InvoiceLine = z.infer<typeof invoiceLineSchema>
export type InvoiceReading = z.infer<typeof invoiceReadingSchema>

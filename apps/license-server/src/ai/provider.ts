import type { AiMediaType, InvoiceReading } from '@inv/license-core'

export interface AiUsage {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface InvoiceFile {
  data: string
  mimeType: AiMediaType
}

/** Everything the rest of the server knows about a model, so changing vendor touches one file. */
export interface AiProvider {
  readInvoice(file: InvoiceFile): Promise<{ invoice: InvoiceReading; usage: AiUsage }>
}

/** The model answered and was billed, but what it said can't be used. */
export class AiUnreadable extends Error {
  constructor(readonly usage: AiUsage) {
    super('AI_UNREADABLE')
  }
}

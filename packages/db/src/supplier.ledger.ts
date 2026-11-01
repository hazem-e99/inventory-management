import type { Kysely } from 'kysely'
import { isSqlite } from './dialect'
import { newId } from './ids'
import type { Database } from './schema'

export interface SupplierLedgerContext {
  source: string
  documentId: string
  documentNumber: string | null
  actorId: string | null
  occurredAt: number
  businessDate: string
}

/**
 * What the shop owes each supplier, kept the way stock is: an append-only trail, with the
 * balance updated in the same transaction. A positive amount means the shop owes more.
 */
export function supplierLedger(db: Kysely<Database>, context: SupplierLedgerContext) {
  const lockForPosting = !isSqlite(db)

  async function write(supplierId: string, amountMinor: number, reversalOf: string | null): Promise<void> {
    const supplier = await db
      .selectFrom('suppliers')
      .select('balance_minor')
      .where('id', '=', supplierId)
      .$if(lockForPosting, (query) => query.forUpdate())
      .executeTakeFirstOrThrow()

    const balance = Number(supplier.balance_minor) + amountMinor

    await db
      .insertInto('supplier_ledger')
      .values({
        id: newId(),
        supplier_id: supplierId,
        occurred_at: context.occurredAt,
        business_date: context.businessDate,
        amount_minor: amountMinor,
        balance_after_minor: balance,
        source: context.source,
        document_id: context.documentId,
        document_number: context.documentNumber,
        reversal_of: reversalOf,
        actor_id: context.actorId,
      })
      .execute()

    await db.updateTable('suppliers').set({ balance_minor: balance }).where('id', '=', supplierId).execute()
  }

  return {
    post: (supplierId: string, amountMinor: number) => write(supplierId, amountMinor, null),

    /** Posts the opposite of a document's entries, leaving them in the statement. */
    async reverse(documentId: string): Promise<void> {
      const entries = await db
        .selectFrom('supplier_ledger')
        .select(['id', 'supplier_id', 'amount_minor'])
        .where('document_id', '=', documentId)
        .where('reversal_of', 'is', null)
        .execute()

      for (const entry of entries) {
        await write(entry.supplier_id, -Number(entry.amount_minor), entry.id)
      }
    },
  }
}

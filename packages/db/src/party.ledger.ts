import type { Kysely } from 'kysely'
import { isSqlite } from './dialect'
import { newId } from './ids'
import type { Database } from './schema'

export interface PartyLedgerContext {
  source: string
  documentId: string
  documentNumber: string | null
  actorId: string | null
  occurredAt: number
  businessDate: string
}

export type SupplierLedgerContext = PartyLedgerContext

interface PartyTables {
  ledger: string
  parties: string
  key: string
}

/**
 * What each side owes, kept the way stock is: an append-only trail, with the balance updated
 * in the same transaction. Suppliers and customers differ only in the tables they use, so the
 * two can't drift apart. The table names come from the constants below, never from input.
 */
function partyLedger(typed: Kysely<Database>, tables: PartyTables, context: PartyLedgerContext) {
  const lockForPosting = !isSqlite(typed)
  const db = typed as unknown as Kysely<any>

  async function write(partyId: string, amountMinor: number, reversalOf: string | null): Promise<void> {
    const party = await db
      .selectFrom(tables.parties)
      .select('balance_minor')
      .where('id', '=', partyId)
      .$if(lockForPosting, (query) => query.forUpdate())
      .executeTakeFirstOrThrow()

    const balance = Number(party.balance_minor) + amountMinor

    await db
      .insertInto(tables.ledger)
      .values({
        id: newId(),
        [tables.key]: partyId,
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

    await db.updateTable(tables.parties).set({ balance_minor: balance }).where('id', '=', partyId).execute()
  }

  return {
    post: (partyId: string, amountMinor: number) => write(partyId, amountMinor, null),

    /** Posts the opposite of a document's entries, leaving them in the statement. */
    async reverse(documentId: string): Promise<void> {
      const entries = await db
        .selectFrom(tables.ledger)
        .select([`${tables.key} as party_id`, 'id', 'amount_minor'])
        .where('document_id', '=', documentId)
        .where('reversal_of', 'is', null)
        .execute()

      for (const entry of entries) {
        await write(entry.party_id, -Number(entry.amount_minor), entry.id)
      }
    },
  }
}

const SUPPLIERS: PartyTables = { ledger: 'supplier_ledger', parties: 'suppliers', key: 'supplier_id' }
const CUSTOMERS: PartyTables = { ledger: 'customer_ledger', parties: 'customers', key: 'customer_id' }

/** A positive amount means the shop owes the supplier more. */
export const supplierLedger = (db: Kysely<Database>, context: PartyLedgerContext) => partyLedger(db, SUPPLIERS, context)

/** A positive amount means the customer owes the shop more. */
export const customerLedger = (db: Kysely<Database>, context: PartyLedgerContext) => partyLedger(db, CUSTOMERS, context)

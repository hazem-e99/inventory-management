import type { Insertable, Kysely, Selectable } from 'kysely'
import { newId } from './ids'
import type {
  Database,
  PurchaseDocumentLinesTable,
  PurchaseDocumentsTable,
  PurchaseOrderLinesTable,
  PurchaseOrdersTable,
  SuppliersTable,
} from './schema'

export type SupplierRecord = Selectable<SuppliersTable>
export type PurchaseRecord = Selectable<PurchaseDocumentsTable>
export type PurchaseLineRecord = Selectable<PurchaseDocumentLinesTable>
export type OrderRecord = Selectable<PurchaseOrdersTable>
export type OrderLineRecord = Selectable<PurchaseOrderLinesTable>

interface TimeCursor {
  at: number
  id: string
}

interface NameCursor {
  name: string
  id: string
}

const encodeCursor = (cursor: TimeCursor | NameCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url')

function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor) return null
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

export function suppliersRepo(db: Kysely<Database>) {
  return {
    insert(supplier: Insertable<SuppliersTable>) {
      return db.insertInto('suppliers').values(supplier).execute()
    },

    update(id: string, changes: Partial<SupplierRecord>) {
      return db.updateTable('suppliers').set(changes).where('id', '=', id).execute()
    },

    find(id: string): Promise<SupplierRecord | undefined> {
      return db.selectFrom('suppliers').selectAll().where('id', '=', id).executeTakeFirst()
    },

    async page(filter: { terms: string[]; archived: boolean; limit: number; cursor?: string | undefined }) {
      const cursor = decodeCursor<NameCursor>(filter.cursor)

      let query = db
        .selectFrom('suppliers')
        .selectAll()
        .where('archived_at', filter.archived ? 'is not' : 'is', null)
        .orderBy('name')
        .orderBy('id')
        .limit(filter.limit + 1)

      for (const term of filter.terms) query = query.where('search_text', 'like', `%${term}%`)
      if (cursor) {
        query = query.where((eb) =>
          eb.or([eb('name', '>', cursor.name), eb.and([eb('name', '=', cursor.name), eb('id', '>', cursor.id)])]),
        )
      }

      const rows = await query.execute()
      const page = rows.slice(0, filter.limit)
      const last = page.at(-1)
      return {
        rows: page,
        nextCursor: rows.length > filter.limit && last ? encodeCursor({ name: last.name, id: last.id }) : null,
      }
    },

    async statement(supplierId: string, limit: number, cursorText?: string) {
      const cursor = decodeCursor<TimeCursor>(cursorText)

      const rows = await db
        .selectFrom('supplier_ledger as entry')
        .leftJoin('supplier_payments as payment', 'payment.id', 'entry.document_id')
        .selectAll('entry')
        .select('payment.purchase_id')
        .where('entry.supplier_id', '=', supplierId)
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('entry.occurred_at', '<', cursor!.at),
              eb.and([eb('entry.occurred_at', '=', cursor!.at), eb('entry.id', '<', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('entry.occurred_at', 'desc')
        .orderBy('entry.id', 'desc')
        .limit(limit + 1)
        .execute()

      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return {
        rows: page,
        nextCursor: rows.length > limit && last ? encodeCursor({ at: Number(last.occurred_at), id: last.id }) : null,
      }
    },

    insertPayment(payment: Insertable<Database['supplier_payments']>) {
      return db.insertInto('supplier_payments').values(payment).execute()
    },

    findPayment(id: string) {
      return db.selectFrom('supplier_payments').selectAll().where('id', '=', id).executeTakeFirst()
    },

    voidPayment(id: string, now: number) {
      return db.updateTable('supplier_payments').set({ status: 'voided', voided_at: now }).where('id', '=', id).execute()
    },

    paymentsOfPurchase(purchaseId: string) {
      return db
        .selectFrom('supplier_payments')
        .selectAll()
        .where('purchase_id', '=', purchaseId)
        .where('status', '=', 'posted')
        .execute()
    },
  }
}

const itemColumns = [
  'variant.label',
  'variant.sku',
  'product.id as product_id',
  'product.name as product_name',
  'product.base_unit_id',
  'product.track_lots',
  'product.track_serials',
] as const

export function purchasingRepo(db: Kysely<Database>) {
  return {
    insertOrder(order: Insertable<PurchaseOrdersTable>) {
      return db.insertInto('purchase_orders').values(order).execute()
    },

    updateOrder(id: string, changes: Partial<OrderRecord>) {
      return db.updateTable('purchase_orders').set(changes).where('id', '=', id).execute()
    },

    deleteOrder(id: string) {
      return db.deleteFrom('purchase_orders').where('id', '=', id).execute()
    },

    findOrder(id: string) {
      return db
        .selectFrom('purchase_orders as document')
        .innerJoin('suppliers', 'suppliers.id', 'document.supplier_id')
        .selectAll('document')
        .select('suppliers.name as supplier_name')
        .where('document.id', '=', id)
        .executeTakeFirst()
    },

    async replaceOrderLines(
      orderId: string,
      lines: ReadonlyArray<Pick<OrderLineRecord, 'variant_id' | 'unit_id' | 'qty_milli' | 'unit_cost_minor'>>,
    ) {
      await db.deleteFrom('purchase_order_lines').where('order_id', '=', orderId).execute()
      if (lines.length === 0) return
      await db
        .insertInto('purchase_order_lines')
        .values(lines.map((line, position) => ({ ...line, id: newId(), order_id: orderId, position })))
        .execute()
    },

    orderLines(orderId: string) {
      return db
        .selectFrom('purchase_order_lines as line')
        .innerJoin('product_variants as variant', 'variant.id', 'line.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .leftJoin('tax_rates as tax', 'tax.id', 'product.tax_rate_id')
        .selectAll('line')
        .select(itemColumns)
        .select('tax.rate_bp')
        .where('line.order_id', '=', orderId)
        .orderBy('line.position')
        .execute()
    },

    updateOrderLine(id: string, changes: Partial<OrderLineRecord>) {
      return db.updateTable('purchase_order_lines').set(changes).where('id', '=', id).execute()
    },

    findOrderLine(id: string) {
      return db.selectFrom('purchase_order_lines').selectAll().where('id', '=', id).executeTakeFirst()
    },

    async pageOrders(filter: { status?: string | undefined; supplierId?: string | undefined; limit: number; cursor?: string | undefined }) {
      const cursor = decodeCursor<TimeCursor>(filter.cursor)

      const rows = await db
        .selectFrom('purchase_orders as document')
        .innerJoin('suppliers', 'suppliers.id', 'document.supplier_id')
        .selectAll('document')
        .select(['suppliers.name as supplier_name'])
        .$if(Boolean(filter.status), (query) => query.where('document.status', '=', filter.status!))
        .$if(Boolean(filter.supplierId), (query) => query.where('document.supplier_id', '=', filter.supplierId!))
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('document.created_at', '<', cursor!.at),
              eb.and([eb('document.created_at', '=', cursor!.at), eb('document.id', '<', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('document.created_at', 'desc')
        .orderBy('document.id', 'desc')
        .limit(filter.limit + 1)
        .execute()

      const page = rows.slice(0, filter.limit)
      const lines = page.length
        ? await db
            .selectFrom('purchase_order_lines')
            .select(['order_id', 'qty_milli', 'unit_cost_minor'])
            .where('order_id', 'in', page.map(({ id }) => id))
            .execute()
        : []
      const last = page.at(-1)
      return {
        rows: page,
        lines,
        nextCursor:
          rows.length > filter.limit && last ? encodeCursor({ at: Number(last.created_at), id: last.id }) : null,
      }
    },

    insertDocument(document: Insertable<PurchaseDocumentsTable>) {
      return db.insertInto('purchase_documents').values(document).execute()
    },

    updateDocument(id: string, changes: Partial<PurchaseRecord>) {
      return db.updateTable('purchase_documents').set(changes).where('id', '=', id).execute()
    },

    deleteDocument(id: string) {
      return db.deleteFrom('purchase_documents').where('id', '=', id).execute()
    },

    findDocument(id: string) {
      return db
        .selectFrom('purchase_documents as document')
        .innerJoin('suppliers', 'suppliers.id', 'document.supplier_id')
        .leftJoin('purchase_orders as purchase_order', 'purchase_order.id', 'document.order_id')
        .selectAll('document')
        .select(['suppliers.name as supplier_name', 'purchase_order.number as order_number'])
        .where('document.id', '=', id)
        .executeTakeFirst()
    },

    async replaceLines(
      documentId: string,
      lines: ReadonlyArray<Omit<PurchaseLineRecord, 'id' | 'document_id' | 'position'>>,
    ) {
      await db.deleteFrom('purchase_document_lines').where('document_id', '=', documentId).execute()
      if (lines.length === 0) return
      await db
        .insertInto('purchase_document_lines')
        .values(lines.map((line, position) => ({ ...line, id: newId(), document_id: documentId, position })))
        .execute()
    },

    linesOf(documentId: string) {
      return db
        .selectFrom('purchase_document_lines as line')
        .innerJoin('product_variants as variant', 'variant.id', 'line.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .leftJoin('lots as lot', 'lot.id', 'line.lot_id')
        .selectAll('line')
        .select(itemColumns)
        .select(['lot.lot_no as resolved_lot_no', 'lot.expiry_date as resolved_expiry_date'])
        .where('line.document_id', '=', documentId)
        .orderBy('line.position')
        .execute()
    },

    async pageDocuments(filter: {
      kind?: string | undefined
      status?: string | undefined
      supplierId?: string | undefined
      limit: number
      cursor?: string | undefined
    }) {
      const cursor = decodeCursor<TimeCursor>(filter.cursor)

      const rows = await db
        .selectFrom('purchase_documents as document')
        .innerJoin('suppliers', 'suppliers.id', 'document.supplier_id')
        .leftJoin('purchase_orders as purchase_order', 'purchase_order.id', 'document.order_id')
        .selectAll('document')
        .select(['suppliers.name as supplier_name', 'purchase_order.number as order_number'])
        .$if(Boolean(filter.kind), (query) => query.where('document.kind', '=', filter.kind!))
        .$if(Boolean(filter.status), (query) => query.where('document.status', '=', filter.status!))
        .$if(Boolean(filter.supplierId), (query) => query.where('document.supplier_id', '=', filter.supplierId!))
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('document.created_at', '<', cursor!.at),
              eb.and([eb('document.created_at', '=', cursor!.at), eb('document.id', '<', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('document.created_at', 'desc')
        .orderBy('document.id', 'desc')
        .limit(filter.limit + 1)
        .execute()

      const page = rows.slice(0, filter.limit)
      const lines = page.length
        ? await db
            .selectFrom('purchase_document_lines')
            .select(['document_id', 'qty_milli', 'unit_cost_minor', 'discount_minor', 'tax_rate_bp'])
            .where('document_id', 'in', page.map(({ id }) => id))
            .execute()
        : []
      const last = page.at(-1)
      return {
        rows: page,
        lines,
        nextCursor:
          rows.length > filter.limit && last ? encodeCursor({ at: Number(last.created_at), id: last.id }) : null,
      }
    },

    setVariantCost(variantId: string, costMinor: number, now: number) {
      return db
        .updateTable('product_variants')
        .set({ cost_minor: costMinor, updated_at: now })
        .where('id', '=', variantId)
        .execute()
    },

    existingSerials(variantId: string, serials: readonly string[]) {
      if (serials.length === 0) return Promise.resolve([])
      return db
        .selectFrom('serials')
        .selectAll()
        .where('variant_id', '=', variantId)
        .where('serial', 'in', serials)
        .execute()
    },

    async insertSerials(rows: ReadonlyArray<{ variantId: string; serial: string; warehouseId: string; purchaseId: string }>, now: number) {
      if (rows.length === 0) return
      await db
        .insertInto('serials')
        .values(
          rows.map(({ variantId, serial, warehouseId, purchaseId }) => ({
            id: newId(),
            variant_id: variantId,
            serial,
            status: 'in_stock',
            warehouse_id: warehouseId,
            purchase_id: purchaseId,
            created_at: now,
          })),
        )
        .execute()
    },

    setSerialStatus(variantId: string, serials: readonly string[], status: string) {
      return db
        .updateTable('serials')
        .set({ status })
        .where('variant_id', '=', variantId)
        .where('serial', 'in', serials)
        .execute()
    },

    serialsOfPurchase(purchaseId: string) {
      return db.selectFrom('serials').selectAll().where('purchase_id', '=', purchaseId).execute()
    },

    deleteSerialsOfPurchase(purchaseId: string) {
      return db.deleteFrom('serials').where('purchase_id', '=', purchaseId).execute()
    },
  }
}

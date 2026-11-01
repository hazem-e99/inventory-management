import { parseScaleBarcode, type UnitPrice } from '@inv/domain'
import { sql, type Insertable, type Kysely, type Selectable } from 'kysely'
import { DEFAULT_PRICE_LIST_ID } from './catalog.repo'
import { newId } from './ids'
import type {
  CashMovementsTable,
  CustomerReceiptsTable,
  CustomersTable,
  Database,
  HeldSalesTable,
  SaleLineLotsTable,
  SaleLinesTable,
  SalePaymentsTable,
  SalesTable,
  ShiftsTable,
} from './schema'
import { stockRepo } from './stock.repo'

export type CustomerRecord = Selectable<CustomersTable>
export type SaleRecord = Selectable<SalesTable>
export type SaleLineRecord = Selectable<SaleLinesTable>
export type ShiftRecord = Selectable<ShiftsTable>
export type ReceiptRecord = Selectable<CustomerReceiptsTable>

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

export function customersRepo(db: Kysely<Database>) {
  return {
    insert(customer: Insertable<CustomersTable>) {
      return db.insertInto('customers').values(customer).execute()
    },

    update(id: string, changes: Partial<CustomerRecord>) {
      return db.updateTable('customers').set(changes).where('id', '=', id).execute()
    },

    find(id: string): Promise<CustomerRecord | undefined> {
      return db.selectFrom('customers').selectAll().where('id', '=', id).executeTakeFirst()
    },

    async page(filter: { terms: string[]; archived: boolean; limit: number; cursor?: string | undefined }) {
      const cursor = decodeCursor<NameCursor>(filter.cursor)

      let query = db
        .selectFrom('customers')
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

    async statement(customerId: string, limit: number, cursorText?: string) {
      const cursor = decodeCursor<TimeCursor>(cursorText)

      const rows = await db
        .selectFrom('customer_ledger')
        .selectAll()
        .where('customer_id', '=', customerId)
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('occurred_at', '<', cursor!.at),
              eb.and([eb('occurred_at', '=', cursor!.at), eb('id', '<', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)
        .execute()

      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return {
        rows: page,
        nextCursor: rows.length > limit && last ? encodeCursor({ at: Number(last.occurred_at), id: last.id }) : null,
      }
    },

    insertReceipt(receipt: Insertable<CustomerReceiptsTable>) {
      return db.insertInto('customer_receipts').values(receipt).execute()
    },

    findReceipt(id: string): Promise<ReceiptRecord | undefined> {
      return db.selectFrom('customer_receipts').selectAll().where('id', '=', id).executeTakeFirst()
    },

    voidReceipt(id: string, now: number) {
      return db.updateTable('customer_receipts').set({ status: 'voided', voided_at: now }).where('id', '=', id).execute()
    },
  }
}

const saleHeaderQuery = (db: Kysely<Database>) =>
  db
    .selectFrom('sales as sale')
    .leftJoin('customers', 'customers.id', 'sale.customer_id')
    .leftJoin('users', 'users.id', 'sale.created_by')
    .leftJoin('sales as original', 'original.id', 'sale.return_of')
    .selectAll('sale')
    .select(['customers.name as customer_name', 'users.full_name as cashier_name', 'original.number as return_of_number'])

export function salesRepo(db: Kysely<Database>) {
  return {
    insertSale(sale: Insertable<SalesTable>) {
      return db.insertInto('sales').values(sale).execute()
    },

    updateSale(id: string, changes: Partial<SaleRecord>) {
      return db.updateTable('sales').set(changes).where('id', '=', id).execute()
    },

    findSale(id: string) {
      return saleHeaderQuery(db).where('sale.id', '=', id).executeTakeFirst()
    },

    findByRequest(requestId: string) {
      return db.selectFrom('sales').select('id').where('request_id', '=', requestId).executeTakeFirst()
    },

    insertLine(line: Insertable<SaleLinesTable>) {
      return db.insertInto('sale_lines').values(line).execute()
    },

    updateLine(id: string, changes: Partial<SaleLineRecord>) {
      return db.updateTable('sale_lines').set(changes).where('id', '=', id).execute()
    },

    dropFromReports(saleId: string) {
      return db.updateTable('sale_lines').set({ report_date: null }).where('sale_id', '=', saleId).execute()
    },

    insertLineLot(lot: Insertable<SaleLineLotsTable>) {
      return db.insertInto('sale_line_lots').values(lot).execute()
    },

    updateLineLot(id: string, returnedMilli: number) {
      return db.updateTable('sale_line_lots').set({ returned_milli: returnedMilli }).where('id', '=', id).execute()
    },

    lotsOfLines(lineIds: readonly string[]) {
      if (lineIds.length === 0) return Promise.resolve([])
      return db
        .selectFrom('sale_line_lots as allocation')
        .leftJoin('lots', 'lots.id', 'allocation.lot_id')
        .selectAll('allocation')
        .select(['lots.lot_no', 'lots.expiry_date'])
        .where('allocation.sale_line_id', 'in', lineIds)
        .orderBy('allocation.id')
        .execute()
    },

    linesOf(saleId: string) {
      return db
        .selectFrom('sale_lines as line')
        .innerJoin('product_variants as variant', 'variant.id', 'line.variant_id')
        .selectAll('line')
        .select(['variant.label', 'variant.sku'])
        .where('line.sale_id', '=', saleId)
        .orderBy('line.position')
        .execute()
    },

    insertPayment(payment: Omit<Insertable<SalePaymentsTable>, 'id'>) {
      return db.insertInto('sale_payments').values({ ...payment, id: newId() }).execute()
    },

    paymentsOf(saleId: string) {
      return db.selectFrom('sale_payments').selectAll().where('sale_id', '=', saleId).orderBy('id').execute()
    },

    returnsOf(saleId: string) {
      return db
        .selectFrom('sales')
        .select(['id', 'status'])
        .where('return_of', '=', saleId)
        .where('status', '=', 'posted')
        .execute()
    },

    async page(filter: {
      kind?: string | undefined
      status?: string | undefined
      customerId?: string | undefined
      shiftId?: string | undefined
      search?: string | undefined
      limit: number
      cursor?: string | undefined
    }) {
      const cursor = decodeCursor<TimeCursor>(filter.cursor)

      const rows = await saleHeaderQuery(db)
        .$if(Boolean(filter.kind), (query) => query.where('sale.kind', '=', filter.kind!))
        .$if(Boolean(filter.status), (query) => query.where('sale.status', '=', filter.status!))
        .$if(Boolean(filter.customerId), (query) => query.where('sale.customer_id', '=', filter.customerId!))
        .$if(Boolean(filter.shiftId), (query) => query.where('sale.shift_id', '=', filter.shiftId!))
        .$if(Boolean(filter.search), (query) => query.where('sale.number', 'like', `%${filter.search!.toUpperCase()}%`))
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('sale.created_at', '<', cursor!.at),
              eb.and([eb('sale.created_at', '=', cursor!.at), eb('sale.id', '<', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('sale.created_at', 'desc')
        .orderBy('sale.id', 'desc')
        .limit(filter.limit + 1)
        .execute()

      const page = rows.slice(0, filter.limit)
      const ids = page.map(({ id }) => id)
      const counts =
        ids.length === 0
          ? []
          : await db
              .selectFrom('sale_lines')
              .select(['sale_id', (eb) => eb.fn.countAll<number>().as('count')])
              .where('sale_id', 'in', ids)
              .groupBy('sale_id')
              .execute()

      const lineCounts = new Map(counts.map((row) => [row.sale_id, Number(row.count)]))
      const last = page.at(-1)
      return {
        rows: page,
        lineCounts,
        nextCursor: rows.length > filter.limit && last ? encodeCursor({ at: Number(last.created_at), id: last.id }) : null,
      }
    },

    /** The list price and tax of everything on a sale, which is what the server charges by. */
    async pricing(variantIds: readonly string[]) {
      if (variantIds.length === 0) return new Map<string, { taxRateBp: number; prices: UnitPrice[] }>()

      const [variants, prices] = await Promise.all([
        db
          .selectFrom('product_variants as variant')
          .innerJoin('products as product', 'product.id', 'variant.product_id')
          .leftJoin('tax_rates as tax', 'tax.id', 'product.tax_rate_id')
          .select(['variant.id', 'tax.rate_bp'])
          .where('variant.id', 'in', variantIds)
          .execute(),
        db
          .selectFrom('variant_prices')
          .select(['variant_id', 'unit_id', 'amount_minor'])
          .where('variant_id', 'in', variantIds)
          .where('price_list_id', '=', DEFAULT_PRICE_LIST_ID)
          .execute(),
      ])

      return new Map(
        variants.map((variant) => [
          variant.id,
          {
            taxRateBp: variant.rate_bp ?? 0,
            prices: prices
              .filter(({ variant_id }) => variant_id === variant.id)
              .map(({ unit_id, amount_minor }) => ({ unitId: unit_id, amountMinor: Number(amount_minor) })),
          },
        ]),
      )
    },

    /** A barcode, then a scale label, then a text search: the common case stays the fastest. */
    async posLookup(search: string, warehouseId: string) {
      const code = search.trim()
      const scale = parseScaleBarcode(code)
      const stock = stockRepo(db)

      const exact = await stock.pickVariants(code, warehouseId)
      const rows = exact.length === 0 && scale ? await stock.pickVariants(scale.itemCode, warehouseId) : exact

      const [pricing, flags] = await Promise.all([
        this.pricing(rows.map(({ variantId }) => variantId)),
        rows.length === 0
          ? Promise.resolve([])
          : db
              .selectFrom('products')
              .select(['id', 'prescription_required'])
              .where('id', 'in', rows.map(({ productId }) => productId))
              .execute(),
      ])
      const prescription = new Map(flags.map((row) => [row.id, row.prescription_required === 1]))

      return rows
        .filter(({ variantId }) => pricing.has(variantId))
        .map((row) => ({
          ...row,
          prescriptionRequired: prescription.get(row.productId) ?? false,
          prices: pricing.get(row.variantId)!.prices,
          scaleQtyMilli: exact.length === 0 && scale ? scale.qtyMilli : null,
        }))
    },

    insertHeld(held: Insertable<HeldSalesTable>) {
      return db.insertInto('held_sales').values(held).execute()
    },

    deleteHeld(id: string) {
      return db.deleteFrom('held_sales').where('id', '=', id).execute()
    },

    listHeld() {
      return db.selectFrom('held_sales').selectAll().orderBy('created_at', 'desc').execute()
    },
  }
}

export function shiftsRepo(db: Kysely<Database>) {
  const withUser = () =>
    db
      .selectFrom('shifts')
      .innerJoin('users', 'users.id', 'shifts.user_id')
      .selectAll('shifts')
      .select('users.full_name as user_name')

  return {
    insert(shift: Insertable<ShiftsTable>) {
      return db.insertInto('shifts').values(shift).execute()
    },

    update(id: string, changes: Partial<ShiftRecord>) {
      return db.updateTable('shifts').set(changes).where('id', '=', id).execute()
    },

    find(id: string) {
      return withUser().where('shifts.id', '=', id).executeTakeFirst()
    },

    current() {
      return withUser().where('shifts.status', '=', 'open').executeTakeFirst()
    },

    async page(limit: number, cursorText?: string) {
      const cursor = decodeCursor<TimeCursor>(cursorText)
      const rows = await withUser()
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('shifts.opened_at', '<', cursor!.at),
              eb.and([eb('shifts.opened_at', '=', cursor!.at), eb('shifts.id', '<', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('shifts.opened_at', 'desc')
        .orderBy('shifts.id', 'desc')
        .limit(limit + 1)
        .execute()

      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return {
        rows: page,
        nextCursor: rows.length > limit && last ? encodeCursor({ at: Number(last.opened_at), id: last.id }) : null,
      }
    },

    insertMovement(movement: Omit<Insertable<CashMovementsTable>, 'id'>) {
      return db.insertInto('cash_movements').values({ ...movement, id: newId() }).execute()
    },

    movementsOf(shiftId: string) {
      return db.selectFrom('cash_movements').selectAll().where('shift_id', '=', shiftId).orderBy('occurred_at').orderBy('id').execute()
    },

    /** Every figure on the shift report, read from the trail rather than kept as a counter. */
    async figures(shiftId: string) {
      const [payments, documents] = await Promise.all([
        db
          .selectFrom('sale_payments')
          .select(['method', (eb) => eb.fn.sum<number>('amount_minor').as('amount')])
          .where('shift_id', '=', shiftId)
          .groupBy('method')
          .execute(),
        db
          .selectFrom('sales')
          .select([
            'kind',
            (eb) => eb.fn.countAll<number>().as('count'),
            (eb) => eb.fn.sum<number>('total_minor').as('total'),
            (eb) => eb.fn.sum<number>('tax_minor').as('tax'),
            (eb) => eb.fn.sum<number>('discount_minor').as('discount'),
          ])
          .where('shift_id', '=', shiftId)
          .where('status', '=', 'posted')
          .groupBy('kind')
          .execute(),
      ])
      return {
        byMethod: payments.map(({ method, amount }) => ({ method, amountMinor: Number(amount ?? 0) })),
        documents: documents.map((row) => ({
          kind: row.kind,
          count: Number(row.count),
          totalMinor: Number(row.total ?? 0),
          taxMinor: Number(row.tax ?? 0),
          discountMinor: Number(row.discount ?? 0),
        })),
      }
    },

    /** The cash a drawer should hold, reading each movement rather than trusting a running figure. */
    async expectedCash(shift: Pick<ShiftRecord, 'id' | 'opening_cash_minor'>): Promise<number> {
      const row = await sql<{ amount: number | string | null }>`
        select
          coalesce((select sum(amount_minor) from sale_payments where shift_id = ${shift.id} and method = 'cash'), 0)
          + coalesce((select sum(amount_minor) from cash_movements where shift_id = ${shift.id}), 0) as amount
      `.execute(db)
      return Number(shift.opening_cash_minor) + Number(row.rows[0]?.amount ?? 0)
    },
  }
}

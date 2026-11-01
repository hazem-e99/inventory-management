import { sql, type Kysely } from 'kysely'
import type { Database } from './schema'

interface Range {
  from: string
  to: string
}

interface Page {
  limit: number
  offset: number
}

interface MovementCursor {
  date: string
  at: number
  id: string
}

const toNumber = (value: unknown): number => Number(value ?? 0)

/**
 * Read-only views of the shop's records. Nothing here keeps a figure of its own: every number
 * comes from the documents and ledgers, so a report can't disagree with what happened.
 */
export function reportsRepo(db: Kysely<Database>) {
  return {
    async salesByDay({ from, to }: Range) {
      const rows = await db
        .selectFrom('sales')
        .select([
          'business_date',
          'kind',
          (eb) => eb.fn.countAll<number>().as('documents'),
          (eb) => eb.fn.sum<number>('total_minor').as('total'),
          (eb) => eb.fn.sum<number>('discount_minor').as('discount'),
          (eb) => eb.fn.sum<number>('tax_minor').as('tax'),
          (eb) => eb.fn.sum<number>('cost_minor').as('cost'),
        ])
        .where('business_date', '>=', from)
        .where('business_date', '<=', to)
        .where('status', '=', 'posted')
        .groupBy(['business_date', 'kind'])
        .execute()

      return rows.map((row) => ({
        date: row.business_date,
        kind: row.kind,
        documents: toNumber(row.documents),
        totalMinor: toNumber(row.total),
        discountMinor: toNumber(row.discount),
        taxMinor: toNumber(row.tax),
        costMinor: toNumber(row.cost),
      }))
    },

    async salesByItem({ from, to }: Range) {
      const sold = db
        .selectFrom('sale_lines')
        .select([
          'variant_id',
          'is_return',
          (eb) => eb.fn.sum<number>('base_qty_milli').as('qty'),
          (eb) => eb.fn.sum<number>('total_minor').as('total'),
          (eb) => eb.fn.sum<number>('cost_minor').as('cost'),
        ])
        .where('report_date', '>=', from)
        .where('report_date', '<=', to)
        .groupBy(['variant_id', 'is_return'])
        .as('sold')

      const rows = await db
        .selectFrom(sold)
        .innerJoin('product_variants as variant', 'variant.id', 'sold.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .select(['sold.variant_id', 'variant.product_id', 'product.name', 'variant.label', 'variant.sku', 'sold.is_return', 'sold.qty', 'sold.total', 'sold.cost'])
        .execute()

      const items = new Map<string, { variantId: string; productId: string; name: string; label: string | null; sku: string; qtyMilli: number; salesMinor: number; costMinor: number }>()
      for (const row of rows) {
        const sign = row.is_return === 1 ? -1 : 1
        const item = items.get(row.variant_id) ?? {
          variantId: row.variant_id,
          productId: row.product_id,
          name: row.name,
          label: row.label,
          sku: row.sku,
          qtyMilli: 0,
          salesMinor: 0,
          costMinor: 0,
        }
        item.qtyMilli += sign * toNumber(row.qty)
        item.salesMinor += sign * toNumber(row.total)
        item.costMinor += sign * toNumber(row.cost)
        items.set(row.variant_id, item)
      }
      return [...items.values()].sort((a, b) => b.salesMinor - a.salesMinor || a.name.localeCompare(b.name))
    },

    inventory({ limit, offset }: Page) {
      return db
        .selectFrom('variant_stock as stock')
        .innerJoin('product_variants as variant', 'variant.id', 'stock.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .leftJoin('categories as category', 'category.id', 'product.category_id')
        .select([
          'stock.variant_id',
          'variant.product_id',
          'product.name',
          'variant.label',
          'variant.sku',
          'category.name as category',
          'stock.qty_milli',
          'stock.value_minor',
        ])
        .where('stock.qty_milli', '<>', 0)
        .orderBy('product.name')
        .orderBy('stock.variant_id')
        .limit(limit)
        .offset(offset)
        .execute()
    },

    async inventoryTotals() {
      const row = await db
        .selectFrom('variant_stock')
        .select([(eb) => eb.fn.countAll<number>().as('items'), (eb) => eb.fn.sum<number>('value_minor').as('value')])
        .where('qty_milli', '<>', 0)
        .executeTakeFirstOrThrow()
      return { items: toNumber(row.items), valueMinor: toNumber(row.value) }
    },

    async movements({ from, to }: Range, limit: number, cursor: MovementCursor | null) {
      const rows = await db
        .selectFrom('stock_movements as movement')
        .innerJoin('product_variants as variant', 'variant.id', 'movement.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .innerJoin('warehouses', 'warehouses.id', 'movement.warehouse_id')
        .leftJoin('lots', 'lots.id', 'movement.lot_id')
        .select([
          'movement.id',
          'movement.business_date',
          'movement.occurred_at',
          'variant.product_id',
          'product.name',
          'variant.label',
          'warehouses.name as warehouse',
          'lots.lot_no',
          'movement.document_type',
          'movement.document_id',
          'movement.document_number',
          'movement.reversal_of',
          'movement.qty_milli',
          'movement.value_minor',
        ])
        .where('movement.business_date', '>=', from)
        .where('movement.business_date', '<=', to)
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('movement.business_date', '<', cursor!.date),
              eb.and([
                eb('movement.business_date', '=', cursor!.date),
                eb.or([
                  eb('movement.occurred_at', '<', cursor!.at),
                  eb.and([eb('movement.occurred_at', '=', cursor!.at), eb('movement.id', '<', cursor!.id)]),
                ]),
              ]),
            ]),
          ),
        )
        .orderBy('movement.business_date', 'desc')
        .orderBy('movement.occurred_at', 'desc')
        .orderBy('movement.id', 'desc')
        .limit(limit + 1)
        .execute()

      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return {
        rows: page,
        next: rows.length > limit && last ? { date: last.business_date, at: Number(last.occurred_at), id: last.id } : null,
      }
    },

    async lowStock() {
      const rows = await db
        .selectFrom('product_variants as variant')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .leftJoin('variant_stock as stock', 'stock.variant_id', 'variant.id')
        .select((eb) => [
          'variant.id as variant_id',
          'variant.product_id',
          'product.name',
          'variant.label',
          'variant.cost_minor',
          'variant.reorder_level_milli',
          'product.base_unit_id',
          'stock.qty_milli',
          // The last supplier is the likeliest one to order from again.
          eb
            .selectFrom('purchase_document_lines as bought')
            .innerJoin('purchase_documents as document', 'document.id', 'bought.document_id')
            .innerJoin('suppliers', 'suppliers.id', 'document.supplier_id')
            .select('suppliers.name')
            .whereRef('bought.variant_id', '=', 'variant.id')
            .where('document.status', '=', 'posted')
            .where('document.kind', '=', 'invoice')
            .orderBy('document.posted_at', 'desc')
            .limit(1)
            .as('supplier'),
        ])
        .where('variant.reorder_level_milli', 'is not', null)
        .where('variant.archived_at', 'is', null)
        .where('product.archived_at', 'is', null)
        .where((eb) => eb(eb.fn.coalesce('stock.qty_milli', sql<number>`0`), '<=', eb.ref('variant.reorder_level_milli')))
        .orderBy('product.name')
        .execute()
      return rows
    },

    async countLowStock() {
      const row = await db
        .selectFrom('product_variants as variant')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .leftJoin('variant_stock as stock', 'stock.variant_id', 'variant.id')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('variant.reorder_level_milli', 'is not', null)
        .where('variant.archived_at', 'is', null)
        .where('product.archived_at', 'is', null)
        .where((eb) => eb(eb.fn.coalesce('stock.qty_milli', sql<number>`0`), '<=', eb.ref('variant.reorder_level_milli')))
        .executeTakeFirstOrThrow()
      return toNumber(row.count)
    },

    /** What sold from `since` on, less what came back, so a returned sale doesn't drive an order. */
    async soldSince(variantIds: readonly string[], since: string) {
      if (variantIds.length === 0) return new Map<string, number>()
      const rows = await db
        .selectFrom('sale_lines')
        .select(['variant_id', 'is_return', (eb) => eb.fn.sum<number>('base_qty_milli').as('qty')])
        .where('report_date', '>=', since)
        .where('variant_id', 'in', variantIds)
        .groupBy(['variant_id', 'is_return'])
        .execute()

      const sold = new Map<string, number>()
      for (const row of rows) {
        const signed = (row.is_return === 1 ? -1 : 1) * toNumber(row.qty)
        sold.set(row.variant_id, (sold.get(row.variant_id) ?? 0) + signed)
      }
      return sold
    },

    expiringBy(lastDate: string) {
      return db
        .selectFrom('lots')
        .innerJoin('stock_balances as balance', 'balance.lot_id', 'lots.id')
        .innerJoin('product_variants as variant', 'variant.id', 'lots.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .innerJoin('warehouses', 'warehouses.id', 'balance.warehouse_id')
        .select([
          'lots.id',
          'variant.product_id',
          'product.name',
          'variant.label',
          'lots.lot_no',
          'lots.expiry_date',
          'warehouses.name as warehouse',
          'balance.qty_milli',
        ])
        .where('balance.qty_milli', '>', 0)
        .where('lots.expiry_date', 'is not', null)
        .where('lots.expiry_date', '<=', lastDate)
        .orderBy('lots.expiry_date')
        .orderBy('product.name')
        .execute()
    },

    async countExpiring(today: string, lastDate: string) {
      const row = await db
        .selectFrom('lots')
        .innerJoin('stock_balances as balance', 'balance.lot_id', 'lots.id')
        .select([
          (eb) => eb.fn.count<number>('lots.id').distinct().filterWhere('lots.expiry_date', '<', today).as('expired'),
          (eb) => eb.fn.count<number>('lots.id').distinct().filterWhere('lots.expiry_date', '>=', today).as('near'),
        ])
        .where('balance.qty_milli', '>', 0)
        .where('lots.expiry_date', 'is not', null)
        .where('lots.expiry_date', '<=', lastDate)
        .executeTakeFirstOrThrow()
      return { expired: toNumber(row.expired), nearExpiry: toNumber(row.near) }
    },

    /** Stock on the shelf that hasn't sold since `cutoff`, costliest first. */
    async deadStock(cutoff: string, { limit, offset }: Page) {
      const recent = db
        .selectFrom('sale_lines')
        .select('variant_id')
        .distinct()
        .where('report_date', '>=', cutoff)
        .where('is_return', '=', 0)
        .as('recent')

      const rows = await db
        .selectFrom('variant_stock as stock')
        .innerJoin('product_variants as variant', 'variant.id', 'stock.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .leftJoin(recent, 'recent.variant_id', 'stock.variant_id')
        .select(['stock.variant_id', 'variant.product_id', 'product.name', 'variant.label', 'stock.qty_milli', 'stock.value_minor'])
        .where('stock.qty_milli', '>', 0)
        .where('recent.variant_id', 'is', null)
        .where('variant.created_at', '<', Date.parse(`${cutoff}T00:00:00Z`))
        .orderBy('stock.value_minor', 'desc')
        .orderBy('stock.variant_id')
        .limit(limit)
        .offset(offset)
        .execute()

      const ids = rows.map(({ variant_id }) => variant_id)
      const last =
        ids.length === 0
          ? []
          : await db
              .selectFrom('sale_lines')
              .select(['variant_id', (eb) => eb.fn.max('report_date').as('last')])
              .where('variant_id', 'in', ids)
              .where('report_date', 'is not', null)
              .where('is_return', '=', 0)
              .groupBy('variant_id')
              .execute()

      const lastSold = new Map(last.map((row) => [row.variant_id, row.last]))
      return rows.map((row) => ({ ...row, last_sold: lastSold.get(row.variant_id) ?? null }))
    },

    async suppliers({ from, to }: Range) {
      const [entries, parties] = await Promise.all([
        db
          .selectFrom('supplier_ledger')
          .select(['supplier_id', 'source', (eb) => eb.fn.sum<number>('amount_minor').as('amount')])
          .where('business_date', '>=', from)
          .where('business_date', '<=', to)
          .groupBy(['supplier_id', 'source'])
          .execute(),
        db.selectFrom('suppliers').select(['id', 'name', 'balance_minor']).orderBy('name').execute(),
      ])

      const amount = (id: string, source: string) =>
        toNumber(entries.find((row) => row.supplier_id === id && row.source === source)?.amount)

      return parties.map((party) => ({
        id: party.id,
        name: party.name,
        purchasesMinor: amount(party.id, 'purchase'),
        returnsMinor: -amount(party.id, 'purchase_return'),
        paidMinor: -amount(party.id, 'payment'),
        balanceMinor: Number(party.balance_minor),
      }))
    },

    async customers({ from, to }: Range) {
      const [entries, parties] = await Promise.all([
        db
          .selectFrom('customer_ledger')
          .select(['customer_id', 'source', (eb) => eb.fn.sum<number>('amount_minor').as('amount')])
          .where('business_date', '>=', from)
          .where('business_date', '<=', to)
          .groupBy(['customer_id', 'source'])
          .execute(),
        db.selectFrom('customers').select(['id', 'name', 'balance_minor']).orderBy('name').execute(),
      ])

      const amount = (id: string, source: string) =>
        toNumber(entries.find((row) => row.customer_id === id && row.source === source)?.amount)

      return parties.map((party) => ({
        id: party.id,
        name: party.name,
        salesMinor: amount(party.id, 'sale'),
        returnsMinor: -amount(party.id, 'sale_return'),
        collectedMinor: -amount(party.id, 'receipt'),
        balanceMinor: Number(party.balance_minor),
      }))
    },

    async shifts({ from, to }: Range) {
      const start = Date.parse(`${from}T00:00:00Z`)
      const end = Date.parse(`${to}T23:59:59.999Z`)

      const shifts = await db
        .selectFrom('shifts')
        .innerJoin('users', 'users.id', 'shifts.user_id')
        .selectAll('shifts')
        .select('users.full_name as cashier')
        .where('shifts.opened_at', '>=', start)
        .where('shifts.opened_at', '<=', end)
        .orderBy('shifts.opened_at', 'desc')
        .execute()

      const ids = shifts.map(({ id }) => id)
      const totals =
        ids.length === 0
          ? []
          : await db
              .selectFrom('sales')
              .select(['shift_id', 'kind', (eb) => eb.fn.sum<number>('total_minor').as('total')])
              .where('status', '=', 'posted')
              .where('shift_id', 'in', ids)
              .groupBy(['shift_id', 'kind'])
              .execute()

      const total = (id: string, kind: string) => toNumber(totals.find((row) => row.shift_id === id && row.kind === kind)?.total)

      return shifts.map((shift) => ({ ...shift, salesMinor: total(shift.id, 'sale'), returnsMinor: total(shift.id, 'return') }))
    },
  }
}

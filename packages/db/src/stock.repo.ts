import { searchTerms } from '@inv/domain'
import type { Insertable, Kysely, Selectable } from 'kysely'
import { newId } from './ids'
import type { Database, StockDocumentLinesTable, StockDocumentsTable } from './schema'
import { productSearchFilter, searchIndexPage, usesSearchIndex } from './search'

export type StockDocumentRecord = Selectable<StockDocumentsTable>
export type StockLineRecord = Selectable<StockDocumentLinesTable>

export interface VariantRule {
  productName: string
  baseUnitId: string
  trackLots: boolean
  trackSerials: boolean
  allowsFraction: boolean
  costMinor: number
  onHandMilli: number
  valueMinor: number
  /** Larger units of this product, in thousandths of its base unit. */
  factors: Map<string, number>
}

const PICK_LIMIT = 20

interface Cursor {
  at: number
  id: string
}

const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url')

function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor
  } catch {
    return null
  }
}

export function stockRepo(db: Kysely<Database>) {
  return {
    insertDocument(document: Insertable<StockDocumentsTable>) {
      return db.insertInto('stock_documents').values(document).execute()
    },

    updateDocument(id: string, changes: Partial<StockDocumentRecord>) {
      return db.updateTable('stock_documents').set(changes).where('id', '=', id).execute()
    },

    deleteDocument(id: string) {
      return db.deleteFrom('stock_documents').where('id', '=', id).execute()
    },

    findDocument(id: string): Promise<StockDocumentRecord | undefined> {
      return db.selectFrom('stock_documents').selectAll().where('id', '=', id).executeTakeFirst()
    },

    async replaceLines(documentId: string, lines: ReadonlyArray<Omit<StockLineRecord, 'id' | 'document_id' | 'position'>>) {
      await db.deleteFrom('stock_document_lines').where('document_id', '=', documentId).execute()
      if (lines.length === 0) return
      await db
        .insertInto('stock_document_lines')
        .values(lines.map((line, position) => ({ ...line, id: newId(), document_id: documentId, position })))
        .execute()
    },

    updateLine(id: string, changes: Partial<StockLineRecord>) {
      return db.updateTable('stock_document_lines').set(changes).where('id', '=', id).execute()
    },

    linesOf(documentId: string) {
      return db
        .selectFrom('stock_document_lines as line')
        .innerJoin('product_variants as variant', 'variant.id', 'line.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .leftJoin('lots as lot', 'lot.id', 'line.lot_id')
        .select([
          'line.id',
          'line.variant_id',
          'line.unit_id',
          'line.qty_milli',
          'line.lot_id',
          'line.lot_no',
          'line.expiry_date',
          'line.unit_cost_minor',
          'line.expected_milli',
          'variant.label',
          'variant.sku',
          'variant.cost_minor',
          'product.id as product_id',
          'product.name as product_name',
          'product.base_unit_id',
          'product.track_lots',
          'lot.lot_no as resolved_lot_no',
          'lot.expiry_date as resolved_expiry_date',
        ])
        .where('line.document_id', '=', documentId)
        .orderBy('line.position')
        .execute()
    },

    async pageDocuments(filter: { kind?: string | undefined; status?: string | undefined; limit: number; cursor?: string | undefined }) {
      const cursor = decodeCursor(filter.cursor)

      const rows = await db
        .selectFrom('stock_documents as document')
        .leftJoin('users', 'users.id', 'document.created_by')
        .selectAll('document')
        .select((eb) => [
          'users.full_name as created_by_name',
          eb
            .selectFrom('stock_document_lines')
            .select((inner) => inner.fn.countAll().as('count'))
            .whereRef('stock_document_lines.document_id', '=', 'document.id')
            .as('line_count'),
        ])
        .$if(Boolean(filter.kind), (query) => query.where('document.kind', '=', filter.kind!))
        .$if(Boolean(filter.status), (query) => query.where('document.status', '=', filter.status!))
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

      const pageRows = rows.slice(0, filter.limit)
      const last = pageRows.at(-1)
      return {
        rows: pageRows,
        nextCursor:
          rows.length > filter.limit && last ? encodeCursor({ at: Number(last.created_at), id: last.id }) : null,
      }
    },

    /** Reuses a lot by number, so two receipts of one batch stay a single lot. */
    async resolveLot(variantId: string, lotNo: string, expiryDate: string | null, now: number) {
      const existing = await db
        .selectFrom('lots')
        .selectAll()
        .where('variant_id', '=', variantId)
        .where('lot_no', '=', lotNo)
        .executeTakeFirst()

      if (existing) {
        return { id: existing.id, conflict: expiryDate !== null && existing.expiry_date !== expiryDate }
      }

      const id = newId()
      await db
        .insertInto('lots')
        .values({ id, variant_id: variantId, lot_no: lotNo, expiry_date: expiryDate, created_at: now })
        .execute()
      return { id, conflict: false }
    },

    async lotsInWarehouse(variantId: string, warehouseId: string) {
      const rows = await db
        .selectFrom('lots')
        .leftJoin('stock_balances as balance', (join) =>
          join.onRef('balance.lot_id', '=', 'lots.id').on('balance.warehouse_id', '=', warehouseId),
        )
        .select(['lots.id', 'lots.lot_no', 'lots.expiry_date', 'lots.created_at', 'balance.qty_milli'])
        .where('lots.variant_id', '=', variantId)
        .execute()

      return rows.map((row) => ({
        lotId: row.id,
        lotNo: row.lot_no,
        expiryDate: row.expiry_date,
        createdAt: Number(row.created_at),
        availableMilli: Number(row.qty_milli ?? 0),
      }))
    },

    async balanceOf(variantId: string, warehouseId: string, lotId: string | null): Promise<number> {
      const row = await db
        .selectFrom('stock_balances')
        .select('qty_milli')
        .where('variant_id', '=', variantId)
        .where('warehouse_id', '=', warehouseId)
        .where('lot_key', '=', lotId ?? '')
        .executeTakeFirst()
      return Number(row?.qty_milli ?? 0)
    },

    /** Everything posting needs to know about a set of variants, loaded in one go. */
    async variantRules(variantIds: readonly string[]): Promise<Map<string, VariantRule>> {
      if (variantIds.length === 0) return new Map()

      const rows = await db
        .selectFrom('product_variants as variant')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .innerJoin('units', 'units.id', 'product.base_unit_id')
        .leftJoin('variant_stock as stock', 'stock.variant_id', 'variant.id')
        .select([
          'variant.id',
          'variant.cost_minor',
          'product.id as product_id',
          'product.name',
          'product.base_unit_id',
          'product.track_lots',
          'product.track_serials',
          'units.allows_fraction',
          'stock.qty_milli',
          'stock.value_minor',
        ])
        .where('variant.id', 'in', variantIds)
        .execute()

      const conversions = await db
        .selectFrom('unit_conversions')
        .select(['product_id', 'unit_id', 'factor_milli'])
        .where('product_id', 'in', [...new Set(rows.map((row) => row.product_id))])
        .execute()

      return new Map(
        rows.map((row) => [
          row.id,
          {
            productName: row.name,
            baseUnitId: row.base_unit_id,
            trackLots: row.track_lots === 1,
            trackSerials: row.track_serials === 1,
            allowsFraction: row.allows_fraction === 1,
            costMinor: Number(row.cost_minor),
            onHandMilli: Number(row.qty_milli ?? 0),
            valueMinor: Number(row.value_minor ?? 0),
            factors: new Map(
              conversions
                .filter(({ product_id }) => product_id === row.product_id)
                .map(({ unit_id, factor_milli }) => [unit_id, Number(factor_milli)]),
            ),
          },
        ]),
      )
    },

    /** The picker behind a document line: a scanned barcode first, then a text search. */
    async pickVariants(search: string, warehouseId: string) {
      const text = search.trim()
      const scanned = text
        ? await db.selectFrom('barcodes').select(['variant_id', 'unit_id']).where('code', '=', text).executeTakeFirst()
        : undefined

      const variantIds = scanned ? [scanned.variant_id] : await searchVariantIds(db, text)
      if (variantIds.length === 0) return []

      const rows = await db
        .selectFrom('product_variants as variant')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .innerJoin('units', 'units.id', 'product.base_unit_id')
        .leftJoin('variant_stock as stock', 'stock.variant_id', 'variant.id')
        .leftJoin('tax_rates as tax', 'tax.id', 'product.tax_rate_id')
        .select([
          'variant.id',
          'variant.label',
          'variant.sku',
          'variant.cost_minor',
          'product.id as product_id',
          'product.name',
          'product.base_unit_id',
          'product.track_lots',
          'product.track_serials',
          'tax.rate_bp',
          'units.allows_fraction',
          'stock.qty_milli',
        ])
        .where('variant.id', 'in', variantIds)
        .orderBy('product.name')
        .orderBy('variant.id')
        .execute()

      const [conversions, lots] = await Promise.all([
        db
          .selectFrom('unit_conversions')
          .select(['product_id', 'unit_id', 'factor_milli'])
          .where('product_id', 'in', [...new Set(rows.map((row) => row.product_id))])
          .execute(),
        db
          .selectFrom('lots')
          .leftJoin('stock_balances as balance', (join) =>
            join.onRef('balance.lot_id', '=', 'lots.id').on('balance.warehouse_id', '=', warehouseId),
          )
          .select(['lots.id', 'lots.variant_id', 'lots.lot_no', 'lots.expiry_date', 'balance.qty_milli'])
          .where('lots.variant_id', 'in', variantIds)
          .orderBy('lots.expiry_date')
          .execute(),
      ])

      return rows.map((row) => ({
        variantId: row.id,
        productId: row.product_id,
        productName: row.name,
        variantLabel: row.label,
        sku: row.sku,
        baseUnitId: row.base_unit_id,
        unitId: scanned?.variant_id === row.id ? scanned.unit_id : row.base_unit_id,
        allowsFraction: row.allows_fraction === 1,
        trackLots: row.track_lots === 1,
        trackSerials: row.track_serials === 1,
        taxRateBp: row.rate_bp ?? 0,
        onHandMilli: Number(row.qty_milli ?? 0),
        costMinor: Number(row.cost_minor),
        units: conversions
          .filter(({ product_id }) => product_id === row.product_id)
          .map(({ unit_id, factor_milli }) => ({ unitId: unit_id, factorMilli: Number(factor_milli) })),
        lots: lots
          .filter(({ variant_id }) => variant_id === row.id)
          .map((lot) => ({
            lotId: lot.id,
            lotNo: lot.lot_no,
            expiryDate: lot.expiry_date,
            availableMilli: Number(lot.qty_milli ?? 0),
          })),
      }))
    },

    async productStock(productId: string) {
      const product = await db.selectFrom('products').select(['id', 'name', 'base_unit_id']).where('id', '=', productId).executeTakeFirst()
      if (!product) return null

      const variants = await db
        .selectFrom('product_variants as variant')
        .leftJoin('variant_stock as stock', 'stock.variant_id', 'variant.id')
        .select(['variant.id', 'variant.label', 'variant.sku', 'stock.qty_milli', 'stock.value_minor'])
        .where('variant.product_id', '=', productId)
        .where('variant.archived_at', 'is', null)
        .orderBy('variant.is_default', 'desc')
        .orderBy('variant.id')
        .execute()

      const balances = await db
        .selectFrom('stock_balances as balance')
        .innerJoin('warehouses', 'warehouses.id', 'balance.warehouse_id')
        .innerJoin('product_variants as variant', 'variant.id', 'balance.variant_id')
        .leftJoin('lots', 'lots.id', 'balance.lot_id')
        .select([
          'balance.variant_id',
          'balance.warehouse_id',
          'balance.lot_id',
          'balance.qty_milli',
          'warehouses.name as warehouse_name',
          'lots.lot_no',
          'lots.expiry_date',
        ])
        .where('variant.product_id', '=', productId)
        .where('balance.qty_milli', '<>', 0)
        .orderBy('lots.expiry_date')
        .execute()

      return { product, variants, balances }
    },

    async movementPage(productId: string, limit: number, cursorText?: string) {
      const cursor = decodeCursor(cursorText)

      const rows = await db
        .selectFrom('stock_movements as movement')
        .innerJoin('product_variants as variant', 'variant.id', 'movement.variant_id')
        .innerJoin('warehouses', 'warehouses.id', 'movement.warehouse_id')
        .leftJoin('lots', 'lots.id', 'movement.lot_id')
        .leftJoin('users', 'users.id', 'movement.actor_id')
        .select([
          'movement.id',
          'movement.occurred_at',
          'movement.qty_milli',
          'movement.value_minor',
          'movement.document_id',
          'movement.document_type',
          'movement.document_number',
          'movement.reversal_of',
          'variant.label',
          'warehouses.name as warehouse_name',
          'lots.lot_no',
          'users.full_name',
        ])
        .where('variant.product_id', '=', productId)
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('movement.occurred_at', '<', cursor!.at),
              eb.and([eb('movement.occurred_at', '=', cursor!.at), eb('movement.id', '<', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('movement.occurred_at', 'desc')
        .orderBy('movement.id', 'desc')
        .limit(limit + 1)
        .execute()

      const pageRows = rows.slice(0, limit)
      const last = pageRows.at(-1)
      return {
        rows: pageRows,
        nextCursor: rows.length > limit && last ? encodeCursor({ at: Number(last.occurred_at), id: last.id }) : null,
      }
    },

    /** Starting lines for a count: everything the system believes is on that shelf. */
    countSheet(warehouseId: string, categoryId: string | null | undefined) {
      return db
        .selectFrom('stock_balances as balance')
        .innerJoin('product_variants as variant', 'variant.id', 'balance.variant_id')
        .innerJoin('products as product', 'product.id', 'variant.product_id')
        .select(['balance.variant_id', 'balance.lot_id', 'balance.qty_milli', 'product.base_unit_id'])
        .where('balance.warehouse_id', '=', warehouseId)
        .where('balance.qty_milli', '<>', 0)
        .where('product.archived_at', 'is', null)
        .$if(Boolean(categoryId), (query) => query.where('product.category_id', '=', categoryId!))
        .orderBy('product.name')
        .orderBy('variant.id')
        .execute()
    },
  }
}

async function searchVariantIds(db: Kysely<Database>, text: string): Promise<string[]> {
  const terms = searchTerms(text)

  const productIds = async (): Promise<string[]> => {
    if (terms.length > 0 && usesSearchIndex(db, false)) {
      const hits = await searchIndexPage(db, terms, 0, PICK_LIMIT)
      return hits.map(({ productId }) => productId)
    }
    const filter = terms.length > 0 ? productSearchFilter(db, terms, false) : null
    const rows = await db
      .selectFrom('products')
      .select('id')
      .where('archived_at', 'is', null)
      .$if(filter !== null, (query) => query.where((eb) => filter!(eb)))
      .orderBy('name')
      .orderBy('id')
      .limit(PICK_LIMIT)
      .execute()
    return rows.map(({ id }) => id)
  }

  const ids = await productIds()
  if (ids.length === 0) return []

  const rows = await db
    .selectFrom('product_variants')
    .select('id')
    .where('product_id', 'in', ids)
    .where('archived_at', 'is', null)
    .limit(PICK_LIMIT)
    .execute()
  return rows.map(({ id }) => id)
}

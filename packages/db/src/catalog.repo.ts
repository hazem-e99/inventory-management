import type { ExpressionBuilder, Kysely, Selectable } from 'kysely'
import type {
  Database,
  ProductsTable,
  ProductVariantsTable,
  UnitConversionsTable,
  VariantPricesTable,
} from './schema'
import {
  indexNewProduct,
  productSearchFilter,
  reindexProduct,
  removeFromSearch,
  searchIndexCount,
  searchIndexPage,
  usesSearchIndex,
} from './search'

export const DEFAULT_PRICE_LIST_ID = 'retail'

export type ProductRecord = Selectable<ProductsTable>
export type VariantRecord = Selectable<ProductVariantsTable>

export interface ProductListFilter {
  terms: string[]
  categoryId?: string | undefined
  brandId?: string | undefined
  archived: boolean
  limit: number
  cursor?: string | undefined
}

export interface ProductListRow {
  id: string
  name: string
  genericName: string | null
  categoryName: string | null
  brandName: string | null
  sku: string | null
  barcode: string | null
  priceMinor: number | null
  variantCount: number
  onHandMilli: number
  archived: boolean
}

type Cursor = { name: string; id: string } | { hit: number }

const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url')

function decodeCursor(cursor: string): Cursor | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor
  } catch {
    return null
  }
}

export function catalogRepo(db: Kysely<Database>) {
  return {
    insertProduct(product: Omit<ProductRecord, 'archived_at'>) {
      return db.insertInto('products').values({ ...product, archived_at: null }).execute()
    },

    updateProduct(id: string, changes: Partial<ProductRecord>) {
      return db.updateTable('products').set(changes).where('id', '=', id).execute()
    },

    insertVariant(variant: Omit<VariantRecord, 'archived_at'>) {
      return db.insertInto('product_variants').values({ ...variant, archived_at: null }).execute()
    },

    updateVariant(id: string, changes: Partial<VariantRecord>) {
      return db.updateTable('product_variants').set(changes).where('id', '=', id).execute()
    },

    archiveMissingVariants(productId: string, keep: readonly string[], now: number) {
      return db
        .updateTable('product_variants')
        .set({ archived_at: now, updated_at: now })
        .where('product_id', '=', productId)
        .where('archived_at', 'is', null)
        .$if(keep.length > 0, (query) => query.where('id', 'not in', keep))
        .execute()
    },

    async replaceConversions(productId: string, conversions: ReadonlyArray<Omit<UnitConversionsTable, 'product_id'>>) {
      await db.deleteFrom('unit_conversions').where('product_id', '=', productId).execute()
      if (conversions.length === 0) return
      await db
        .insertInto('unit_conversions')
        .values(conversions.map((conversion) => ({ ...conversion, product_id: productId })))
        .execute()
    },

    async replaceBarcodes(variantId: string, barcodes: ReadonlyArray<{ code: string; unitId: string }>, now: number) {
      await db.deleteFrom('barcodes').where('variant_id', '=', variantId).execute()
      if (barcodes.length === 0) return
      await db
        .insertInto('barcodes')
        .values(barcodes.map(({ code, unitId }) => ({ code, variant_id: variantId, unit_id: unitId, created_at: now })))
        .execute()
    },

    async replacePrices(variantId: string, prices: ReadonlyArray<Omit<VariantPricesTable, 'variant_id'>>) {
      await db.deleteFrom('variant_prices').where('variant_id', '=', variantId).execute()
      if (prices.length === 0) return
      await db
        .insertInto('variant_prices')
        .values(prices.map((price) => ({ ...price, variant_id: variantId })))
        .execute()
    },

    async replaceAttributeValues(variantId: string, valueIds: readonly string[]) {
      await db.deleteFrom('variant_attribute_values').where('variant_id', '=', variantId).execute()
      if (valueIds.length === 0) return
      await db
        .insertInto('variant_attribute_values')
        .values(valueIds.map((value_id) => ({ variant_id: variantId, value_id })))
        .execute()
    },

    indexNewProduct: (productId: string, text: string) => indexNewProduct(db, productId, text),

    reindexProduct: (productId: string, text: string) => reindexProduct(db, productId, text),

    removeFromSearch: (productId: string) => removeFromSearch(db, productId),

    findProduct(id: string): Promise<ProductRecord | undefined> {
      return db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirst()
    },

    async loadProduct(id: string) {
      const product = await db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirst()
      if (!product) return null

      const variants = await db
        .selectFrom('product_variants')
        .selectAll()
        .where('product_id', '=', id)
        .where('archived_at', 'is', null)
        .orderBy('is_default', 'desc')
        .orderBy('created_at')
        .orderBy('id')
        .execute()
      const variantIds = variants.map((variant) => variant.id)

      const [conversions, barcodes, prices, attributeValues] = await Promise.all([
        db.selectFrom('unit_conversions').selectAll().where('product_id', '=', id).execute(),
        variantIds.length === 0
          ? []
          : db.selectFrom('barcodes').selectAll().where('variant_id', 'in', variantIds).orderBy('created_at').orderBy('code').execute(),
        variantIds.length === 0
          ? []
          : db.selectFrom('variant_prices').selectAll().where('variant_id', 'in', variantIds).execute(),
        variantIds.length === 0
          ? []
          : db.selectFrom('variant_attribute_values').selectAll().where('variant_id', 'in', variantIds).execute(),
      ])

      return { product, variants, conversions, barcodes, prices, attributeValues }
    },

    async listProducts(filter: ProductListFilter) {
      if (leadsWithIndex(db, filter)) return listFromIndex(db, filter)

      const conditions = buildListFilter(db, filter)
      const decoded = filter.cursor ? decodeCursor(filter.cursor) : null
      const cursor = decoded && 'name' in decoded ? decoded : null

      const rows = await productRows(db)
        .where(conditions)
        .$if(cursor !== null, (query) =>
          query.where((eb) =>
            eb.or([
              eb('products.name', '>', cursor!.name),
              eb.and([eb('products.name', '=', cursor!.name), eb('products.id', '>', cursor!.id)]),
            ]),
          ),
        )
        .orderBy('products.name')
        .orderBy('products.id')
        .limit(filter.limit + 1)
        .execute()

      const pageRows = rows.slice(0, filter.limit)
      const last = pageRows.at(-1)
      return {
        items: pageRows.map(toListRow),
        nextCursor: rows.length > filter.limit && last ? encodeCursor({ name: last.name, id: last.id }) : null,
      }
    },

    async countProducts(filter: Omit<ProductListFilter, 'limit' | 'cursor'>): Promise<number> {
      if (leadsWithIndex(db, filter)) return searchIndexCount(db, filter.terms)

      const row = await db
        .selectFrom('products')
        .select((eb) => eb.fn.countAll().as('count'))
        .where(buildListFilter(db, filter))
        .executeTakeFirstOrThrow()
      return Number(row.count)
    },

    async existingCodes(codes: readonly string[]): Promise<Set<string>> {
      if (codes.length === 0) return new Set()
      const rows = await db.selectFrom('barcodes').select('code').where('code', 'in', codes).execute()
      return new Set(rows.map((row) => row.code))
    },

    async existingSkus(skus: readonly string[]): Promise<Set<string>> {
      if (skus.length === 0) return new Set()
      const rows = await db.selectFrom('product_variants').select('sku').where('sku', 'in', skus).execute()
      return new Set(rows.map((row) => row.sku))
    },

    async findByBarcode(code: string) {
      return db
        .selectFrom('barcodes')
        .innerJoin('product_variants', 'product_variants.id', 'barcodes.variant_id')
        .select(['barcodes.code', 'barcodes.unit_id', 'product_variants.id as variant_id', 'product_variants.product_id'])
        .where('barcodes.code', '=', code)
        .executeTakeFirst()
    },

    /** Everything needed to print labels, and to refresh a product's search text. */
    async variantCodes(productId: string) {
      return db
        .selectFrom('product_variants')
        .leftJoin('barcodes', 'barcodes.variant_id', 'product_variants.id')
        .select(['product_variants.id', 'product_variants.sku', 'product_variants.label', 'barcodes.code'])
        .where('product_variants.product_id', '=', productId)
        .where('product_variants.archived_at', 'is', null)
        .execute()
    },

    async exportRows(limit: number) {
      const rows = await db
        .selectFrom('products')
        .leftJoin('categories', 'categories.id', 'products.category_id')
        .leftJoin('brands', 'brands.id', 'products.brand_id')
        .innerJoin('product_variants as main', (join) =>
          join.onRef('main.product_id', '=', 'products.id').on('main.is_default', '=', 1),
        )
        .innerJoin('units', 'units.id', 'products.base_unit_id')
        .select((eb) => [
          'products.name',
          'products.name_en',
          'products.generic_name',
          'categories.name as category_name',
          'brands.name as brand_name',
          'units.name as unit_name',
          'main.sku',
          'main.cost_minor',
          eb
            .selectFrom('barcodes')
            .select('barcodes.code')
            .whereRef('barcodes.variant_id', '=', 'main.id')
            .orderBy('barcodes.created_at')
            .orderBy('barcodes.code')
            .limit(1)
            .as('barcode'),
          eb
            .selectFrom('variant_prices')
            .select('variant_prices.amount_minor')
            .whereRef('variant_prices.variant_id', '=', 'main.id')
            .whereRef('variant_prices.unit_id', '=', 'products.base_unit_id')
            .where('variant_prices.price_list_id', '=', DEFAULT_PRICE_LIST_ID)
            .limit(1)
            .as('price_minor'),
        ])
        .where('products.archived_at', 'is', null)
        .orderBy('products.name')
        .orderBy('products.id')
        .limit(limit)
        .execute()
      return rows
    },
  }
}

function productRows(db: Kysely<Database>) {
  return db
    .selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('brands', 'brands.id', 'products.brand_id')
    .leftJoin('product_variants as main', (join) =>
      join.onRef('main.product_id', '=', 'products.id').on('main.is_default', '=', 1),
    )
    .select((eb) => [
      'products.id',
      'products.name',
      'products.generic_name',
      'products.archived_at',
      'categories.name as category_name',
      'brands.name as brand_name',
      'main.sku',
      eb
        .selectFrom('barcodes')
        .select('barcodes.code')
        .whereRef('barcodes.variant_id', '=', 'main.id')
        .orderBy('barcodes.created_at')
        .orderBy('barcodes.code')
        .limit(1)
        .as('barcode'),
      eb
        .selectFrom('variant_prices')
        .select('variant_prices.amount_minor')
        .whereRef('variant_prices.variant_id', '=', 'main.id')
        .whereRef('variant_prices.unit_id', '=', 'products.base_unit_id')
        .where('variant_prices.price_list_id', '=', DEFAULT_PRICE_LIST_ID)
        .limit(1)
        .as('price_minor'),
      eb
        .selectFrom('product_variants as counted')
        .select((inner) => inner.fn.countAll().as('count'))
        .whereRef('counted.product_id', '=', 'products.id')
        .where('counted.archived_at', 'is', null)
        .as('variant_count'),
      eb
        .selectFrom('variant_stock')
        .innerJoin('product_variants as owned', 'owned.id', 'variant_stock.variant_id')
        .select((inner) => inner.fn.sum<number>('variant_stock.qty_milli').as('total'))
        .whereRef('owned.product_id', '=', 'products.id')
        .as('on_hand_milli'),
    ])
}

type RawListRow = Awaited<ReturnType<ReturnType<typeof productRows>['execute']>>[number]

function toListRow(row: RawListRow): ProductListRow {
  return {
    id: row.id,
    name: row.name,
    genericName: row.generic_name,
    categoryName: row.category_name,
    brandName: row.brand_name,
    sku: row.sku,
    barcode: row.barcode,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    variantCount: Number(row.variant_count),
    onHandMilli: Number(row.on_hand_milli ?? 0),
    archived: row.archived_at !== null,
  }
}

type ListScope = Pick<ProductListFilter, 'terms' | 'categoryId' | 'brandId' | 'archived'>

/** A plain text search can run on the index alone; extra filters need the products table. */
function leadsWithIndex(db: Kysely<Database>, filter: ListScope): boolean {
  return filter.terms.length > 0 && !filter.categoryId && !filter.brandId && usesSearchIndex(db, filter.archived)
}

/** Pages in index order, so the cost depends on the page size, not on how many items match. */
async function listFromIndex(db: Kysely<Database>, filter: ProductListFilter) {
  const decoded = filter.cursor ? decodeCursor(filter.cursor) : null
  const afterHit = decoded && 'hit' in decoded ? decoded.hit : 0
  const hits = await searchIndexPage(db, filter.terms, afterHit, filter.limit + 1)
  const pageHits = hits.slice(0, filter.limit)
  if (pageHits.length === 0) return { items: [], nextCursor: null }

  const rows = await productRows(db)
    .where('products.id', 'in', pageHits.map(({ productId }) => productId))
    .execute()
  const byId = new Map(rows.map((row) => [row.id, row]))
  const last = pageHits.at(-1)

  return {
    items: pageHits.flatMap(({ productId }) => {
      const row = byId.get(productId)
      return row ? [toListRow(row)] : []
    }),
    nextCursor: hits.length > filter.limit && last ? encodeCursor({ hit: last.hit }) : null,
  }
}

function buildListFilter(db: Kysely<Database>, filter: ListScope) {
  const search = filter.terms.length > 0 ? productSearchFilter(db, filter.terms, filter.archived) : null

  return (eb: ExpressionBuilder<Database, 'products'>) =>
    eb.and([
      filter.archived ? eb('products.archived_at', 'is not', null) : eb('products.archived_at', 'is', null),
      ...(filter.categoryId ? [eb('products.category_id', '=', filter.categoryId)] : []),
      ...(filter.brandId ? [eb('products.brand_id', '=', filter.brandId)] : []),
      ...(search ? [search(eb)] : []),
    ])
}

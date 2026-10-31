import { sql, type Kysely } from 'kysely'
import { isSqlite } from '../dialect'

const SYSTEM_UNITS: Array<[string, boolean]> = [
  ['piece', false],
  ['box', false],
  ['strip', false],
  ['carton', false],
  ['bottle', false],
  ['kilogram', true],
  ['gram', true],
  ['liter', true],
  ['meter', true],
]

const SYSTEM_ATTRIBUTES = ['size', 'color']

const ROLE_GRANTS: Array<[string, string]> = [
  ['manager', 'catalog.view'],
  ['manager', 'catalog.manage'],
  ['manager', 'catalog.import'],
  ['storekeeper', 'catalog.view'],
  ['storekeeper', 'catalog.manage'],
  ['storekeeper', 'catalog.import'],
  ['cashier', 'catalog.view'],
]

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('document_sequences')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('last_value', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('categories')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('parent_id', 'text', (col) => col.references('categories.id').onDelete('restrict'))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  // A plain UNIQUE treats NULL parents as distinct, which would allow two top-level twins.
  await db.schema
    .createIndex('categories_parent_name_key')
    .on('categories')
    .unique()
    .expression(sql`coalesce(parent_id, ''), name`)
    .execute()

  for (const table of ['brands', 'price_lists']) {
    await db.schema
      .createTable(table)
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull().unique())
      .addColumn('is_system', 'integer', (col) => col.notNull().defaultTo(0).check(sql`is_system in (0, 1)`))
      .addColumn('archived_at', 'bigint')
      .addColumn('created_at', 'bigint', (col) => col.notNull())
      .execute()
  }

  await db.schema
    .createTable('units')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('allows_fraction', 'integer', (col) => col.notNull().defaultTo(0).check(sql`allows_fraction in (0, 1)`))
    .addColumn('is_system', 'integer', (col) => col.notNull().defaultTo(0).check(sql`is_system in (0, 1)`))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('tax_rates')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('rate_bp', 'integer', (col) => col.notNull().check(sql`rate_bp between 0 and 10000`))
    .addColumn('is_system', 'integer', (col) => col.notNull().defaultTo(0).check(sql`is_system in (0, 1)`))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('attributes')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('is_system', 'integer', (col) => col.notNull().defaultTo(0).check(sql`is_system in (0, 1)`))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('attribute_values')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('attribute_id', 'text', (col) => col.notNull().references('attributes.id').onDelete('restrict'))
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addUniqueConstraint('attribute_values_attribute_value_key', ['attribute_id', 'value'])
    .execute()

  await db.schema
    .createTable('products')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('name_en', 'text')
    .addColumn('generic_name', 'text')
    .addColumn('description', 'text')
    .addColumn('search_text', 'text', (col) => col.notNull())
    .addColumn('category_id', 'text', (col) => col.references('categories.id').onDelete('restrict'))
    .addColumn('brand_id', 'text', (col) => col.references('brands.id').onDelete('restrict'))
    .addColumn('tax_rate_id', 'text', (col) => col.references('tax_rates.id').onDelete('restrict'))
    .addColumn('base_unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    .addColumn('prescription_required', 'integer', (col) =>
      col.notNull().defaultTo(0).check(sql`prescription_required in (0, 1)`),
    )
    .addColumn('track_lots', 'integer', (col) => col.notNull().defaultTo(0).check(sql`track_lots in (0, 1)`))
    .addColumn('track_serials', 'integer', (col) => col.notNull().defaultTo(0).check(sql`track_serials in (0, 1)`))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('products_name_idx').on('products').columns(['name', 'id']).execute()
  await db.schema.createIndex('products_category_idx').on('products').column('category_id').execute()
  await db.schema.createIndex('products_brand_idx').on('products').column('brand_id').execute()
  await db.schema.createIndex('products_tax_rate_idx').on('products').column('tax_rate_id').execute()
  await db.schema.createIndex('products_base_unit_idx').on('products').column('base_unit_id').execute()

  await db.schema
    .createTable('unit_conversions')
    .addColumn('product_id', 'text', (col) => col.notNull().references('products.id').onDelete('cascade'))
    .addColumn('unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    .addColumn('factor_milli', 'bigint', (col) => col.notNull().check(sql`factor_milli > 0`))
    .addPrimaryKeyConstraint('unit_conversions_pk', ['product_id', 'unit_id'])
    .execute()

  await db.schema
    .createIndex('unit_conversions_unit_idx')
    .on('unit_conversions')
    .column('unit_id')
    .execute()

  await db.schema
    .createTable('product_variants')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('product_id', 'text', (col) => col.notNull().references('products.id').onDelete('restrict'))
    .addColumn('sku', 'text', (col) => col.notNull().unique())
    .addColumn('label', 'text')
    .addColumn('cost_minor', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`cost_minor >= 0`))
    .addColumn('is_default', 'integer', (col) => col.notNull().defaultTo(0).check(sql`is_default in (0, 1)`))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('product_variants_product_idx').on('product_variants').column('product_id').execute()

  await db.schema
    .createTable('variant_attribute_values')
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('cascade'))
    .addColumn('value_id', 'text', (col) => col.notNull().references('attribute_values.id').onDelete('restrict'))
    .addPrimaryKeyConstraint('variant_attribute_values_pk', ['variant_id', 'value_id'])
    .execute()

  await db.schema
    .createIndex('variant_attribute_values_value_idx')
    .on('variant_attribute_values')
    .column('value_id')
    .execute()

  await db.schema
    .createTable('barcodes')
    .addColumn('code', 'text', (col) => col.primaryKey())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('cascade'))
    .addColumn('unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('barcodes_variant_idx').on('barcodes').column('variant_id').execute()
  await db.schema.createIndex('barcodes_unit_idx').on('barcodes').column('unit_id').execute()

  await db.schema
    .createTable('variant_prices')
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('cascade'))
    .addColumn('price_list_id', 'text', (col) => col.notNull().references('price_lists.id').onDelete('restrict'))
    .addColumn('unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    .addColumn('amount_minor', 'bigint', (col) => col.notNull().check(sql`amount_minor >= 0`))
    .addPrimaryKeyConstraint('variant_prices_pk', ['variant_id', 'price_list_id', 'unit_id'])
    .execute()

  await db.schema.createIndex('variant_prices_list_idx').on('variant_prices').column('price_list_id').execute()
  await db.schema.createIndex('variant_prices_unit_idx').on('variant_prices').column('unit_id').execute()

  if (isSqlite(db)) {
    // Postgres searches `products.search_text` instead; see `search.ts`.
    await sql`create virtual table product_search using fts5(product_id unindexed, text, tokenize = 'unicode61 remove_diacritics 0')`.execute(db)
  }

  await db
    .insertInto('units')
    .values(
      // The listing sorts by creation, so this keeps the common units first.
      SYSTEM_UNITS.map(([id, fraction], index) => ({
        id,
        name: id,
        allows_fraction: fraction ? 1 : 0,
        is_system: 1,
        created_at: index,
      })),
    )
    .execute()

  await db
    .insertInto('tax_rates')
    .values([
      { id: 'vat', name: 'vat', rate_bp: 1400, is_system: 1, created_at: 0 },
      { id: 'exempt', name: 'exempt', rate_bp: 0, is_system: 1, created_at: 1 },
    ])
    .execute()

  await db
    .insertInto('price_lists')
    .values([{ id: 'retail', name: 'retail', is_system: 1, created_at: 0 }])
    .execute()

  await db
    .insertInto('attributes')
    .values(SYSTEM_ATTRIBUTES.map((id) => ({ id, name: id, is_system: 1, created_at: 0 })))
    .execute()

  // Stores set up before this version get the same grants a new store starts with.
  const roles = await db.selectFrom('roles').select('id').execute()
  const present = new Set(roles.map((role: { id: string }) => role.id))
  const grants = ROLE_GRANTS.filter(([roleId]) => present.has(roleId))
  if (grants.length > 0) {
    await db
      .insertInto('role_permissions')
      .values(grants.map(([role_id, permission]) => ({ role_id, permission })))
      .execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  if (isSqlite(db)) await sql`drop table product_search`.execute(db)
  for (const table of [
    'variant_prices',
    'barcodes',
    'variant_attribute_values',
    'product_variants',
    'unit_conversions',
    'products',
    'attribute_values',
    'attributes',
    'tax_rates',
    'units',
    'price_lists',
    'brands',
    'categories',
    'document_sequences',
  ]) {
    await db.schema.dropTable(table).execute()
  }
}

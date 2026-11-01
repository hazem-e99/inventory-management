import { sql, type Kysely } from 'kysely'
import { dropAppendOnly, makeAppendOnly } from './append-only'

const ROLE_GRANTS: Array<[string, string]> = [
  ['manager', 'stock.view'],
  ['manager', 'stock.manage'],
  ['manager', 'stock.void'],
  ['storekeeper', 'stock.view'],
  ['storekeeper', 'stock.manage'],
  ['cashier', 'stock.view'],
]

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('warehouses')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('is_system', 'integer', (col) => col.notNull().defaultTo(0).check(sql`is_system in (0, 1)`))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('lots')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('lot_no', 'text', (col) => col.notNull())
    .addColumn('expiry_date', 'text')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addUniqueConstraint('lots_variant_lot_key', ['variant_id', 'lot_no'])
    .execute()

  await db.schema.createIndex('lots_expiry_idx').on('lots').column('expiry_date').execute()

  await db.schema
    .createTable('stock_documents')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('kind', 'text', (col) => col.notNull().check(sql`kind in ('adjustment', 'transfer', 'count')`))
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('draft', 'posted', 'voided')`))
    .addColumn('number', 'text', (col) => col.unique())
    .addColumn('warehouse_id', 'text', (col) => col.notNull().references('warehouses.id').onDelete('restrict'))
    .addColumn('to_warehouse_id', 'text', (col) => col.references('warehouses.id').onDelete('restrict'))
    .addColumn('reason', 'text')
    .addColumn('notes', 'text')
    .addColumn('business_date', 'text')
    .addColumn('created_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('posted_at', 'bigint')
    .addColumn('voided_at', 'bigint')
    .execute()

  await db.schema
    .createIndex('stock_documents_list_idx')
    .on('stock_documents')
    .columns(['created_at', 'id'])
    .execute()

  await db.schema
    .createTable('stock_document_lines')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('document_id', 'text', (col) => col.notNull().references('stock_documents.id').onDelete('cascade'))
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    .addColumn('qty_milli', 'bigint', (col) => col.notNull())
    .addColumn('lot_id', 'text', (col) => col.references('lots.id').onDelete('restrict'))
    .addColumn('lot_no', 'text')
    .addColumn('expiry_date', 'text')
    .addColumn('unit_cost_minor', 'bigint')
    .addColumn('expected_milli', 'bigint')
    .execute()

  await db.schema
    .createIndex('stock_document_lines_document_idx')
    .on('stock_document_lines')
    .columns(['document_id', 'position'])
    .execute()

  await db.schema
    .createTable('stock_movements')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .addColumn('business_date', 'text', (col) => col.notNull())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('warehouse_id', 'text', (col) => col.notNull().references('warehouses.id').onDelete('restrict'))
    .addColumn('lot_id', 'text', (col) => col.references('lots.id').onDelete('restrict'))
    .addColumn('qty_milli', 'bigint', (col) => col.notNull().check(sql`qty_milli <> 0`))
    .addColumn('value_minor', 'bigint', (col) => col.notNull())
    .addColumn('document_id', 'text', (col) => col.notNull())
    .addColumn('document_type', 'text', (col) => col.notNull())
    .addColumn('reversal_of', 'text', (col) => col.references('stock_movements.id').onDelete('restrict'))
    .addColumn('actor_id', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .execute()

  await db.schema
    .createIndex('stock_movements_variant_idx')
    .on('stock_movements')
    .columns(['variant_id', 'occurred_at', 'id'])
    .execute()
  await db.schema
    .createIndex('stock_movements_document_idx')
    .on('stock_movements')
    .column('document_id')
    .execute()
  await db.schema.createIndex('stock_movements_date_idx').on('stock_movements').column('business_date').execute()
  await db.schema.createIndex('stock_movements_warehouse_idx').on('stock_movements').column('warehouse_id').execute()
  await db.schema.createIndex('stock_movements_lot_idx').on('stock_movements').column('lot_id').execute()

  await makeAppendOnly(db, 'stock_movements')

  await db.schema
    .createTable('stock_balances')
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('warehouse_id', 'text', (col) => col.notNull().references('warehouses.id').onDelete('restrict'))
    // Empty rather than NULL when there is no lot, so it can sit in the primary key.
    .addColumn('lot_key', 'text', (col) => col.notNull())
    .addColumn('lot_id', 'text', (col) => col.references('lots.id').onDelete('restrict'))
    .addColumn('qty_milli', 'bigint', (col) => col.notNull())
    .addPrimaryKeyConstraint('stock_balances_pk', ['variant_id', 'warehouse_id', 'lot_key'])
    .execute()

  await db.schema.createIndex('stock_balances_warehouse_idx').on('stock_balances').column('warehouse_id').execute()
  await db.schema.createIndex('stock_balances_lot_idx').on('stock_balances').column('lot_id').execute()

  await db.schema
    .createTable('variant_stock')
    .addColumn('variant_id', 'text', (col) =>
      col.primaryKey().references('product_variants.id').onDelete('restrict'),
    )
    .addColumn('qty_milli', 'bigint', (col) => col.notNull())
    .addColumn('value_minor', 'bigint', (col) => col.notNull())
    .execute()

  await db
    .insertInto('warehouses')
    .values({ id: 'main', name: 'main', is_system: 1, created_at: 0 })
    .execute()

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
  await dropAppendOnly(db, 'stock_movements')
  for (const table of [
    'variant_stock',
    'stock_balances',
    'stock_movements',
    'stock_document_lines',
    'stock_documents',
    'lots',
    'warehouses',
  ]) {
    await db.schema.dropTable(table).execute()
  }
}

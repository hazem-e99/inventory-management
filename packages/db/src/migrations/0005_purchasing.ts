import { sql, type Kysely } from 'kysely'
import { dropAppendOnly, makeAppendOnly } from './append-only'

const ROLE_GRANTS: Array<[string, string]> = [
  ['manager', 'purchases.view'],
  ['manager', 'purchases.manage'],
  ['manager', 'purchases.void'],
  ['manager', 'suppliers.manage'],
  ['manager', 'suppliers.pay'],
  ['storekeeper', 'purchases.view'],
  ['storekeeper', 'purchases.manage'],
]

export async function up(db: Kysely<any>): Promise<void> {
  // Each ledger names its own document, so a movement reads the same whatever created it.
  await db.schema.alterTable('stock_movements').addColumn('document_number', 'text').execute()

  await db.schema
    .createTable('suppliers')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('phone', 'text')
    .addColumn('address', 'text')
    .addColumn('tax_number', 'text')
    .addColumn('notes', 'text')
    .addColumn('search_text', 'text', (col) => col.notNull())
    .addColumn('balance_minor', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('supplier_ledger')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('supplier_id', 'text', (col) => col.notNull().references('suppliers.id').onDelete('restrict'))
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .addColumn('business_date', 'text', (col) => col.notNull())
    .addColumn('amount_minor', 'bigint', (col) => col.notNull())
    .addColumn('balance_after_minor', 'bigint', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('document_id', 'text', (col) => col.notNull())
    .addColumn('document_number', 'text')
    .addColumn('reversal_of', 'text', (col) => col.references('supplier_ledger.id').onDelete('restrict'))
    .addColumn('actor_id', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .execute()

  await db.schema
    .createIndex('supplier_ledger_statement_idx')
    .on('supplier_ledger')
    .columns(['supplier_id', 'occurred_at', 'id'])
    .execute()
  await db.schema.createIndex('supplier_ledger_document_idx').on('supplier_ledger').column('document_id').execute()

  await makeAppendOnly(db, 'supplier_ledger')

  await db.schema
    .createTable('purchase_orders')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('number', 'text', (col) => col.unique())
    .addColumn('status', 'text', (col) =>
      col.notNull().check(sql`status in ('draft', 'open', 'partial', 'received', 'cancelled')`),
    )
    .addColumn('supplier_id', 'text', (col) => col.notNull().references('suppliers.id').onDelete('restrict'))
    .addColumn('warehouse_id', 'text', (col) => col.notNull().references('warehouses.id').onDelete('restrict'))
    .addColumn('expected_date', 'text')
    .addColumn('notes', 'text')
    .addColumn('created_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('purchase_orders_list_idx').on('purchase_orders').columns(['created_at', 'id']).execute()
  await db.schema.createIndex('purchase_orders_supplier_idx').on('purchase_orders').column('supplier_id').execute()

  await db.schema
    .createTable('purchase_order_lines')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('order_id', 'text', (col) => col.notNull().references('purchase_orders.id').onDelete('cascade'))
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    .addColumn('qty_milli', 'bigint', (col) => col.notNull())
    .addColumn('unit_cost_minor', 'bigint', (col) => col.notNull().check(sql`unit_cost_minor >= 0`))
    .addColumn('ordered_base_milli', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('received_base_milli', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`received_base_milli >= 0`))
    .execute()

  await db.schema
    .createIndex('purchase_order_lines_order_idx')
    .on('purchase_order_lines')
    .columns(['order_id', 'position'])
    .execute()

  await db.schema
    .createTable('purchase_documents')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('kind', 'text', (col) => col.notNull().check(sql`kind in ('invoice', 'return')`))
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('draft', 'posted', 'voided')`))
    .addColumn('number', 'text', (col) => col.unique())
    .addColumn('supplier_id', 'text', (col) => col.notNull().references('suppliers.id').onDelete('restrict'))
    .addColumn('warehouse_id', 'text', (col) => col.notNull().references('warehouses.id').onDelete('restrict'))
    .addColumn('order_id', 'text', (col) => col.references('purchase_orders.id').onDelete('restrict'))
    .addColumn('supplier_reference', 'text')
    .addColumn('notes', 'text')
    .addColumn('paid_minor', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`paid_minor >= 0`))
    .addColumn('payment_method', 'text')
    .addColumn('business_date', 'text')
    .addColumn('created_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('posted_at', 'bigint')
    .addColumn('voided_at', 'bigint')
    .execute()

  await db.schema.createIndex('purchase_documents_list_idx').on('purchase_documents').columns(['created_at', 'id']).execute()
  await db.schema.createIndex('purchase_documents_supplier_idx').on('purchase_documents').column('supplier_id').execute()
  await db.schema.createIndex('purchase_documents_order_idx').on('purchase_documents').column('order_id').execute()

  await db.schema
    .createTable('purchase_document_lines')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('document_id', 'text', (col) => col.notNull().references('purchase_documents.id').onDelete('cascade'))
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    .addColumn('qty_milli', 'bigint', (col) => col.notNull())
    .addColumn('unit_cost_minor', 'bigint', (col) => col.notNull().check(sql`unit_cost_minor >= 0`))
    .addColumn('discount_minor', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`discount_minor >= 0`))
    .addColumn('tax_rate_bp', 'integer', (col) => col.notNull().defaultTo(0).check(sql`tax_rate_bp between 0 and 10000`))
    .addColumn('lot_id', 'text', (col) => col.references('lots.id').onDelete('restrict'))
    .addColumn('lot_no', 'text')
    .addColumn('expiry_date', 'text')
    .addColumn('serials', 'text')
    .addColumn('order_line_id', 'text', (col) => col.references('purchase_order_lines.id').onDelete('restrict'))
    .execute()

  await db.schema
    .createIndex('purchase_document_lines_document_idx')
    .on('purchase_document_lines')
    .columns(['document_id', 'position'])
    .execute()
  await db.schema
    .createIndex('purchase_document_lines_order_line_idx')
    .on('purchase_document_lines')
    .column('order_line_id')
    .execute()

  await db.schema
    .createTable('supplier_payments')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('number', 'text', (col) => col.notNull().unique())
    .addColumn('supplier_id', 'text', (col) => col.notNull().references('suppliers.id').onDelete('restrict'))
    .addColumn('amount_minor', 'bigint', (col) => col.notNull().check(sql`amount_minor > 0`))
    .addColumn('method', 'text', (col) => col.notNull())
    .addColumn('reference', 'text')
    .addColumn('notes', 'text')
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('posted', 'voided')`))
    .addColumn('purchase_id', 'text', (col) => col.references('purchase_documents.id').onDelete('restrict'))
    .addColumn('created_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('voided_at', 'bigint')
    .execute()

  await db.schema.createIndex('supplier_payments_supplier_idx').on('supplier_payments').column('supplier_id').execute()
  await db.schema.createIndex('supplier_payments_purchase_idx').on('supplier_payments').column('purchase_id').execute()

  await db.schema
    .createTable('serials')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('serial', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('in_stock', 'sold', 'returned')`))
    .addColumn('warehouse_id', 'text', (col) => col.notNull().references('warehouses.id').onDelete('restrict'))
    .addColumn('purchase_id', 'text', (col) => col.references('purchase_documents.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addUniqueConstraint('serials_variant_serial_key', ['variant_id', 'serial'])
    .execute()

  await db.schema.createIndex('serials_purchase_idx').on('serials').column('purchase_id').execute()
  await db.schema.createIndex('serials_warehouse_idx').on('serials').column('warehouse_id').execute()

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
  await dropAppendOnly(db, 'supplier_ledger')
  for (const table of [
    'serials',
    'supplier_payments',
    'purchase_document_lines',
    'purchase_documents',
    'purchase_order_lines',
    'purchase_orders',
    'supplier_ledger',
    'suppliers',
  ]) {
    await db.schema.dropTable(table).execute()
  }
  await db.schema.alterTable('stock_movements').dropColumn('document_number').execute()
}

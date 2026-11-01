import { sql, type Kysely } from 'kysely'
import { dropAppendOnly, makeAppendOnly } from './append-only'

const ROLE_GRANTS: Array<[string, string]> = [
  ['manager', 'sales.view'],
  ['manager', 'sales.sell'],
  ['manager', 'sales.discount'],
  ['manager', 'sales.price'],
  ['manager', 'sales.return'],
  ['manager', 'sales.void'],
  ['manager', 'customers.manage'],
  ['manager', 'customers.collect'],
  ['manager', 'shifts.manage'],
  ['cashier', 'sales.view'],
  ['cashier', 'sales.sell'],
  ['cashier', 'sales.return'],
  ['cashier', 'customers.collect'],
]

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('customers')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('phone', 'text')
    .addColumn('address', 'text')
    .addColumn('notes', 'text')
    .addColumn('search_text', 'text', (col) => col.notNull())
    .addColumn('credit_limit_minor', 'bigint', (col) => col.check(sql`credit_limit_minor >= 0`))
    .addColumn('balance_minor', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('archived_at', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('customers_name_idx').on('customers').columns(['name', 'id']).execute()

  await db.schema
    .createTable('customer_ledger')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('customer_id', 'text', (col) => col.notNull().references('customers.id').onDelete('restrict'))
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .addColumn('business_date', 'text', (col) => col.notNull())
    .addColumn('amount_minor', 'bigint', (col) => col.notNull())
    .addColumn('balance_after_minor', 'bigint', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('document_id', 'text', (col) => col.notNull())
    .addColumn('document_number', 'text')
    .addColumn('reversal_of', 'text', (col) => col.references('customer_ledger.id').onDelete('restrict'))
    .addColumn('actor_id', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .execute()

  await db.schema
    .createIndex('customer_ledger_statement_idx')
    .on('customer_ledger')
    .columns(['customer_id', 'occurred_at', 'id'])
    .execute()
  await db.schema.createIndex('customer_ledger_document_idx').on('customer_ledger').column('document_id').execute()

  await makeAppendOnly(db, 'customer_ledger')

  await db.schema
    .createTable('shifts')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('number', 'text', (col) => col.notNull().unique())
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('open', 'closed')`))
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('restrict'))
    .addColumn('opened_at', 'bigint', (col) => col.notNull())
    .addColumn('closed_at', 'bigint')
    .addColumn('closed_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('opening_cash_minor', 'bigint', (col) => col.notNull().check(sql`opening_cash_minor >= 0`))
    .addColumn('expected_cash_minor', 'bigint')
    .addColumn('counted_cash_minor', 'bigint', (col) => col.check(sql`counted_cash_minor >= 0`))
    .addColumn('notes', 'text')
    .execute()

  // One drawer on one device: a second open shift is a mistake the database refuses.
  await db.schema
    .createIndex('shifts_single_open_idx')
    .on('shifts')
    .column('status')
    .unique()
    .where(sql.ref('status'), '=', sql.lit('open'))
    .execute()
  await db.schema.createIndex('shifts_list_idx').on('shifts').columns(['opened_at', 'id']).execute()

  await db.schema
    .createTable('sales')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('request_id', 'text', (col) => col.notNull().unique())
    .addColumn('kind', 'text', (col) => col.notNull().check(sql`kind in ('sale', 'return')`))
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('posted', 'voided')`))
    .addColumn('number', 'text', (col) => col.notNull().unique())
    .addColumn('return_of', 'text', (col) => col.references('sales.id').onDelete('restrict'))
    .addColumn('customer_id', 'text', (col) => col.references('customers.id').onDelete('restrict'))
    .addColumn('shift_id', 'text', (col) => col.notNull().references('shifts.id').onDelete('restrict'))
    .addColumn('warehouse_id', 'text', (col) => col.notNull().references('warehouses.id').onDelete('restrict'))
    .addColumn('gross_minor', 'bigint', (col) => col.notNull().check(sql`gross_minor >= 0`))
    .addColumn('discount_minor', 'bigint', (col) => col.notNull().check(sql`discount_minor >= 0`))
    .addColumn('tax_minor', 'bigint', (col) => col.notNull().check(sql`tax_minor >= 0`))
    .addColumn('total_minor', 'bigint', (col) => col.notNull().check(sql`total_minor >= 0`))
    .addColumn('tendered_minor', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`tendered_minor >= 0`))
    .addColumn('change_minor', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`change_minor >= 0`))
    .addColumn('notes', 'text')
    .addColumn('business_date', 'text', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('voided_at', 'bigint')
    .addColumn('voided_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .execute()

  await db.schema.createIndex('sales_list_idx').on('sales').columns(['created_at', 'id']).execute()
  await db.schema.createIndex('sales_customer_idx').on('sales').column('customer_id').execute()
  await db.schema.createIndex('sales_shift_idx').on('sales').column('shift_id').execute()
  await db.schema.createIndex('sales_return_of_idx').on('sales').column('return_of').execute()
  await db.schema.createIndex('sales_business_date_idx').on('sales').column('business_date').execute()

  await db.schema
    .createTable('sale_lines')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('sale_id', 'text', (col) => col.notNull().references('sales.id').onDelete('restrict'))
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('variant_id', 'text', (col) => col.notNull().references('product_variants.id').onDelete('restrict'))
    .addColumn('unit_id', 'text', (col) => col.notNull().references('units.id').onDelete('restrict'))
    // The name as it read on the day, so an old receipt reprints exactly.
    .addColumn('item_name', 'text', (col) => col.notNull())
    .addColumn('qty_milli', 'bigint', (col) => col.notNull().check(sql`qty_milli > 0`))
    .addColumn('base_qty_milli', 'bigint', (col) => col.notNull().check(sql`base_qty_milli > 0`))
    .addColumn('unit_price_minor', 'bigint', (col) => col.notNull().check(sql`unit_price_minor >= 0`))
    .addColumn('discount_minor', 'bigint', (col) => col.notNull().check(sql`discount_minor >= 0`))
    .addColumn('tax_rate_bp', 'integer', (col) => col.notNull().check(sql`tax_rate_bp between 0 and 10000`))
    .addColumn('tax_minor', 'bigint', (col) => col.notNull())
    .addColumn('total_minor', 'bigint', (col) => col.notNull().check(sql`total_minor >= 0`))
    .addColumn('cost_minor', 'bigint', (col) => col.notNull())
    .addColumn('serials', 'text')
    .addColumn('return_of_line', 'text', (col) => col.references('sale_lines.id').onDelete('restrict'))
    .addColumn('returned_base_milli', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`returned_base_milli >= 0`))
    .addColumn('refunded_minor', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`refunded_minor >= 0`))
    .addColumn('returned_cost_minor', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema.createIndex('sale_lines_sale_idx').on('sale_lines').columns(['sale_id', 'position']).execute()
  await db.schema.createIndex('sale_lines_variant_idx').on('sale_lines').column('variant_id').execute()
  await db.schema.createIndex('sale_lines_return_of_idx').on('sale_lines').column('return_of_line').execute()

  await db.schema
    .createTable('sale_line_lots')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('sale_line_id', 'text', (col) => col.notNull().references('sale_lines.id').onDelete('restrict'))
    .addColumn('lot_id', 'text', (col) => col.references('lots.id').onDelete('restrict'))
    .addColumn('qty_milli', 'bigint', (col) => col.notNull().check(sql`qty_milli > 0`))
    .addColumn('returned_milli', 'bigint', (col) => col.notNull().defaultTo(0).check(sql`returned_milli >= 0`))
    .execute()

  await db.schema.createIndex('sale_line_lots_line_idx').on('sale_line_lots').column('sale_line_id').execute()

  await db.schema
    .createTable('sale_payments')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('sale_id', 'text', (col) => col.notNull().references('sales.id').onDelete('restrict'))
    .addColumn('shift_id', 'text', (col) => col.notNull().references('shifts.id').onDelete('restrict'))
    .addColumn('method', 'text', (col) => col.notNull().check(sql`method in ('cash', 'card', 'wallet', 'credit')`))
    .addColumn('amount_minor', 'bigint', (col) => col.notNull())
    .addColumn('reversal_of', 'text', (col) => col.references('sale_payments.id').onDelete('restrict'))
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('sale_payments_sale_idx').on('sale_payments').column('sale_id').execute()
  await db.schema.createIndex('sale_payments_shift_idx').on('sale_payments').columns(['shift_id', 'method']).execute()

  await makeAppendOnly(db, 'sale_payments')

  await db.schema
    .createTable('customer_receipts')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('number', 'text', (col) => col.notNull().unique())
    .addColumn('customer_id', 'text', (col) => col.notNull().references('customers.id').onDelete('restrict'))
    .addColumn('shift_id', 'text', (col) => col.notNull().references('shifts.id').onDelete('restrict'))
    .addColumn('amount_minor', 'bigint', (col) => col.notNull().check(sql`amount_minor > 0`))
    .addColumn('method', 'text', (col) => col.notNull().check(sql`method in ('cash', 'card', 'wallet')`))
    .addColumn('reference', 'text')
    .addColumn('notes', 'text')
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('posted', 'voided')`))
    .addColumn('created_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('voided_at', 'bigint')
    .execute()

  await db.schema.createIndex('customer_receipts_customer_idx').on('customer_receipts').column('customer_id').execute()

  await db.schema
    .createTable('cash_movements')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('shift_id', 'text', (col) => col.notNull().references('shifts.id').onDelete('restrict'))
    .addColumn('kind', 'text', (col) => col.notNull().check(sql`kind in ('in', 'out', 'receipt')`))
    .addColumn('amount_minor', 'bigint', (col) => col.notNull())
    .addColumn('reason', 'text')
    .addColumn('document_id', 'text')
    .addColumn('actor_id', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('cash_movements_shift_idx').on('cash_movements').column('shift_id').execute()

  await makeAppendOnly(db, 'cash_movements')

  await db.schema
    .createTable('held_sales')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('label', 'text')
    .addColumn('cart', 'text', (col) => col.notNull())
    .addColumn('total_minor', 'bigint', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
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
  await dropAppendOnly(db, 'cash_movements')
  await dropAppendOnly(db, 'sale_payments')
  await dropAppendOnly(db, 'customer_ledger')
  for (const table of [
    'held_sales',
    'cash_movements',
    'customer_receipts',
    'sale_payments',
    'sale_line_lots',
    'sale_lines',
    'sales',
    'shifts',
    'customer_ledger',
    'customers',
  ]) {
    await db.schema.dropTable(table).execute()
  }
}

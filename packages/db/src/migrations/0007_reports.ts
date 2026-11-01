import { sql, type Kysely } from 'kysely'

const ROLE_GRANTS: Array<[string, string]> = [
  ['manager', 'reports.view'],
  ['manager', 'reports.profit'],
  ['storekeeper', 'reports.view'],
]

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('product_variants')
    .addColumn('reorder_level_milli', 'bigint', (col) => col.check(sql`reorder_level_milli >= 0`))
    .execute()

  await db.schema
    .createIndex('product_variants_reorder_idx')
    .on('product_variants')
    .column('reorder_level_milli')
    .where(sql.ref('reorder_level_milli'), 'is not', null)
    .execute()

  await db.schema
    .createIndex('stock_movements_period_idx')
    .on('stock_movements')
    .columns(['business_date', 'occurred_at', 'id'])
    .execute()

  // Reports read these two indexes and never touch the tables: on an encrypted file every page
  // read is a decryption, so a year of sales from the tables takes tens of seconds.
  await db.schema.alterTable('sales').addColumn('cost_minor', 'bigint', (col) => col.notNull().defaultTo(0)).execute()
  await sql`update sales set cost_minor = (select coalesce(sum(cost_minor), 0) from sale_lines where sale_id = sales.id)`.execute(db)

  await db.schema
    .createIndex('sales_report_idx')
    .on('sales')
    .columns(['business_date', 'status', 'kind', 'total_minor', 'discount_minor', 'tax_minor', 'cost_minor'])
    .execute()

  await db.schema.alterTable('sale_lines').addColumn('report_date', 'text').execute()
  await db.schema.alterTable('sale_lines').addColumn('is_return', 'integer', (col) => col.notNull().defaultTo(0)).execute()
  await sql`
    update sale_lines set
      report_date = (select case when status = 'posted' then business_date end from sales where sales.id = sale_lines.sale_id),
      is_return = (select case when kind = 'return' then 1 else 0 end from sales where sales.id = sale_lines.sale_id)
  `.execute(db)

  await db.schema
    .createIndex('sale_lines_report_idx')
    .on('sale_lines')
    .columns(['report_date', 'variant_id', 'is_return', 'base_qty_milli', 'total_minor', 'cost_minor'])
    .where(sql.ref('report_date'), 'is not', null)
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
  await db.deleteFrom('role_permissions').where('permission', 'in', ['reports.view', 'reports.profit']).execute()
  await db.schema.dropIndex('sale_lines_report_idx').execute()
  await db.schema.alterTable('sale_lines').dropColumn('is_return').execute()
  await db.schema.alterTable('sale_lines').dropColumn('report_date').execute()
  await db.schema.dropIndex('sales_report_idx').execute()
  await db.schema.alterTable('sales').dropColumn('cost_minor').execute()
  await db.schema.dropIndex('stock_movements_period_idx').execute()
  await db.schema.dropIndex('product_variants_reorder_idx').execute()
  await db.schema.alterTable('product_variants').dropColumn('reorder_level_milli').execute()
}

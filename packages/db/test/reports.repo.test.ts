import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrateToLatest, newId, reportsRepo, type Database } from '../src'
import { dialects, tempDir } from './helpers'

const dir = tempDir()
const DAY = '2026-06-15'
const USER = 'u1'

async function seed(db: Kysely<Database>) {
  await db.insertInto('roles').values({ id: 'r1', name: 'دور', is_system: 0, created_at: 1 }).execute()
  await db
    .insertInto('users')
    .values({ id: USER, username: 'a', full_name: 'كاشير', password_hash: 'x', pin_hash: null, role_id: 'r1', locked_until: null, created_at: 1, updated_at: 1 })
    .execute()
  await db
    .insertInto('products')
    .values({
      id: 'p1',
      name: 'صنف',
      name_en: null,
      generic_name: null,
      description: null,
      search_text: 'صنف',
      category_id: null,
      brand_id: null,
      tax_rate_id: null,
      base_unit_id: 'piece',
      prescription_required: 0,
      track_lots: 1,
      track_serials: 0,
      archived_at: null,
      created_at: 1,
      updated_at: 1,
    })
    .execute()
  await db
    .insertInto('product_variants')
    .values({ id: 'v1', product_id: 'p1', sku: 'S1', label: null, cost_minor: 100, reorder_level_milli: 5000, is_default: 1, archived_at: null, created_at: 1, updated_at: 1 })
    .execute()
  await db.insertInto('variant_stock').values({ variant_id: 'v1', qty_milli: 3000, value_minor: 300 }).execute()
  await db.insertInto('lots').values({ id: 'l1', variant_id: 'v1', lot_no: 'A', expiry_date: '2026-07-01', created_at: 1 }).execute()
  await db.insertInto('stock_balances').values({ variant_id: 'v1', warehouse_id: 'main', lot_key: 'l1', lot_id: 'l1', qty_milli: 3000 }).execute()
  await db
    .insertInto('stock_movements')
    .values({ id: 'm1', occurred_at: 5, business_date: DAY, variant_id: 'v1', warehouse_id: 'main', lot_id: 'l1', qty_milli: 3000, value_minor: 300, document_id: 'd1', document_type: 'adjustment', document_number: null, reversal_of: null, actor_id: null })
    .execute()
  await db
    .insertInto('shifts')
    .values({ id: 's1', number: 'SH-1', status: 'closed', user_id: USER, opened_at: Date.parse(`${DAY}T10:00:00Z`), closed_at: 2, closed_by: USER, opening_cash_minor: 0, expected_cash_minor: 500, counted_cash_minor: 500, notes: null })
    .execute()

  const sale = (id: string, kind: string, total: number) => ({
    id,
    request_id: newId(),
    kind,
    status: 'posted',
    number: id,
    return_of: null,
    customer_id: null,
    shift_id: 's1',
    warehouse_id: 'main',
    gross_minor: total,
    discount_minor: 0,
    tax_minor: 0,
    total_minor: total,
    cost_minor: kind === 'sale' ? 100 : 40,
    tendered_minor: 0,
    change_minor: 0,
    notes: null,
    business_date: DAY,
    created_by: USER,
    created_at: 1,
    voided_at: null,
    voided_by: null,
  })
  const line = (id: string, saleId: string, total: number, cost: number) => ({
    id,
    sale_id: saleId,
    position: 0,
    variant_id: 'v1',
    unit_id: 'piece',
    item_name: 'صنف',
    qty_milli: 1000,
    base_qty_milli: 1000,
    unit_price_minor: total,
    discount_minor: 0,
    tax_rate_bp: 0,
    tax_minor: 0,
    total_minor: total,
    cost_minor: cost,
    serials: null,
    return_of_line: null,
    report_date: DAY,
    is_return: saleId === 'b' ? 1 : 0,
  })

  await db.insertInto('sales').values([sale('a', 'sale', 500), sale('b', 'return', 200)]).execute()
  await db.insertInto('sale_lines').values([line('la', 'a', 500, 100), line('lb', 'b', 200, 40)]).execute()

  await db
    .insertInto('suppliers')
    .values({ id: 'sup', name: 'مورد', phone: null, address: null, tax_number: null, notes: null, search_text: 'مورد', balance_minor: 900, archived_at: null, created_at: 1, updated_at: 1 })
    .execute()
  await db
    .insertInto('supplier_ledger')
    .values({ id: 'e1', supplier_id: 'sup', occurred_at: 1, business_date: DAY, amount_minor: 900, balance_after_minor: 900, source: 'purchase', document_id: 'x', document_number: null, reversal_of: null, actor_id: null })
    .execute()
  await db
    .insertInto('customers')
    .values({ id: 'cus', name: 'عميل', phone: null, address: null, notes: null, search_text: 'عميل', credit_limit_minor: null, balance_minor: 70, archived_at: null, created_at: 1, updated_at: 1 })
    .execute()
  await db
    .insertInto('customer_ledger')
    .values({ id: 'c1', customer_id: 'cus', occurred_at: 1, business_date: DAY, amount_minor: 70, balance_after_minor: 70, source: 'sale', document_id: 'y', document_number: null, reversal_of: null, actor_id: null })
    .execute()
}

describe.each(dialects(dir))('report queries on %s', (_name, create) => {
  let db: Kysely<Database>
  const range = { from: DAY, to: DAY }

  beforeAll(async () => {
    db = create()
    await migrateToLatest(db)
    await seed(db)
    await sql`select 1`.execute(db)
  })

  afterAll(() => db.destroy())

  it('totals a day by kind, with numbers rather than driver strings', async () => {
    const rows = await reportsRepo(db).salesByDay(range)
    const sale = rows.find(({ kind }) => kind === 'sale')!
    expect(sale).toMatchObject({ documents: 1, totalMinor: 500, costMinor: 100 })
    expect(rows.find(({ kind }) => kind === 'return')).toMatchObject({ totalMinor: 200, costMinor: 40 })
  })

  it('nets an item across sales and returns', async () => {
    expect(await reportsRepo(db).salesByItem(range)).toEqual([
      expect.objectContaining({ variantId: 'v1', qtyMilli: 0, salesMinor: 300, costMinor: 60 }),
    ])
  })

  it('reads the shelf and its total', async () => {
    const repo = reportsRepo(db)
    expect(await repo.inventory({ limit: 10, offset: 0 })).toHaveLength(1)
    expect(await repo.inventoryTotals()).toEqual({ items: 1, valueMinor: 300 })
  })

  it('pages movements in order', async () => {
    const { rows, next } = await reportsRepo(db).movements(range, 10, null)
    expect(rows.map(({ id }) => id)).toEqual(['m1'])
    expect(next).toBeNull()
  })

  it('finds low stock, sold quantities and running-out batches', async () => {
    const repo = reportsRepo(db)
    expect(await repo.countLowStock()).toBe(1)
    expect((await repo.lowStock())[0]).toMatchObject({ variant_id: 'v1', supplier: null })
    expect((await repo.soldSince(['v1'], DAY)).get('v1')).toBe(0)
    expect(await repo.expiringBy('2026-08-01')).toHaveLength(1)
    expect(await repo.countExpiring('2026-06-20', '2026-08-01')).toEqual({ expired: 0, nearExpiry: 1 })
    expect(await repo.countExpiring('2026-07-05', '2026-08-01')).toEqual({ expired: 1, nearExpiry: 0 })
  })

  it('tells stock that sold recently from stock that has not', async () => {
    const repo = reportsRepo(db)
    expect(await repo.deadStock('2026-06-01', { limit: 10, offset: 0 })).toEqual([])
    const dead = await repo.deadStock('2026-07-01', { limit: 10, offset: 0 })
    expect(dead).toEqual([expect.objectContaining({ variant_id: 'v1', last_sold: DAY })])
  })

  it('reads both account ledgers and the shifts', async () => {
    const repo = reportsRepo(db)
    expect((await repo.suppliers(range))[0]).toMatchObject({ purchasesMinor: 900, balanceMinor: 900 })
    expect((await repo.customers(range))[0]).toMatchObject({ salesMinor: 70, balanceMinor: 70 })
    expect((await repo.shifts(range))[0]).toMatchObject({ number: 'SH-1', salesMinor: 500, returnsMinor: 200, cashier: 'كاشير' })
  })
})

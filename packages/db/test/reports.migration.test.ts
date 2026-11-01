import type { Kysely } from 'kysely'
import { afterAll, describe, expect, it } from 'vitest'
import { hasPendingUpgrade, migrateTo, migrateToLatest, type Database } from '../src'
import { dialects, tempDir } from './helpers'

const dir = tempDir()
const DAY = '2026-06-15'

/** A shop that was already selling before reports existed, written as that schema allowed. */
async function olderShop(db: Kysely<any>) {
  await db.insertInto('roles').values({ id: 'r1', name: 'دور', is_system: 0, created_at: 1 }).execute()
  await db
    .insertInto('users')
    .values({ id: 'u1', username: 'a', full_name: 'كاشير', password_hash: 'x', role_id: 'r1', created_at: 1, updated_at: 1 })
    .execute()
  await db
    .insertInto('products')
    .values({ id: 'p1', name: 'صنف', search_text: 'صنف', base_unit_id: 'piece', prescription_required: 0, track_lots: 0, track_serials: 0, created_at: 1, updated_at: 1 })
    .execute()
  await db
    .insertInto('product_variants')
    .values({ id: 'v1', product_id: 'p1', sku: 'S1', cost_minor: 100, is_default: 1, created_at: 1, updated_at: 1 })
    .execute()
  await db
    .insertInto('shifts')
    .values({ id: 's1', number: 'SH-1', status: 'open', user_id: 'u1', opened_at: 1, opening_cash_minor: 0 })
    .execute()

  const sale = (id: string, kind: string, status: string) => ({
    id,
    request_id: id,
    kind,
    status,
    number: id,
    shift_id: 's1',
    warehouse_id: 'main',
    gross_minor: 500,
    discount_minor: 0,
    tax_minor: 0,
    total_minor: 500,
    business_date: DAY,
    created_at: 1,
  })
  const line = (id: string, saleId: string, cost: number) => ({
    id,
    sale_id: saleId,
    position: 0,
    variant_id: 'v1',
    unit_id: 'piece',
    item_name: 'صنف',
    qty_milli: 1000,
    base_qty_milli: 1000,
    unit_price_minor: 500,
    discount_minor: 0,
    tax_rate_bp: 0,
    tax_minor: 0,
    total_minor: 500,
    cost_minor: cost,
  })

  await db.insertInto('sales').values([sale('a', 'sale', 'posted'), sale('b', 'return', 'posted'), sale('c', 'sale', 'voided')]).execute()
  await db.insertInto('sale_lines').values([line('la', 'a', 120), line('lb', 'b', 70), line('lc', 'c', 30)]).execute()
}

describe.each(dialects(dir))('telling an upgrade from a first run on %s', (_name, create) => {
  it('only calls it an upgrade when an older schema is in place', async () => {
    const db = create()
    expect(await hasPendingUpgrade(db)).toBe(false)

    await migrateTo(db, '0006_sales')
    expect(await hasPendingUpgrade(db)).toBe(true)

    await migrateToLatest(db)
    expect(await hasPendingUpgrade(db)).toBe(false)
    await db.destroy()
  })
})

describe.each(dialects(dir))('upgrading a shop with history on %s', (_name, create) => {
  let db: Kysely<Database>

  afterAll(() => db.destroy())

  it('fills the report columns from what is already there', async () => {
    db = create()
    await migrateTo(db, '0006_sales')
    await olderShop(db)
    await migrateToLatest(db)

    const sales = await db.selectFrom('sales').select(['id', 'cost_minor']).orderBy('id').execute()
    expect(sales.map(({ id, cost_minor }) => [id, Number(cost_minor)])).toEqual([
      ['a', 120],
      ['b', 70],
      ['c', 30],
    ])

    const lines = await db.selectFrom('sale_lines').select(['id', 'report_date', 'is_return']).orderBy('id').execute()
    expect(lines).toEqual([
      { id: 'la', report_date: DAY, is_return: 0 },
      { id: 'lb', report_date: DAY, is_return: 1 },
      { id: 'lc', report_date: null, is_return: 0 },
    ])
  })
})

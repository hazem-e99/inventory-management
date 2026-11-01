import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSearchText, searchTerms } from '@inv/domain'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { catalogRepo, createSqliteDb, migrateToLatest, reportsRepo, salesRepo, stockLedger, type Database } from '../src'

const PRODUCTS = 100_000
const MOVEMENTS = 1_000_000
const SALES = 300_000
const BATCH = 500
const RUNS = 40

// From docs/PLAN.md, section 8. Measured on a fast PC, so these leave room for a weak one.
const SEARCH_BUDGET_MS = 150
const PAGE_BUDGET_MS = 150
const SCAN_BUDGET_MS = 100
// A report that takes longer than this on the API process would freeze the till behind it.
const REPORT_BUDGET_MS = 300
// Looking back over a whole year of a very busy shop is analysis, not opening a list.
const ANALYSIS_BUDGET_MS = 1500

const NAMES = ['باراسيتامول', 'أموكسيسيلين', 'فيتامين سي', 'بنادول', 'كونجستال', 'حليب', 'سكر', 'زيت', 'أرز', 'شاي']

const dir = mkdtempSync(join(tmpdir(), 'inv-bench-'))
let db: Kysely<Database>

async function seed(): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('categories')
      .values(Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, name: `قسم ${index}`, parent_id: null, archived_at: null, created_at: 1 })))
      .execute()

    for (let start = 0; start < PRODUCTS; start += BATCH) {
      const ids = Array.from({ length: BATCH }, (_, offset) => start + offset)
      const text = (index: number) => buildSearchText([`${NAMES[index % NAMES.length]} صنف${index}`, `sku${index}`, `622${index}`])

      await trx
        .insertInto('products')
        .values(
          ids.map((index) => ({
            id: `p${index}`,
            name: `${NAMES[index % NAMES.length]} صنف ${index}`,
            name_en: null,
            generic_name: null,
            description: null,
            search_text: text(index),
            category_id: `c${index % 50}`,
            brand_id: null,
            tax_rate_id: null,
            base_unit_id: 'piece',
            prescription_required: 0,
            track_lots: 0,
            track_serials: 0,
            archived_at: null,
            created_at: 1,
            updated_at: 1,
          })),
        )
        .execute()
      await trx
        .insertInto('product_variants')
        .values(
          ids.map((index) => ({
            id: `v${index}`,
            product_id: `p${index}`,
            sku: `SKU-${index}`,
            label: null,
            cost_minor: 100,
            is_default: 1,
            archived_at: null,
            created_at: 1,
            updated_at: 1,
          })),
        )
        .execute()
      await trx
        .insertInto('barcodes')
        .values(ids.map((index) => ({ code: `622${index}`, variant_id: `v${index}`, unit_id: 'piece', created_at: 1 })))
        .execute()
      await trx
        .insertInto('variant_prices')
        .values(ids.map((index) => ({ variant_id: `v${index}`, price_list_id: 'retail', unit_id: 'piece', amount_minor: 1000 })))
        .execute()
      for (const index of ids) {
        await sql`insert into product_search (product_id, text) values (${`p${index}`}, ${text(index)})`.execute(trx)
      }
    }

    // A year or two of a busy shop's history, so posting is measured against a full ledger.
    // Written in index order: at random, six indexes on an encrypted file would take hours.
    await sql`
      with recursive counter(n) as (select 1 union all select n + 1 from counter where n < ${MOVEMENTS / PRODUCTS})
      insert into stock_movements
        (id, occurred_at, business_date, variant_id, warehouse_id, qty_milli, value_minor, document_id, document_type)
      select variant.id || '-' || printf('%02d', n), n, '2026-01-01', variant.id, 'main', 1000, 100, variant.id || '-' || printf('%02d', n), 'adjustment'
      from product_variants as variant cross join counter
      order by variant.id, n
    `.execute(trx)

    // A year of sales at about 800 invoices a day, which is a very busy shop.
    await trx.insertInto('roles').values({ id: 'bench', name: 'bench', is_system: 0, created_at: 1 }).execute()
    await trx
      .insertInto('users')
      .values({ id: 'bench', username: 'bench', full_name: 'bench', password_hash: 'x', pin_hash: null, role_id: 'bench', locked_until: null, created_at: 1, updated_at: 1 })
      .execute()
    await trx
      .insertInto('shifts')
      .values({ id: 'bench', number: 'SH-1', status: 'closed', user_id: 'bench', opened_at: 1, closed_at: 2, closed_by: 'bench', opening_cash_minor: 0, expected_cash_minor: 0, counted_cash_minor: 0, notes: null })
      .execute()
    await sql`
      with recursive counter(n) as (select 1 union all select n + 1 from counter where n < ${SALES})
      insert into sales
        (id, request_id, kind, status, number, shift_id, warehouse_id, gross_minor, discount_minor, tax_minor, total_minor, cost_minor, business_date, created_at)
      select printf('s%07d', n), printf('r%07d', n), iif(n % 40 = 0, 'return', 'sale'), 'posted', printf('INV-%07d', n), 'bench', 'main', 2000, 0, 0, 2000, 1000,
        date('2026-01-01', '+' || (n % 365) || ' days'), n
      from counter
    `.execute(trx)
    await sql`
      insert into sale_lines
        (id, sale_id, position, variant_id, unit_id, item_name, qty_milli, base_qty_milli, unit_price_minor, discount_minor, tax_rate_bp, tax_minor, total_minor, cost_minor, report_date, is_return)
      select 'l' || id, id, 0, 'v' || (created_at % ${sql.lit(PRODUCTS)}), 'piece', 'item', 1000, 1000, 2000, 0, 0, 0, 2000, 1000, business_date, iif(kind = 'return', 1, 0) from sales
    `.execute(trx)
    await sql`
      insert into variant_stock (variant_id, qty_milli, value_minor)
      select id, 5000, 5000 from product_variants
    `.execute(trx)
    await sql`update product_variants set reorder_level_milli = 6000 where id like 'v1%'`.execute(trx)
  })
}

async function p95(run: () => Promise<unknown>): Promise<number> {
  const samples: number[] = []
  for (let attempt = 0; attempt < RUNS; attempt++) {
    const startedAt = performance.now()
    await run()
    samples.push(performance.now() - startedAt)
  }
  return samples.sort((a, b) => a - b)[Math.floor(RUNS * 0.95)]!
}

describe(`catalog with ${PRODUCTS} products and ${MOVEMENTS} movements`, () => {
  beforeAll(async () => {
    db = createSqliteDb({ path: join(dir, 'bench.db'), hexKey: randomBytes(32).toString('hex') })
    await migrateToLatest(db)
    // Only for seeding: millions of out-of-order index writes need the pages held in memory.
    await sql`pragma cache_size = -1000000`.execute(db)
    await seed()
    await sql`pragma cache_size = -64000`.execute(db)
  }, 900_000)

  afterAll(async () => {
    await db.destroy()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  const list = (text: string, extra: object = {}) =>
    Promise.all([
      catalogRepo(db).listProducts({ terms: searchTerms(text), archived: false, limit: 50, ...extra }),
      catalogRepo(db).countProducts({ terms: searchTerms(text), archived: false }),
    ])

  const cases: Array<[string, () => Promise<unknown>, number]> = [
    ['first page, no search', () => list(''), PAGE_BUDGET_MS],
    ['search matching 10% of items', () => list('باراسيتامول'), SEARCH_BUDGET_MS],
    ['search matching 1 item', () => list('صنف77777'), SEARCH_BUDGET_MS],
    ['search by barcode', () => list('62277777'), SEARCH_BUDGET_MS],
    ['filter by category', () => catalogRepo(db).listProducts({ terms: [], categoryId: 'c7', archived: false, limit: 50 }), PAGE_BUDGET_MS],
    ['scan at the till', () => salesRepo(db).posLookup('62277777', 'main'), SCAN_BUDGET_MS],
    ['search at the till', () => salesRepo(db).posLookup('صنف77777', 'main'), SEARCH_BUDGET_MS],
    [
      'post a sale line',
      () =>
        db.transaction().execute((trx) =>
          stockLedger(trx, {
            documentId: 'bench',
            documentType: 'sale',
            documentNumber: null,
            actorId: null,
            occurredAt: 1,
            businessDate: '2026-01-01',
            allowNegative: true,
          }).post({ variantId: 'v77777', warehouseId: 'main', lotId: null, qtyMilli: -1000 }),
        ),
      SCAN_BUDGET_MS,
    ],
  ]

  it.each(cases)('%s', async (name, run, budget) => {
    const elapsed = await p95(run)
    console.log(`${name}: p95 ${elapsed.toFixed(1)}ms (budget ${budget}ms)`)
    expect(elapsed).toBeLessThan(budget)
  }, 60_000)

  const reports = reportsRepo.bind(null)
  const reportCases: Array<[string, () => Promise<unknown>, number]> = [
    ['report: sales for a month', () => reports(db).salesByDay({ from: '2026-06-01', to: '2026-06-30' }), REPORT_BUDGET_MS],
    ['report: sales for a year', () => reports(db).salesByDay({ from: '2026-01-01', to: '2026-12-31' }), ANALYSIS_BUDGET_MS],
    ['report: items for a month', () => reports(db).salesByItem({ from: '2026-06-01', to: '2026-06-30' }), REPORT_BUDGET_MS],
    ['report: items for a year', () => reports(db).salesByItem({ from: '2026-01-01', to: '2026-12-31' }), ANALYSIS_BUDGET_MS],
    ['report: first page of inventory', () => Promise.all([reports(db).inventory({ limit: 50, offset: 0 }), reports(db).inventoryTotals()]), REPORT_BUDGET_MS],
    ['report: first page of movements', () => reports(db).movements({ from: '2026-01-01', to: '2026-12-31' }, 50, null), REPORT_BUDGET_MS],
    ['report: low stock', () => reports(db).lowStock(), REPORT_BUDGET_MS],
    ['report: stock that stopped selling', () => reports(db).deadStock('2026-10-01', { limit: 50, offset: 0 }), ANALYSIS_BUDGET_MS],
    ['report: alert counts', () => Promise.all([reports(db).countLowStock(), reports(db).countExpiring('2026-06-01', '2026-09-01')]), REPORT_BUDGET_MS],
  ]

  it.each(reportCases)('%s', async (name, run, budget) => {
    const elapsed = await p95(run)
    console.log(`${name}: p95 ${elapsed.toFixed(1)}ms (budget ${budget}ms)`)
    expect(elapsed).toBeLessThan(budget)
  }, 300_000)

  it('stays fast deep into the list', async () => {
    let page = await catalogRepo(db).listProducts({ terms: [], archived: false, limit: 50 })
    for (let index = 0; index < 200; index++) {
      page = await catalogRepo(db).listProducts({ terms: [], archived: false, limit: 50, cursor: page.nextCursor! })
    }
    const cursor = page.nextCursor!
    const elapsed = await p95(() => catalogRepo(db).listProducts({ terms: [], archived: false, limit: 50, cursor }))
    console.log(`page 200: p95 ${elapsed.toFixed(1)}ms (budget ${PAGE_BUDGET_MS}ms)`)
    expect(elapsed).toBeLessThan(PAGE_BUDGET_MS)
  }, 60_000)
})

import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSearchText, searchTerms } from '@inv/domain'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { catalogRepo, createSqliteDb, migrateToLatest, salesRepo, stockLedger, type Database } from '../src'

const PRODUCTS = 100_000
const MOVEMENTS = 1_000_000
const BATCH = 500
const RUNS = 40

// From docs/PLAN.md, section 8. Measured on a fast PC, so these leave room for a weak one.
const SEARCH_BUDGET_MS = 150
const PAGE_BUDGET_MS = 150
const SCAN_BUDGET_MS = 100

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
    await seed()
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

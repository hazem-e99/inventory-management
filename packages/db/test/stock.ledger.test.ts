import fc from 'fast-check'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  catalogRepo,
  InsufficientStock,
  migrateToLatest,
  newId,
  referenceRepo,
  stockLedger,
  type Database,
  type LedgerContext,
} from '../src'
import { dialects, tempDir } from './helpers'

const dir = tempDir()

const WAREHOUSE = 'main'
const SECOND = 'second'

function context(overrides: Partial<LedgerContext> = {}): LedgerContext {
  return {
    documentId: newId(),
    documentType: 'adjustment',
    actorId: null,
    occurredAt: 1,
    businessDate: '2026-10-31',
    allowNegative: false,
    ...overrides,
  }
}

async function addVariant(db: Kysely<Database>, costMinor = 0): Promise<string> {
  const repo = catalogRepo(db)
  const productId = newId()
  const variantId = newId()
  await repo.insertProduct({
    id: productId,
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
    track_lots: 0,
    track_serials: 0,
    created_at: 1,
    updated_at: 1,
  })
  await repo.insertVariant({
    id: variantId,
    product_id: productId,
    sku: `SKU-${variantId}`,
    label: null,
    cost_minor: costMinor,
    is_default: 1,
    created_at: 1,
    updated_at: 1,
  })
  return variantId
}

async function addLot(db: Kysely<Database>, variantId: string, lotNo: string): Promise<string> {
  const id = newId()
  await db.insertInto('lots').values({ id, variant_id: variantId, lot_no: lotNo, expiry_date: null, created_at: 1 }).execute()
  return id
}

const stockOf = (db: Kysely<Database>, variantId: string) =>
  db.selectFrom('variant_stock').selectAll().where('variant_id', '=', variantId).executeTakeFirst()

/** Rebuilds every total from the movements alone and compares it with what is stored. */
async function reconcile(db: Kysely<Database>, variantId: string): Promise<void> {
  const movements = await db.selectFrom('stock_movements').selectAll().where('variant_id', '=', variantId).execute()
  const balances = await db.selectFrom('stock_balances').selectAll().where('variant_id', '=', variantId).execute()
  const totals = await stockOf(db, variantId)

  const expected = new Map<string, number>()
  for (const { warehouse_id, lot_id, qty_milli } of movements) {
    const key = `${warehouse_id}|${lot_id ?? ''}`
    expected.set(key, (expected.get(key) ?? 0) + Number(qty_milli))
  }

  for (const { warehouse_id, lot_key, qty_milli } of balances) {
    expect(Number(qty_milli)).toBe(expected.get(`${warehouse_id}|${lot_key}`) ?? 0)
  }

  const totalQty = movements.reduce((sum, { qty_milli }) => sum + Number(qty_milli), 0)
  const totalValue = movements.reduce((sum, { value_minor }) => sum + Number(value_minor), 0)
  expect(Number(totals?.qty_milli ?? 0)).toBe(totalQty)
  expect(Number(totals?.value_minor ?? 0)).toBe(totalValue)
  expect(balances.reduce((sum, { qty_milli }) => sum + Number(qty_milli), 0)).toBe(totalQty)
  if (totalQty === 0) expect(totalValue).toBe(0)
}

describe.each(dialects(dir))('stock ledger on %s', (name, create) => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = create()
    await migrateToLatest(db)
    await db.insertInto('warehouses').values({ id: SECOND, name: SECOND, archived_at: null, created_at: 1 }).execute()
  })

  afterAll(() => db.destroy())

  it('seeds the main warehouse', async () => {
    expect((await referenceRepo(db, 'warehouses').find('main'))?.isSystem).toBe(true)
  })

  it('values issues at the moving average', async () => {
    const variantId = await addVariant(db)
    const ledger = stockLedger(db, context())
    await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 10_000, valueMinor: 1000 })
    await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 10_000, valueMinor: 2000 })

    expect(await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: -5000 })).toBe(-750)
    expect(Number((await stockOf(db, variantId))?.value_minor)).toBe(2250)
    await reconcile(db, variantId)
  })

  it('refuses to go below zero, saying how much is there', async () => {
    const variantId = await addVariant(db)
    const ledger = stockLedger(db, context())
    await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 3000, valueMinor: 300 })

    const error = await ledger
      .post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: -5000 })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(InsufficientStock)
    expect(error).toMatchObject({ availableMilli: 3000, requestedMilli: 5000 })
    await reconcile(db, variantId)
  })

  it('checks each warehouse and lot on its own', async () => {
    const variantId = await addVariant(db)
    const lot = await addLot(db, variantId, 'L1')
    const ledger = stockLedger(db, context())
    await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: lot, qtyMilli: 3000, valueMinor: 300 })

    await expect(ledger.post({ variantId, warehouseId: SECOND, lotId: lot, qtyMilli: -1000 })).rejects.toBeInstanceOf(InsufficientStock)
    await expect(ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: -1000 })).rejects.toBeInstanceOf(InsufficientStock)
  })

  it('allows going negative only when told to, and stays reconciled', async () => {
    const variantId = await addVariant(db, 50)
    const ledger = stockLedger(db, context({ allowNegative: true }))
    await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: -2000 })
    expect(Number((await stockOf(db, variantId))?.qty_milli)).toBe(-2000)
    await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 2000, valueMinor: 400 })
    await reconcile(db, variantId)
  })

  it('moves stock between warehouses without changing its value', async () => {
    const variantId = await addVariant(db)
    const ledger = stockLedger(db, context())
    await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 10_000, valueMinor: 1000 })
    await ledger.transfer({ variantId, lotId: null, qtyMilli: 4000, from: WAREHOUSE, to: SECOND })

    expect(Number((await stockOf(db, variantId))?.value_minor)).toBe(1000)
    const balances = await db.selectFrom('stock_balances').selectAll().where('variant_id', '=', variantId).execute()
    expect(Object.fromEntries(balances.map(({ warehouse_id, qty_milli }) => [warehouse_id, Number(qty_milli)]))).toEqual({
      main: 6000,
      second: 4000,
    })
    await reconcile(db, variantId)
  })

  it('reverses a document with new movements, leaving history intact', async () => {
    const variantId = await addVariant(db)
    const original = context()
    await stockLedger(db, original).post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 5000, valueMinor: 500 })
    await stockLedger(db, context({ documentId: 'void-1' })).reverse(original.documentId)

    const movements = await db.selectFrom('stock_movements').selectAll().where('variant_id', '=', variantId).execute()
    expect(movements).toHaveLength(2)
    expect(movements[1]?.reversal_of).toBe(movements[0]?.id)
    expect(Number((await stockOf(db, variantId))?.qty_milli)).toBe(0)
    await reconcile(db, variantId)
  })

  it('refuses a reversal that would leave stock negative', async () => {
    const variantId = await addVariant(db)
    const original = context()
    await stockLedger(db, original).post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 5000, valueMinor: 500 })
    await stockLedger(db, context()).post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: -3000 })

    await expect(stockLedger(db, context()).reverse(original.documentId)).rejects.toBeInstanceOf(InsufficientStock)
    await reconcile(db, variantId)
  })

  it('writes nothing when a transaction fails partway', async () => {
    const variantId = await addVariant(db)
    await stockLedger(db, context()).post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 1000, valueMinor: 100 })

    await db
      .transaction()
      .execute(async (trx) => {
        const ledger = stockLedger(trx, context())
        await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: -500 })
        await ledger.post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: -9000 })
      })
      .catch(() => {})

    expect(Number((await stockOf(db, variantId))?.qty_milli)).toBe(1000)
    await reconcile(db, variantId)
  })

  it('makes movements impossible to change, at the database level', async () => {
    const variantId = await addVariant(db)
    await stockLedger(db, context()).post({ variantId, warehouseId: WAREHOUSE, lotId: null, qtyMilli: 1000, valueMinor: 100 })

    await expect(sql`update stock_movements set qty_milli = 999 where variant_id = ${variantId}`.execute(db)).rejects.toThrow(/append-only/)
    await expect(sql`delete from stock_movements where variant_id = ${variantId}`.execute(db)).rejects.toThrow(/append-only/)
  })

  const operation = fc.oneof(
    fc.record({
      kind: fc.constant('in' as const),
      warehouse: fc.constantFrom(WAREHOUSE, SECOND),
      lot: fc.integer({ min: 0, max: 2 }),
      qty: fc.integer({ min: 1, max: 50_000 }),
      unitCost: fc.integer({ min: 0, max: 5000 }),
    }),
    fc.record({
      kind: fc.constant('out' as const),
      warehouse: fc.constantFrom(WAREHOUSE, SECOND),
      lot: fc.integer({ min: 0, max: 2 }),
      qty: fc.integer({ min: 1, max: 60_000 }),
    }),
    fc.record({
      kind: fc.constant('transfer' as const),
      from: fc.constantFrom(WAREHOUSE, SECOND),
      lot: fc.integer({ min: 0, max: 2 }),
      qty: fc.integer({ min: 1, max: 40_000 }),
    }),
    fc.record({ kind: fc.constant('void' as const), pick: fc.nat() }),
  )

  it(
    'keeps every total equal to the sum of its movements, through any sequence of operations',
    { timeout: 120_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(operation, { minLength: 5, maxLength: 25 }), async (operations) => {
          const variantId = await addVariant(db, 100)
          const lots = [null, await addLot(db, variantId, 'A'), await addLot(db, variantId, 'B')]
          const posted: string[] = []

          for (const step of operations) {
            const ctx = context()
            await db
              .transaction()
              .execute(async (trx) => {
                const inner = stockLedger(trx, ctx)
                if (step.kind === 'in') {
                  await inner.post({
                    variantId,
                    warehouseId: step.warehouse,
                    lotId: lots[step.lot] ?? null,
                    qtyMilli: step.qty,
                    valueMinor: Math.round((step.qty * step.unitCost) / 1000),
                  })
                } else if (step.kind === 'out') {
                  await inner.post({ variantId, warehouseId: step.warehouse, lotId: lots[step.lot] ?? null, qtyMilli: -step.qty })
                } else if (step.kind === 'transfer') {
                  await inner.transfer({
                    variantId,
                    lotId: lots[step.lot] ?? null,
                    qtyMilli: step.qty,
                    from: step.from,
                    to: step.from === WAREHOUSE ? SECOND : WAREHOUSE,
                  })
                } else if (posted.length > 0) {
                  await inner.reverse(posted[step.pick % posted.length]!)
                }
              })
              .then(() => {
                if (step.kind !== 'void') posted.push(ctx.documentId)
              })
              .catch((error: unknown) => {
                if (!(error instanceof InsufficientStock)) throw error
              })

            const negative = await db
              .selectFrom('stock_balances')
              .select('qty_milli')
              .where('variant_id', '=', variantId)
              .where('qty_milli', '<', 0)
              .execute()
            expect(negative).toEqual([])
          }

          await reconcile(db, variantId)
        }),
        { numRuns: name === 'sqlite' ? 60 : 12 },
      )
    },
  )
})

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CheckoutInput, Dashboard, Product, ProductInput, ProductStock, Sale, Session, ShiftSummary, StockDocument } from '@inv/contracts'
import { REPORT_ROWS, reportPageSchema, type ReportKey, type ReportRow } from '@inv/contracts'
import { addDays, businessDate } from '@inv/domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { OWNER, onboarded, type Harness } from './harness'

interface Context {
  harness: Harness
  session: string
}

const MAIN = 'main'
const RETAIL = 'retail'
const DAY_MS = 86_400_000

let requests = 0
const requestId = () => `report-${++requests}`

async function ready(openingCashMinor = 0): Promise<Context> {
  const { harness, owner } = await onboarded()
  const context = { harness, session: owner.token }
  await harness.json('POST', '/shifts', { session: owner.token, body: { openingCashMinor } })
  return context
}

async function addProduct({ harness, session }: Context, name: string, priceMinor = 1000, overrides: Partial<ProductInput> & { reorderLevelMilli?: number } = {}) {
  const { reorderLevelMilli, ...rest } = overrides
  const product = await harness.json<Product>('POST', '/products', {
    session,
    body: {
      name,
      baseUnitId: 'piece',
      prescriptionRequired: false,
      trackLots: false,
      trackSerials: false,
      conversions: [],
      variants: [
        {
          label: null,
          costMinor: 0,
          reorderLevelMilli: reorderLevelMilli ?? null,
          barcodes: [],
          prices: [{ unitId: 'piece', amountMinor: priceMinor, priceListId: RETAIL }],
          attributeValueIds: [],
        },
      ],
      ...rest,
    },
  })
  return { product, variantId: product.variants[0]!.id }
}

async function receive({ harness, session }: Context, variantId: string, qtyMilli: number, unitCostMinor: number, extra: object = {}) {
  const document = await harness.json<StockDocument>('POST', '/stock/documents', {
    session,
    body: { kind: 'adjustment', warehouseId: MAIN, reason: 'opening', lines: [{ variantId, unitId: 'piece', qtyMilli, unitCostMinor, ...extra }] },
  })
  await harness.json('POST', `/stock/documents/${document.id}/post`, { session })
}

const line = (variantId: string, qtyMilli: number, unitPriceMinor: number) => ({ variantId, unitId: 'piece', qtyMilli, unitPriceMinor, discountMinor: 0 })

const sell = ({ harness, session }: Context, lines: CheckoutInput['lines'], tenders: CheckoutInput['tenders'], extra: Partial<CheckoutInput> = {}) =>
  harness.json<Sale>('POST', '/sales', { session, body: { requestId: requestId(), lines, tenders, ...extra } })

const giveBack = ({ harness, session }: Context, sale: Sale, qtyMilli: number) =>
  harness.json<Sale>('POST', `/sales/${sale.id}/return`, {
    session,
    body: { requestId: requestId(), method: 'cash', lines: [{ saleLineId: sale.lines[0]!.id, qtyMilli }] },
  })

async function report<K extends ReportKey>({ harness, session }: Context, key: K, query = '', as = session) {
  const page = await harness.json<unknown>('GET', `/reports/${key}?limit=1000${query}`, { session: as })
  return reportPageSchema(REPORT_ROWS[key]).parse(page) as unknown as { items: ReportRow<K>[]; nextCursor: string | null; totals: Record<string, number | null> }
}

async function staff(context: Context, username: string, roleId: string): Promise<string> {
  const { harness, session } = context
  await harness.json('POST', '/users', { session, body: { fullName: 'موظف', username, password: 'temporary-password', roleId } })
  const login = await harness.json<Session>('POST', '/auth/login', { body: { username, password: 'temporary-password' } })
  await harness.json('POST', '/auth/change-password', {
    session: login.token,
    body: { currentPassword: 'temporary-password', newPassword: 'staff-password' },
  })
  return login.token
}

const today = ({ harness }: Context) => businessDate(harness.time.now)

/** Moves the clock on and signs in again, because a session doesn't outlive that many days. */
async function advance(context: Context, days: number): Promise<void> {
  context.harness.time.now += days * DAY_MS
  const login = await context.harness.json<Session>('POST', '/auth/login', { body: { username: OWNER.username, password: OWNER.password } })
  context.session = login.token
}

describe('the sales report', () => {
  it('nets returns off the day they happen, and leaves voids out entirely', async () => {
    const context = await ready()
    const { harness } = context
    const { variantId } = await addProduct(context, 'يوم', 1000)
    await receive(context, variantId, 20_000, 400)

    const first = await sell(context, [line(variantId, 5000, 1000)], [{ method: 'cash', amountMinor: 5000 }])
    const voided = await sell(context, [line(variantId, 2000, 1000)], [{ method: 'cash', amountMinor: 2000 }])
    await harness.json('POST', `/sales/${voided.id}/void`, { session: context.session })

    await advance(context, 1)
    await giveBack(context, first, 1000)

    const { items, totals } = await report(context, 'sales', `&from=${addDays(today(context), -7)}&to=${today(context)}`)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ date: today(context), salesCount: 0, returnsCount: 1, salesMinor: 0, returnsMinor: 1000, netMinor: -1000, costMinor: -400, profitMinor: -600 })
    expect(items[1]).toMatchObject({ salesCount: 1, salesMinor: 5000, netMinor: 5000, costMinor: 2000, profitMinor: 3000 })
    expect(totals).toMatchObject({ salesCount: 1, returnsCount: 1, netMinor: 4000, costMinor: 1600, profitMinor: 2400 })
  })

  it('respects the range', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'نطاق', 100)
    await receive(context, variantId, 5000, 10)
    await sell(context, [line(variantId, 1000, 100)], [{ method: 'cash', amountMinor: 100 }])

    const earlier = addDays(today(context), -3)
    expect((await report(context, 'sales', `&from=${addDays(earlier, -5)}&to=${earlier}`)).items).toEqual([])
    expect((await report(context, 'sales')).items).toHaveLength(1)
  })
})

describe('the items report', () => {
  it('ranks by net sales, classes them, and counts returns against the item', async () => {
    const context = await ready()
    const { variantId: big } = await addProduct(context, 'كبير', 9000)
    const { variantId: small } = await addProduct(context, 'صغير', 1000)
    await receive(context, big, 10_000, 3000)
    await receive(context, small, 10_000, 200)

    await sell(context, [line(small, 1000, 1000)], [{ method: 'cash', amountMinor: 1000 }])
    const sale = await sell(context, [line(big, 2000, 9000)], [{ method: 'cash', amountMinor: 18_000 }])
    await giveBack(context, sale, 1000)

    const { items, totals } = await report(context, 'items')
    expect(items.map(({ name, qtyMilli, salesMinor, costMinor, profitMinor, abc }) => [name, qtyMilli, salesMinor, costMinor, profitMinor, abc])).toEqual([
      ['كبير', 1000, 9000, 3000, 6000, 'A'],
      ['صغير', 1000, 1000, 200, 800, 'B'],
    ])
    expect(totals).toEqual({ salesMinor: 10_000, costMinor: 3200, profitMinor: 6800 })
  })
})

describe('voided documents', () => {
  it('leave the items report, the reorder figures and the dead stock check', async () => {
    const context = await ready()
    const { harness } = context
    const { variantId } = await addProduct(context, 'ملغي', 1000, { reorderLevelMilli: 100_000 })
    await receive(context, variantId, 20_000, 400)

    const sale = await sell(context, [line(variantId, 5000, 1000)], [{ method: 'cash', amountMinor: 5000 }])
    expect((await report(context, 'items')).items).toHaveLength(1)
    expect((await report(context, 'reorder')).items[0]).toMatchObject({ soldLastMonthMilli: 5000 })

    await harness.json('POST', `/sales/${sale.id}/void`, { session: context.session })

    expect((await report(context, 'items')).items).toEqual([])
    expect((await report(context, 'reorder')).items[0]).toMatchObject({ soldLastMonthMilli: 0 })
    await advance(context, 100)
    expect((await report(context, 'dead', '&days=90')).items[0]).toMatchObject({ name: 'ملغي', lastSoldOn: null })
  })
})

describe('who may see cost', () => {
  it('hides cost and profit behind their own permission, as nulls', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'سري', 1000)
    await receive(context, variantId, 5000, 400)
    await sell(context, [line(variantId, 1000, 1000)], [{ method: 'cash', amountMinor: 1000 }])

    const keeper = await staff(context, 'keeper', 'storekeeper')

    const sales = await report(context, 'sales', '', keeper)
    expect(sales.items[0]).toMatchObject({ netMinor: 1000, costMinor: null, profitMinor: null })
    expect(sales.totals).toMatchObject({ costMinor: null, profitMinor: null })

    expect((await report(context, 'items', '', keeper)).items[0]).toMatchObject({ costMinor: null, profitMinor: null })
    expect((await report(context, 'inventory', '', keeper)).items[0]).toMatchObject({ onHandMilli: 4000, averageCostMinor: null, valueMinor: null })
    expect((await report(context, 'movements', '', keeper)).items[0]).toMatchObject({ valueMinor: null })

    const dashboard = await context.harness.json<Dashboard>('GET', '/reports/dashboard', { session: keeper })
    expect(dashboard.today).toMatchObject({ netMinor: 1000, profitMinor: null })
  })

  it('keeps cashiers out of reports', async () => {
    const context = await ready()
    const cashier = await staff(context, 'till', 'cashier')
    expect((await context.harness.failure('GET', '/reports/sales', { session: cashier })).code).toBe('FORBIDDEN')
    expect((await context.harness.failure('GET', '/reports/dashboard', { session: cashier })).code).toBe('FORBIDDEN')
  })
})

describe('the stock reports', () => {
  it('values the shelf, and leaves out what ran to zero', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'قيمة', 1000)
    const { variantId: gone } = await addProduct(context, 'خلص', 1000)
    await receive(context, variantId, 4000, 250)
    await receive(context, gone, 1000, 100)
    await sell(context, [line(gone, 1000, 1000)], [{ method: 'cash', amountMinor: 1000 }])

    const { items, totals, nextCursor } = await report(context, 'inventory')
    expect(items.map(({ name, onHandMilli, averageCostMinor, valueMinor }) => [name, onHandMilli, averageCostMinor, valueMinor])).toEqual([['قيمة', 4000, 250, 1000]])
    expect(totals).toEqual({ valueMinor: 1000 })
    expect(nextCursor).toBeNull()
  })

  it('pages through the ledger without repeating a row', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'صفحات', 100)
    for (let index = 0; index < 5; index++) await receive(context, variantId, 1000, 10)

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const query: string = cursor ? `&cursor=${cursor}` : ''
      const page: { items: Array<{ id: string }>; nextCursor: string | null } = await harness.json('GET', `/reports/movements?limit=2${query}`, { session })
      seen.push(...page.items.map(({ id }) => id))
      cursor = page.nextCursor
    } while (cursor)

    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })

  it('suggests what to order from the level and a month of sales, and names the last supplier', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'ناقص', 100, { reorderLevelMilli: 10_000 })
    await addProduct(context, 'بدون حد', 100)
    const { variantId: full } = await addProduct(context, 'كافي', 100, { reorderLevelMilli: 2000 })
    await receive(context, full, 9000, 10)

    const supplier = await harness.json<{ id: string }>('POST', '/suppliers', { session, body: { name: 'النيل' } })
    const purchase = await harness.json<{ id: string }>('POST', '/purchases', {
      session,
      body: {
        kind: 'invoice',
        supplierId: supplier.id,
        warehouseId: MAIN,
        lines: [{ variantId, unitId: 'piece', qtyMilli: 40_000, unitCostMinor: 50, discountMinor: 0, taxRateBp: 0 }],
      },
    })
    await harness.json('POST', `/purchases/${purchase.id}/post`, { session })
    await sell(context, [line(variantId, 35_000, 100)], [{ method: 'cash', amountMinor: 3_500_000 / 100 }])

    const { items } = await report(context, 'reorder')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'ناقص', onHandMilli: 5000, levelMilli: 10_000, soldLastMonthMilli: 35_000, suggestedMilli: 30_000, supplier: 'النيل' })

    const dashboard = await harness.json<Dashboard>('GET', '/reports/dashboard', { session })
    expect(dashboard.alerts.lowStock).toBe(1)
  })

  it('lists batches running out, soonest first, and counts them on the dashboard', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'صلاحية', 100, { trackLots: true })
    const date = today(context)
    await receive(context, variantId, 1000, 10, { lotNo: 'LATER', expiryDate: addDays(date, 500) })
    await receive(context, variantId, 2000, 10, { lotNo: 'SOON', expiryDate: addDays(date, 30) })
    await receive(context, variantId, 3000, 10, { lotNo: 'DEAD', expiryDate: addDays(date, -5) })

    const { items } = await report(context, 'expiry', '&days=90')
    expect(items.map(({ lotNo, daysLeft, qtyMilli }) => [lotNo, daysLeft, qtyMilli])).toEqual([
      ['DEAD', -5, 3000],
      ['SOON', 30, 2000],
    ])

    const dashboard = await harness.json<Dashboard>('GET', '/reports/dashboard', { session })
    expect(dashboard.alerts).toMatchObject({ expired: 1, nearExpiry: 1 })
  })

  it('finds stock that stopped selling, and spares what sold recently', async () => {
    const context = await ready()
    const { variantId: moving } = await addProduct(context, 'ماشي', 100)
    const { variantId: still } = await addProduct(context, 'راكد', 100)
    const { variantId: past } = await addProduct(context, 'قديم', 100)
    await receive(context, moving, 5000, 10)
    await receive(context, still, 5000, 10)
    await receive(context, past, 5000, 10)
    await sell(context, [line(past, 1000, 100)], [{ method: 'cash', amountMinor: 100 }])
    const soldOn = today(context)

    await advance(context, 100)
    await sell(context, [line(moving, 1000, 100)], [{ method: 'cash', amountMinor: 100 }])

    const { items } = await report(context, 'dead', '&days=90')
    expect(items.map(({ name, lastSoldOn }) => [name, lastSoldOn]).sort()).toEqual(
      [
        ['راكد', null],
        ['قديم', soldOn],
      ].sort(),
    )
  })
})

describe('the account reports', () => {
  it('reads suppliers from their ledger, so a void nets out', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'شراء', 100)
    const supplier = await harness.json<{ id: string }>('POST', '/suppliers', { session, body: { name: 'مورد', openingBalanceMinor: 500 } })

    const buy = async (qtyMilli: number, paidMinor: number) => {
      const purchase = await harness.json<{ id: string }>('POST', '/purchases', {
        session,
        body: { kind: 'invoice', supplierId: supplier.id, warehouseId: MAIN, paidMinor, lines: [{ variantId, unitId: 'piece', qtyMilli, unitCostMinor: 1000, discountMinor: 0, taxRateBp: 0 }] },
      })
      await harness.json('POST', `/purchases/${purchase.id}/post`, { session })
      return purchase.id
    }

    await buy(2000, 500)
    const voided = await buy(1000, 0)
    await harness.json('POST', `/purchases/${voided}/void`, { session })

    const { items, totals } = await report(context, 'suppliers')
    expect(items[0]).toMatchObject({ name: 'مورد', purchasesMinor: 2000, paidMinor: 500, balanceMinor: 2000 })
    expect(totals).toMatchObject({ purchasesMinor: 2000, balanceMinor: 2000 })
  })

  it('reads customers the same way', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'عميل', 1000)
    await receive(context, variantId, 5000, 100)
    const customer = await harness.json<{ id: string }>('POST', '/customers', { session, body: { name: 'منى' } })

    await sell(context, [line(variantId, 2000, 1000)], [{ method: 'credit', amountMinor: 2000 }], { customerId: customer.id })
    await harness.json('POST', `/customers/${customer.id}/receipts`, { session, body: { amountMinor: 500, method: 'cash' } })

    expect((await report(context, 'customers')).items[0]).toMatchObject({ name: 'منى', salesMinor: 2000, collectedMinor: 500, balanceMinor: 1500 })
  })

  it('shows each shift with its sales and its difference', async () => {
    const context = await ready(1000)
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'وردية', 1000)
    await receive(context, variantId, 5000, 100)
    await sell(context, [line(variantId, 1000, 1000)], [{ method: 'cash', amountMinor: 1000 }])

    const shift = (await harness.json<{ shift: ShiftSummary }>('GET', '/shifts/current', { session })).shift
    await harness.json('POST', `/shifts/${shift.id}/close`, { session, body: { countedCashMinor: 1900 } })

    expect((await report(context, 'shifts')).items[0]).toMatchObject({ number: 'SH-000001', salesMinor: 1000, expectedCashMinor: 2000, countedCashMinor: 1900, differenceMinor: -100 })
  })
})

describe('the dashboard', () => {
  it('shows fourteen days, with today last and empty days as zero', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'لوحة', 1000)
    await receive(context, variantId, 5000, 100)
    const sale = await sell(context, [line(variantId, 3000, 1000)], [{ method: 'cash', amountMinor: 3000 }])
    await giveBack(context, sale, 1000)

    const dashboard = await harness.json<Dashboard>('GET', '/reports/dashboard', { session })
    expect(dashboard.days).toHaveLength(14)
    expect(dashboard.days.at(-1)).toEqual({ date: today(context), netMinor: 2000 })
    expect(dashboard.days[0]!.netMinor).toBe(0)
    expect(dashboard.today).toEqual({ salesCount: 1, netMinor: 2000, returnsMinor: 1000, profitMinor: 1800 })
  })
})

describe('exporting', () => {
  it('writes the report to a spreadsheet and records it', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'تصدير', 1000)
    await receive(context, variantId, 5000, 100)
    await sell(context, [line(variantId, 1000, 1000)], [{ method: 'cash', amountMinor: 1000 }])

    const dir = mkdtempSync(join(tmpdir(), 'inv-export-'))
    const destination = join(dir, 'sales.xlsx')
    try {
      const saved = await harness.json<{ rows: number }>('POST', '/reports/sales/export', {
        session,
        body: {
          destination,
          rightToLeft: true,
          columns: [
            { key: 'date', label: 'التاريخ', kind: 'text' },
            { key: 'netMinor', label: 'الصافي', kind: 'money' },
          ],
        },
      })
      expect(saved.rows).toBe(1)
      expect(statSync(destination).size).toBeGreaterThan(1000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('whatever happens in the shop', () => {
  const action = fc.oneof(
    fc.record({ type: fc.constant('sell' as const), qty: fc.integer({ min: 1, max: 4 }), discount: fc.integer({ min: 0, max: 100 }) }),
    fc.record({ type: fc.constant('return' as const), pick: fc.nat(), qty: fc.integer({ min: 1, max: 3 }) }),
    fc.record({ type: fc.constant('void' as const), pick: fc.nat() }),
    fc.record({ type: fc.constant('receive' as const), qty: fc.integer({ min: 1, max: 5 }), cost: fc.integer({ min: 50, max: 400 }) }),
    fc.record({ type: fc.constant('nextDay' as const) }),
  )

  it('the reports always agree with the movements and the money', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 14 }), async (actions) => {
        const context = await ready()
        const { harness } = context
        const { product, variantId } = await addProduct(context, 'مطابقة', 333)
        await receive(context, variantId, 30_000, 111)
        const startedOn = today(context)
        const open: Sale[] = []

        for (const step of actions) {
          if (step.type === 'nextDay') await advance(context, 1)
          if (step.type === 'receive') await receive(context, variantId, step.qty * 1000, step.cost)
          if (step.type === 'sell') {
            const total = step.qty * 333 - step.discount
            open.push(await sell(context, [line(variantId, step.qty * 1000, 333)], [{ method: 'cash', amountMinor: total }], { discountMinor: step.discount }))
          }
          if (step.type === 'return' && open.length > 0) {
            const sale = await harness.json<Sale>('GET', `/sales/${open[step.pick % open.length]!.id}`, { session: context.session })
            const left = sale.lines[0]!.baseQtyMilli - sale.lines[0]!.returnedBaseMilli
            if (left > 0) await giveBack(context, sale, Math.min(step.qty * 1000, left))
          }
          if (step.type === 'void' && open.length > 0) {
            const index = step.pick % open.length
            const sale = await harness.json<Sale>('GET', `/sales/${open[index]!.id}`, { session: context.session })
            if (sale.lines[0]!.returnedBaseMilli === 0) {
              await harness.json('POST', `/sales/${sale.id}/void`, { session: context.session })
              open.splice(index, 1)
            }
          }
        }

        const range = `&from=${startedOn}&to=${today(context)}`
        const sales = await report(context, 'sales', range)
        const items = await report(context, 'items', range)
        const inventory = await report(context, 'inventory')
        const stock = (await harness.json<ProductStock>('GET', `/products/${product.id}/stock`, { session: context.session })).variants[0]!

        const { db } = harness.deps
        const issued = await db
          .selectFrom('stock_movements')
          .select((eb) => eb.fn.sum<number>('value_minor').as('value'))
          .where('document_type', 'in', ['sale', 'sale_return'])
          .executeTakeFirstOrThrow()
        const paid = await db
          .selectFrom('sale_payments')
          .select((eb) => eb.fn.sum<number>('amount_minor').as('amount'))
          .executeTakeFirstOrThrow()

        // Cost of goods sold is what actually left the ledger, reversals included.
        expect(sales.totals.costMinor).toBe(0 - Number(issued.value ?? 0))
        // Net sales is the money that stayed in the drawer.
        expect(sales.totals.netMinor).toBe(Number(paid.amount ?? 0))
        // The per-item and per-day views are two cuts of the same thing.
        expect(items.totals.salesMinor).toBe(sales.totals.netMinor)
        expect(items.totals.costMinor).toBe(sales.totals.costMinor)
        // What is on the shelf is what the movements add up to.
        expect(inventory.totals.valueMinor ?? 0).toBe(stock.onHandMilli === 0 ? 0 : stock.valueMinor)
      }),
      { numRuns: 8 },
    )
  })
})

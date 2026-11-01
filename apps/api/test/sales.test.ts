import type {
  CheckoutInput,
  Customer,
  CustomerEntry,
  HeldSale,
  PosItem,
  Product,
  ProductInput,
  ProductStock,
  Receipt,
  Sale,
  Session,
  ShiftRow,
  ShiftSummary,
  StockDocument,
} from '@inv/contracts'
import { gs1CheckDigit } from '@inv/domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { onboarded, type Harness } from './harness'

interface Context {
  harness: Harness
  session: string
}

const MAIN = 'main'
const RETAIL = 'retail'

let requests = 0
const requestId = () => `request-${++requests}`

async function store(): Promise<Context> {
  const { harness, owner } = await onboarded()
  return { harness, session: owner.token }
}

interface ProductOptions {
  priceMinor?: number
  barcode?: string
  overrides?: Partial<ProductInput>
  prices?: Array<{ unitId: string; amountMinor: number }>
}

async function addProduct({ harness, session }: Context, name: string, options: ProductOptions = {}) {
  const prices = options.prices ?? [{ unitId: 'piece', amountMinor: options.priceMinor ?? 1000 }]
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
          barcodes: options.barcode ? [{ code: options.barcode, unitId: 'piece' }] : [],
          prices: prices.map((price) => ({ ...price, priceListId: RETAIL })),
          attributeValueIds: [],
        },
      ],
      ...options.overrides,
    },
  })
  return { product, variantId: product.variants[0]!.id }
}

async function receive({ harness, session }: Context, variantId: string, qtyMilli: number, unitCostMinor: number, extra: object = {}) {
  const document = await harness.json<StockDocument>('POST', '/stock/documents', {
    session,
    body: {
      kind: 'adjustment',
      warehouseId: MAIN,
      reason: 'opening',
      lines: [{ variantId, unitId: 'piece', qtyMilli, unitCostMinor, ...extra }],
    },
  })
  await harness.json('POST', `/stock/documents/${document.id}/post`, { session })
}

const openShift = ({ harness, session }: Context, openingCashMinor = 0, as = session) =>
  harness.json<ShiftSummary>('POST', '/shifts', { session: as, body: { openingCashMinor } })

const currentShift = async ({ harness, session }: Context) =>
  (await harness.json<{ shift: ShiftSummary | null }>('GET', '/shifts/current', { session })).shift

const saleLine = (variantId: string, qtyMilli: number, unitPriceMinor: number, extra: object = {}) => ({
  variantId,
  unitId: 'piece',
  qtyMilli,
  unitPriceMinor,
  discountMinor: 0,
  ...extra,
})

const checkoutBody = (lines: CheckoutInput['lines'], tenders: CheckoutInput['tenders'], extra: Partial<CheckoutInput> = {}) => ({
  requestId: requestId(),
  lines,
  tenders,
  ...extra,
})

const sell = ({ harness, session }: Context, lines: CheckoutInput['lines'], tenders: CheckoutInput['tenders'], extra: Partial<CheckoutInput> = {}, as = session) =>
  harness.json<Sale>('POST', '/sales', { session: as, body: checkoutBody(lines, tenders, extra) })

const refuse = ({ harness, session }: Context, lines: CheckoutInput['lines'], tenders: CheckoutInput['tenders'], extra: Partial<CheckoutInput> = {}, as = session) =>
  harness.failure('POST', '/sales', { session: as, body: checkoutBody(lines, tenders, extra) })

const giveBack = ({ harness, session }: Context, saleId: string, lines: object[], method = 'cash') =>
  harness.json<Sale>('POST', `/sales/${saleId}/return`, { session, body: { requestId: requestId(), method, lines } })

const voidSale = ({ harness, session }: Context, saleId: string) => harness.json<Sale>('POST', `/sales/${saleId}/void`, { session })

async function stockOf({ harness, session }: Context, productId: string) {
  const stock = await harness.json<ProductStock>('GET', `/products/${productId}/stock`, { session })
  return stock.variants[0]!
}

const addCustomer = ({ harness, session }: Context, name: string, extra: object = {}) =>
  harness.json<Customer>('POST', '/customers', { session, body: { name, ...extra } })

const customerOf = ({ harness, session }: Context, id: string) => harness.json<Customer>('GET', `/customers/${id}`, { session })

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

async function ready(openingCashMinor = 0): Promise<Context> {
  const context = await store()
  await openShift(context, openingCashMinor)
  return context
}

describe('selling', () => {
  it('takes stock, keeps the moving average, and gives change', async () => {
    const context = await ready()
    const { product, variantId } = await addProduct(context, 'بيع', { priceMinor: 1500 })
    await receive(context, variantId, 10_000, 1000)

    const sale = await sell(context, [saleLine(variantId, 2000, 1500)], [{ method: 'cash', amountMinor: 5000 }])

    expect(sale).toMatchObject({ number: 'INV-000001', totalMinor: 3000, tenderedMinor: 5000, changeMinor: 2000, status: 'posted' })
    expect(sale.payments).toEqual([expect.objectContaining({ method: 'cash', amountMinor: 3000 })])
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 8000, valueMinor: 8000 })
  })

  it('keeps tax inside the shelf price', async () => {
    const context = await ready()
    const { harness, session } = context
    const taxes = await harness.json<{ items: Array<{ id: string; rateBp?: number }> }>('GET', '/catalog/tax-rates', { session })
    const vat = taxes.items.find(({ rateBp }) => rateBp === 1400)!
    const { variantId } = await addProduct(context, 'ضريبة', { priceMinor: 11_400, overrides: { taxRateId: vat.id } })
    await receive(context, variantId, 1000, 1000)

    const sale = await sell(context, [saleLine(variantId, 1000, 11_400)], [{ method: 'cash', amountMinor: 11_400 }])
    expect(sale).toMatchObject({ totalMinor: 11_400, taxMinor: 1400 })
  })

  it('sells the nearest expiry first and never an expired batch', async () => {
    const context = await ready()
    const { product, variantId } = await addProduct(context, 'دواء', { priceMinor: 500, overrides: { trackLots: true } })
    await receive(context, variantId, 3000, 100, { lotNo: 'LATE', expiryDate: '2099-01-01' })
    await receive(context, variantId, 3000, 100, { lotNo: 'SOON', expiryDate: '2090-01-01' })
    await receive(context, variantId, 3000, 100, { lotNo: 'DEAD', expiryDate: '2001-01-01' })

    const sale = await sell(context, [saleLine(variantId, 4000, 500)], [{ method: 'cash', amountMinor: 2000 }])
    expect(sale.lines[0]!.lots.map(({ lotNo, qtyMilli }) => [lotNo, qtyMilli])).toEqual([
      ['SOON', 3000],
      ['LATE', 1000],
    ])

    const failure = await refuse(context, [saleLine(variantId, 3000, 500)], [{ method: 'cash', amountMinor: 1500 }])
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
    expect(failure.params).toMatchObject({ item: 'دواء', available: '2', requested: '3' })
    expect((await stockOf(context, product.id)).onHandMilli).toBe(5000)
  })

  it('refuses a chosen batch that has expired', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'منتهي', { priceMinor: 500, overrides: { trackLots: true } })
    await receive(context, variantId, 3000, 100, { lotNo: 'DEAD', expiryDate: '2001-01-01' })
    const { items } = await harness.json<{ items: PosItem[] }>('GET', '/pos/lookup?search=%D9%85%D9%86%D8%AA%D9%87%D9%8A', { session })

    const failure = await refuse(context, [saleLine(variantId, 1000, 500, { lotId: items[0]!.lots[0]!.lotId })], [{ method: 'cash', amountMinor: 500 }])
    expect(failure.fields).toEqual({ 'lines.0.lotId': ['LOT_EXPIRED'] })
  })

  it('does not ring the same request up twice', async () => {
    const context = await ready()
    const { harness, session } = context
    const { product, variantId } = await addProduct(context, 'مكرر', { priceMinor: 100 })
    await receive(context, variantId, 5000, 50)

    const body = checkoutBody([saleLine(variantId, 1000, 100)], [{ method: 'cash', amountMinor: 100 }])
    const first = await harness.json<Sale>('POST', '/sales', { session, body })
    const second = await harness.json<Sale>('POST', '/sales', { session, body })

    expect(second.id).toBe(first.id)
    expect((await stockOf(context, product.id)).onHandMilli).toBe(4000)
  })

  it('rolls everything back when a later line fails, and returns the number', async () => {
    const context = await ready()
    const { product, variantId } = await addProduct(context, 'كافي', { priceMinor: 100 })
    const { variantId: empty } = await addProduct(context, 'فاضي', { priceMinor: 100 })
    await receive(context, variantId, 5000, 50)

    const failure = await refuse(
      context,
      [saleLine(variantId, 1000, 100), saleLine(empty, 1000, 100)],
      [{ method: 'cash', amountMinor: 200 }],
    )
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
    expect((await stockOf(context, product.id)).onHandMilli).toBe(5000)

    const sale = await sell(context, [saleLine(variantId, 1000, 100)], [{ method: 'cash', amountMinor: 100 }])
    expect(sale.number).toBe('INV-000001')
  })

  it('checks payment before anything moves', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'دفع', { priceMinor: 1000 })
    await receive(context, variantId, 5000, 100)
    const line = [saleLine(variantId, 1000, 1000)]

    expect((await refuse(context, line, [{ method: 'cash', amountMinor: 999 }])).code).toBe('PAYMENT_SHORT')
    expect((await refuse(context, line, [{ method: 'card', amountMinor: 1001 }])).code).toBe('PAYMENT_OVER_TOTAL')
    expect((await refuse(context, line, [{ method: 'credit', amountMinor: 1000 }])).code).toBe('CREDIT_NEEDS_CUSTOMER')
    expect((await refuse(context, [], [{ method: 'cash', amountMinor: 0 }])).code).toBe('DOCUMENT_EMPTY')
  })

  it('splits a mixed payment and puts the credit part on the customer', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'مختلط', { priceMinor: 10_000 })
    await receive(context, variantId, 5000, 100)
    const customer = await addCustomer(context, 'أحمد', { creditLimitMinor: 5000 })

    const sale = await sell(
      context,
      [saleLine(variantId, 1000, 10_000)],
      [
        { method: 'cash', amountMinor: 3000 },
        { method: 'card', amountMinor: 4000 },
        { method: 'credit', amountMinor: 3000 },
      ],
      { customerId: customer.id },
    )

    expect(sale.payments.map(({ method, amountMinor }) => [method, amountMinor]).sort()).toEqual([
      ['card', 4000],
      ['cash', 3000],
      ['credit', 3000],
    ])
    expect((await customerOf(context, customer.id)).balanceMinor).toBe(3000)

    const failure = await refuse(context, [saleLine(variantId, 1000, 10_000)], [{ method: 'credit', amountMinor: 10_000 }], { customerId: customer.id })
    expect(failure.code).toBe('CREDIT_LIMIT_EXCEEDED')
  })

  it('needs a shift, and the cashier has to be the one holding it', async () => {
    const context = await store()
    const { variantId } = await addProduct(context, 'وردية', { priceMinor: 100 })
    await receive(context, variantId, 5000, 50)
    const line = [saleLine(variantId, 1000, 100)]
    const cash = [{ method: 'cash' as const, amountMinor: 100 }]

    expect((await refuse(context, line, cash)).code).toBe('SHIFT_NOT_OPEN')

    const cashier = await staff(context, 'till', 'cashier')
    await openShift(context, 0, cashier)
    const failure = await refuse(context, line, cash)
    expect(failure.code).toBe('SHIFT_OTHER_USER')
    expect(failure.params).toEqual({ name: 'موظف' })
    expect((await sell(context, line, cash, {}, cashier)).totalMinor).toBe(100)
  })

  it('leaves price and discount decisions to those allowed to make them', async () => {
    const context = await store()
    const { variantId } = await addProduct(context, 'صلاحية', { priceMinor: 1000 })
    await receive(context, variantId, 5000, 100)
    const cashier = await staff(context, 'till', 'cashier')
    await openShift(context, 0, cashier)
    const cash = [{ method: 'cash' as const, amountMinor: 1000 }]

    const price = await refuse(context, [saleLine(variantId, 1000, 900)], cash, {}, cashier)
    expect(price.fields).toEqual({ 'lines.0.unitPriceMinor': ['PRICE_CHANGE_FORBIDDEN'] })

    const line = await refuse(context, [saleLine(variantId, 1000, 1000, { discountMinor: 100 })], cash, {}, cashier)
    expect(line.fields).toEqual({ 'lines.0.discountMinor': ['DISCOUNT_FORBIDDEN'] })

    const invoice = await refuse(context, [saleLine(variantId, 1000, 1000)], cash, { discountMinor: 100 }, cashier)
    expect(invoice.fields).toEqual({ discountMinor: ['DISCOUNT_FORBIDDEN'] })
  })

  it('refuses a discount bigger than what is being sold', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'خصم', { priceMinor: 1000 })
    await receive(context, variantId, 5000, 100)
    const cash = [{ method: 'cash' as const, amountMinor: 1000 }]

    const line = await refuse(context, [saleLine(variantId, 1000, 1000, { discountMinor: 1001 })], cash)
    expect(line.fields).toEqual({ 'lines.0.discountMinor': ['DISCOUNT_TOO_LARGE'] })
    const invoice = await refuse(context, [saleLine(variantId, 1000, 1000)], cash, { discountMinor: 1001 })
    expect(invoice.fields).toEqual({ discountMinor: ['DISCOUNT_TOO_LARGE'] })
  })

  it('sells a larger unit at its own price and takes the right amount of stock', async () => {
    const context = await ready()
    const { product, variantId } = await addProduct(context, 'علبة', {
      prices: [
        { unitId: 'piece', amountMinor: 100 },
        { unitId: 'box', amountMinor: 900 },
      ],
      overrides: { conversions: [{ unitId: 'box', factorMilli: 10_000 }] },
    })
    await receive(context, variantId, 25_000, 10)

    const sale = await sell(context, [saleLine(variantId, 2000, 900, { unitId: 'box' })], [{ method: 'cash', amountMinor: 1800 }])
    expect(sale.totalMinor).toBe(1800)
    expect(sale.lines[0]!.baseQtyMilli).toBe(20_000)
    expect((await stockOf(context, product.id)).onHandMilli).toBe(5000)
  })

  it('tracks serials from sale to return', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'موبايل', { priceMinor: 500_000, overrides: { trackSerials: true } })
    const supplier = await harness.json<{ id: string }>('POST', '/suppliers', { session, body: { name: 'مورد' } })
    const purchase = await harness.json<{ id: string }>('POST', '/purchases', {
      session,
      body: {
        kind: 'invoice',
        supplierId: supplier.id,
        warehouseId: MAIN,
        lines: [{ variantId, unitId: 'piece', qtyMilli: 2000, unitCostMinor: 300_000, discountMinor: 0, taxRateBp: 0, serials: ['A1', 'A2'] }],
      },
    })
    await harness.json('POST', `/purchases/${purchase.id}/post`, { session })

    const line = saleLine(variantId, 1000, 500_000)
    const cash = [{ method: 'cash' as const, amountMinor: 500_000 }]
    expect((await refuse(context, [line], cash)).fields).toEqual({ 'lines.0.serials': ['SERIAL_COUNT_MISMATCH'] })
    expect((await refuse(context, [{ ...line, serials: ['Z9'] }], cash)).fields).toEqual({ 'lines.0.serials': ['SERIAL_NOT_IN_STOCK'] })

    const sale = await sell(context, [{ ...line, serials: ['A1'] }], cash)
    expect((await refuse(context, [{ ...line, serials: ['A1'] }], cash)).fields).toEqual({ 'lines.0.serials': ['SERIAL_NOT_IN_STOCK'] })

    const voided = await harness.failure('POST', `/purchases/${purchase.id}/void`, { session })
    expect(voided.code).toBe('SERIAL_ALREADY_SOLD')

    const failure = await harness.failure('POST', `/sales/${sale.id}/return`, {
      session,
      body: { requestId: requestId(), method: 'cash', lines: [{ saleLineId: sale.lines[0]!.id, qtyMilli: 1000, serials: ['A2'] }] },
    })
    expect(failure.fields).toEqual({ 'lines.0.serials': ['SERIAL_NOT_ON_SALE'] })

    await giveBack(context, sale.id, [{ saleLineId: sale.lines[0]!.id, qtyMilli: 1000, serials: ['A1'] }])
    expect((await sell(context, [{ ...line, serials: ['A1'] }], cash)).status).toBe('posted')
  })
})

describe('looking items up at the till', () => {
  it('finds a barcode with its prices', async () => {
    const context = await ready()
    const { harness, session } = context
    await addProduct(context, 'باركود', { priceMinor: 750, barcode: '4006381333931' })

    const { items } = await harness.json<{ items: PosItem[] }>('GET', '/pos/lookup?search=4006381333931', { session })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ productName: 'باركود', prices: [{ unitId: 'piece', amountMinor: 750 }], scaleQtyMilli: null })
  })

  it('reads the weight off a scale label', async () => {
    const context = await ready()
    const { harness, session } = context
    await addProduct(context, 'جبنة', { priceMinor: 20_000, barcode: '2123456' })
    const body = '212345601250'
    const label = body + String(gs1CheckDigit(body))

    const { items } = await harness.json<{ items: PosItem[] }>('GET', `/pos/lookup?search=${label}`, { session })
    expect(items[0]).toMatchObject({ productName: 'جبنة', scaleQtyMilli: 1250 })
  })
})

describe('returns', () => {
  it('gives back what the line really cost after an invoice discount', async () => {
    const context = await ready()
    const { product, variantId } = await addProduct(context, 'مرتجع', { priceMinor: 1000 })
    await receive(context, variantId, 10_000, 400)

    const sale = await sell(context, [saleLine(variantId, 4000, 1000)], [{ method: 'cash', amountMinor: 3600 }], { discountMinor: 400 })
    expect(sale.lines[0]!.totalMinor).toBe(3600)

    const returned = await giveBack(context, sale.id, [{ saleLineId: sale.lines[0]!.id, qtyMilli: 1000 }])
    expect(returned).toMatchObject({ kind: 'return', number: 'RET-000001', totalMinor: 900, returnOfNumber: 'INV-000001' })
    expect(returned.payments[0]).toMatchObject({ method: 'cash', amountMinor: -900 })
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 7000, valueMinor: 2800 })
  })

  it('adds back up exactly when a line comes back in pieces', async () => {
    const context = await ready()
    const { product, variantId } = await addProduct(context, 'قطع', { priceMinor: 1000 })
    await receive(context, variantId, 3000, 333)

    const sale = await sell(context, [saleLine(variantId, 3000, 1000)], [{ method: 'cash', amountMinor: 2900 }], { discountMinor: 100 })
    const lineId = sale.lines[0]!.id

    const refunds = []
    for (let piece = 0; piece < 3; piece++) {
      refunds.push((await giveBack(context, sale.id, [{ saleLineId: lineId, qtyMilli: 1000 }])).totalMinor)
    }
    expect(refunds.reduce((sum, value) => sum + value, 0)).toBe(2900)
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 3000, valueMinor: 999 })
  })

  it('refuses more than was sold, counting what already came back', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'حد', { priceMinor: 100 })
    await receive(context, variantId, 5000, 50)
    const sale = await sell(context, [saleLine(variantId, 2000, 100)], [{ method: 'cash', amountMinor: 200 }])
    const saleLineId = sale.lines[0]!.id

    await giveBack(context, sale.id, [{ saleLineId, qtyMilli: 1500 }])
    const failure = await harness.failure('POST', `/sales/${sale.id}/return`, {
      session,
      body: { requestId: requestId(), method: 'cash', lines: [{ saleLineId, qtyMilli: 1000 }] },
    })
    expect(failure.fields).toEqual({ 'lines.0.qtyMilli': ['RETURN_EXCEEDS_SALE'] })
  })

  it('puts stock back in the batch it left', async () => {
    const context = await ready()
    const { harness, session } = context
    const { product, variantId } = await addProduct(context, 'دفعات', { priceMinor: 500, overrides: { trackLots: true } })
    await receive(context, variantId, 2000, 100, { lotNo: 'A', expiryDate: '2090-01-01' })
    await receive(context, variantId, 2000, 100, { lotNo: 'B', expiryDate: '2095-01-01' })

    const sale = await sell(context, [saleLine(variantId, 3000, 500)], [{ method: 'cash', amountMinor: 1500 }])
    await giveBack(context, sale.id, [{ saleLineId: sale.lines[0]!.id, qtyMilli: 3000 }])

    const stock = await harness.json<ProductStock>('GET', `/products/${product.id}/stock`, { session })
    const lots = Object.fromEntries(stock.variants[0]!.balances.map(({ lotNo, qtyMilli }) => [lotNo, qtyMilli]))
    expect(lots).toEqual({ A: 2000, B: 2000 })
  })

  it('credits the account when the sale was on credit', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'آجل', { priceMinor: 1000 })
    await receive(context, variantId, 5000, 100)
    const customer = await addCustomer(context, 'منى')

    const sale = await sell(context, [saleLine(variantId, 2000, 1000)], [{ method: 'credit', amountMinor: 2000 }], { customerId: customer.id })
    expect((await customerOf(context, customer.id)).balanceMinor).toBe(2000)

    await giveBack(context, sale.id, [{ saleLineId: sale.lines[0]!.id, qtyMilli: 1000 }], 'credit')
    expect((await customerOf(context, customer.id)).balanceMinor).toBe(1000)
  })

  it('cannot credit a walk-in customer', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'نقدي', { priceMinor: 1000 })
    await receive(context, variantId, 5000, 100)
    const sale = await sell(context, [saleLine(variantId, 1000, 1000)], [{ method: 'cash', amountMinor: 1000 }])

    const failure = await harness.failure('POST', `/sales/${sale.id}/return`, {
      session,
      body: { requestId: requestId(), method: 'credit', lines: [{ saleLineId: sale.lines[0]!.id, qtyMilli: 1000 }] },
    })
    expect(failure.code).toBe('CREDIT_NEEDS_CUSTOMER')
  })
})

describe('voiding', () => {
  it('reverses stock, the account and the drawer, and stays on record', async () => {
    const context = await ready(1000)
    const { product, variantId } = await addProduct(context, 'إلغاء', { priceMinor: 1000 })
    await receive(context, variantId, 5000, 400)
    const customer = await addCustomer(context, 'سامي')

    const sale = await sell(
      context,
      [saleLine(variantId, 2000, 1000)],
      [
        { method: 'cash', amountMinor: 1500 },
        { method: 'credit', amountMinor: 500 },
      ],
      { customerId: customer.id },
    )
    expect((await currentShift(context))!.expectedCashMinor).toBe(2500)

    const voided = await voidSale(context, sale.id)
    expect(voided.status).toBe('voided')
    expect(voided.payments.filter(({ reversal }) => reversal)).toHaveLength(2)
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 5000, valueMinor: 2000 })
    expect((await customerOf(context, customer.id)).balanceMinor).toBe(0)
    expect((await currentShift(context))!.expectedCashMinor).toBe(1000)

    expect((await context.harness.failure('POST', `/sales/${sale.id}/void`, { session: context.session })).code).toBe('SALE_ALREADY_VOIDED')
  })

  it('refuses while a return stands, and allows it once the return is voided', async () => {
    const context = await ready()
    const { product, variantId } = await addProduct(context, 'مرتبط', { priceMinor: 1000 })
    await receive(context, variantId, 5000, 100)
    const sale = await sell(context, [saleLine(variantId, 2000, 1000)], [{ method: 'cash', amountMinor: 2000 }])
    const returned = await giveBack(context, sale.id, [{ saleLineId: sale.lines[0]!.id, qtyMilli: 1000 }])

    expect((await context.harness.failure('POST', `/sales/${sale.id}/void`, { session: context.session })).code).toBe('SALE_HAS_RETURNS')

    await voidSale(context, returned.id)
    const refreshed = await context.harness.json<Sale>('GET', `/sales/${sale.id}`, { session: context.session })
    expect(refreshed.lines[0]).toMatchObject({ returnedBaseMilli: 0, refundedMinor: 0 })

    await voidSale(context, sale.id)
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 5000, valueMinor: 500 })
  })

  it('is closed to a cashier', async () => {
    const context = await store()
    const { variantId } = await addProduct(context, 'كاشير', { priceMinor: 100 })
    await receive(context, variantId, 5000, 50)
    const cashier = await staff(context, 'till', 'cashier')
    await openShift(context, 0, cashier)
    const sale = await sell(context, [saleLine(variantId, 1000, 100)], [{ method: 'cash', amountMinor: 100 }], {}, cashier)

    expect((await context.harness.failure('POST', `/sales/${sale.id}/void`, { session: cashier })).code).toBe('FORBIDDEN')
  })
})

describe('shifts', () => {
  it('allows one open shift at a time', async () => {
    const context = await ready()
    expect((await context.harness.failure('POST', '/shifts', { session: context.session, body: { openingCashMinor: 0 } })).code).toBe('SHIFT_ALREADY_OPEN')
  })

  it('reconciles the drawer on close and reports the difference', async () => {
    const context = await ready(10_000)
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'درج', { priceMinor: 1000 })
    await receive(context, variantId, 10_000, 100)

    const sale = await sell(context, [saleLine(variantId, 3000, 1000)], [{ method: 'cash', amountMinor: 3000 }])
    await sell(context, [saleLine(variantId, 2000, 1000)], [{ method: 'card', amountMinor: 2000 }])
    await giveBack(context, sale.id, [{ saleLineId: sale.lines[0]!.id, qtyMilli: 1000 }])
    await harness.json('POST', '/shifts/current/cash', { session, body: { kind: 'in', amountMinor: 500, reason: 'فكة' } })
    await harness.json('POST', '/shifts/current/cash', { session, body: { kind: 'out', amountMinor: 700, reason: 'مصروف' } })

    const shift = (await currentShift(context))!
    expect(shift).toMatchObject({
      expectedCashMinor: 11_800,
      salesCount: 2,
      returnsCount: 1,
      salesMinor: 5000,
      returnsMinor: 1000,
      cashInMinor: 500,
      cashOutMinor: 700,
    })
    expect(shift.byMethod.find(({ method }) => method === 'card')?.amountMinor).toBe(2000)

    const closed = await harness.json<ShiftSummary>('POST', `/shifts/${shift.id}/close`, { session, body: { countedCashMinor: 11_750 } })
    expect(closed).toMatchObject({ status: 'closed', expectedCashMinor: 11_800, countedCashMinor: 11_750, differenceMinor: -50 })

    expect(await currentShift(context)).toBeNull()
    expect((await harness.failure('POST', `/shifts/${shift.id}/close`, { session, body: { countedCashMinor: 0 } })).code).toBe('SHIFT_NOT_OPEN')

    const { items } = await harness.json<{ items: ShiftRow[] }>('GET', '/shifts', { session })
    expect(items[0]).toMatchObject({ number: 'SH-000001', differenceMinor: -50 })
  })

  it('lets a manager close someone else\'s shift, but not another cashier', async () => {
    const context = await store()
    const { harness, session } = context
    const first = await staff(context, 'till', 'cashier')
    const second = await staff(context, 'till2', 'cashier')
    const shift = await openShift(context, 0, first)

    const failure = await harness.failure('POST', `/shifts/${shift.id}/close`, { session: second, body: { countedCashMinor: 0 } })
    expect(failure.code).toBe('SHIFT_OTHER_USER')
    await harness.json('POST', `/shifts/${shift.id}/close`, { session, body: { countedCashMinor: 0 } })
  })
})

describe('customers', () => {
  it('collects money into the drawer and can take it back', async () => {
    const context = await ready()
    const { harness, session } = context
    const customer = await addCustomer(context, 'عميل', { openingBalanceMinor: 5000 })

    const receipt = await harness.json<Receipt>('POST', `/customers/${customer.id}/receipts`, {
      session,
      body: { amountMinor: 2000, method: 'cash' },
    })
    expect(receipt.number).toBe('RCT-000001')
    expect((await customerOf(context, customer.id)).balanceMinor).toBe(3000)
    expect((await currentShift(context))!).toMatchObject({ expectedCashMinor: 2000, receiptsMinor: 2000 })

    await harness.json('POST', `/customer-receipts/${receipt.id}/void`, { session })
    expect((await customerOf(context, customer.id)).balanceMinor).toBe(5000)
    expect((await currentShift(context))!.expectedCashMinor).toBe(0)

    const { items } = await harness.json<{ items: CustomerEntry[] }>('GET', `/customers/${customer.id}/statement`, { session })
    expect(items).toHaveLength(3)
    expect((await harness.failure('POST', `/customer-receipts/${receipt.id}/void`, { session })).code).toBe('RECEIPT_ALREADY_VOIDED')
  })

  it('keeps card collections out of the cash drawer', async () => {
    const context = await ready()
    const customer = await addCustomer(context, 'بطاقة', { openingBalanceMinor: 5000 })
    await context.harness.json('POST', `/customers/${customer.id}/receipts`, {
      session: context.session,
      body: { amountMinor: 2000, method: 'card' },
    })
    expect((await currentShift(context))!.expectedCashMinor).toBe(0)
  })

  it('refuses a sale to an archived customer', async () => {
    const context = await ready()
    const { variantId } = await addProduct(context, 'أرشيف', { priceMinor: 100 })
    await receive(context, variantId, 5000, 50)
    const customer = await addCustomer(context, 'قديم')
    await context.harness.json('POST', `/customers/${customer.id}/archive`, { session: context.session })

    const failure = await refuse(context, [saleLine(variantId, 1000, 100)], [{ method: 'cash', amountMinor: 100 }], { customerId: customer.id })
    expect(failure.code).toBe('CUSTOMER_ARCHIVED')
  })
})

describe('held sales', () => {
  it('parks a cart, and a finished sale takes it off the list', async () => {
    const context = await ready()
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'معلق', { priceMinor: 1000, barcode: '4006381333931' })
    await receive(context, variantId, 5000, 100)
    const { items } = await harness.json<{ items: PosItem[] }>('GET', '/pos/lookup?search=4006381333931', { session })

    const held = await harness.json<HeldSale>('POST', '/held-sales', {
      session,
      body: {
        label: 'زبون الباب',
        customer: null,
        discountMinor: 0,
        lines: [{ item: items[0], unitId: 'piece', qtyMilli: 2000, unitPriceMinor: 1000, discountMinor: 0, lotId: null, serials: [] }],
      },
    })
    expect(held.totalMinor).toBe(2000)

    const list = await harness.json<{ items: HeldSale[] }>('GET', '/held-sales', { session })
    expect(list.items[0]).toMatchObject({ id: held.id, label: 'زبون الباب' })

    await sell(context, [saleLine(variantId, 2000, 1000)], [{ method: 'cash', amountMinor: 2000 }], { heldId: held.id })
    expect((await harness.json<{ items: HeldSale[] }>('GET', '/held-sales', { session })).items).toEqual([])
  })
})

describe('whatever happens at the till', () => {
  const action = fc.oneof(
    fc.record({ type: fc.constant('sell' as const), qty: fc.integer({ min: 1, max: 4 }), method: fc.constantFrom('cash', 'card', 'credit') as fc.Arbitrary<'cash' | 'card' | 'credit'> }),
    fc.record({ type: fc.constant('return' as const), pick: fc.nat(), qty: fc.integer({ min: 1, max: 3 }) }),
    fc.record({ type: fc.constant('void' as const), pick: fc.nat() }),
    fc.record({ type: fc.constant('collect' as const), amount: fc.integer({ min: 1, max: 500 }) }),
  )

  it('stock, the customer and the drawer always agree with their trails', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 12 }), async (actions) => {
        const context = await ready(1000)
        const { harness, session } = context
        const { product, variantId } = await addProduct(context, 'خاصية', { priceMinor: 333 })
        await receive(context, variantId, 40_000, 111)
        const customer = await addCustomer(context, 'زبون')

        const open: Sale[] = []
        let cash = 1000
        let owed = 0
        let onHand = 40_000

        for (const step of actions) {
          if (step.type === 'sell') {
            const total = step.qty * 333
            const sale = await sell(context, [saleLine(variantId, step.qty * 1000, 333)], [{ method: step.method, amountMinor: total }], { customerId: customer.id })
            open.push(sale)
            onHand -= step.qty * 1000
            if (step.method === 'cash') cash += total
            if (step.method === 'credit') owed += total
          }

          if (step.type === 'return' && open.length > 0) {
            const sale = open[step.pick % open.length]!
            const latest = await harness.json<Sale>('GET', `/sales/${sale.id}`, { session })
            const line = latest.lines[0]!
            const left = line.baseQtyMilli - line.returnedBaseMilli
            const qty = Math.min(step.qty * 1000, left)
            if (qty > 0) {
              const method = sale.payments[0]!.method
              const returned = await giveBack(context, sale.id, [{ saleLineId: line.id, qtyMilli: qty }], method)
              onHand += qty
              if (method === 'cash') cash -= returned.totalMinor
              if (method === 'credit') owed -= returned.totalMinor
            }
          }

          if (step.type === 'void' && open.length > 0) {
            const index = step.pick % open.length
            const sale = open[index]!
            const latest = await harness.json<Sale>('GET', `/sales/${sale.id}`, { session })
            if (latest.lines[0]!.returnedBaseMilli === 0) {
              await voidSale(context, sale.id)
              open.splice(index, 1)
              onHand += latest.lines[0]!.baseQtyMilli
              if (latest.payments[0]!.method === 'cash') cash -= latest.totalMinor
              if (latest.payments[0]!.method === 'credit') owed -= latest.totalMinor
            }
          }

          if (step.type === 'collect') {
            await harness.json('POST', `/customers/${customer.id}/receipts`, { session, body: { amountMinor: step.amount, method: 'cash' } })
            cash += step.amount
            owed -= step.amount
          }
        }

        const stock = await stockOf(context, product.id)
        expect(stock.onHandMilli).toBe(onHand)
        expect((await currentShift(context))!.expectedCashMinor).toBe(cash)
        expect((await customerOf(context, customer.id)).balanceMinor).toBe(owed)

        const value = await harness.deps.db
          .selectFrom('stock_movements')
          .select((eb) => eb.fn.sum<number>('value_minor').as('value'))
          .where('variant_id', '=', variantId)
          .executeTakeFirstOrThrow()
        expect(stock.valueMinor).toBe(Number(value.value))
        expect(stock.valueMinor).toBe(Math.round((onHand * 111) / 1000))
      }),
      { numRuns: 8 },
    )
  })
})

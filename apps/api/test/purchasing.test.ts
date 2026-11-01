import type {
  Order,
  Payment,
  Product,
  ProductInput,
  ProductStock,
  Purchase,
  PurchaseInput,
  Session,
  StatementEntry,
  StockMovement,
  Supplier,
} from '@inv/contracts'
import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { onboarded, type Harness } from './harness'

interface Context {
  harness: Harness
  session: string
}

const MAIN = 'main'
const emptyVariant = { label: null, costMinor: 0, barcodes: [], prices: [], attributeValueIds: [] }

async function store(): Promise<Context> {
  const { harness, owner } = await onboarded()
  return { harness, session: owner.token }
}

async function addProduct({ harness, session }: Context, name: string, overrides: Partial<ProductInput> = {}) {
  const product = await harness.json<Product>('POST', '/products', {
    session,
    body: {
      name,
      baseUnitId: 'piece',
      prescriptionRequired: false,
      trackLots: false,
      trackSerials: false,
      conversions: [],
      variants: [emptyVariant],
      ...overrides,
    },
  })
  return { product, variantId: product.variants[0]!.id }
}

const addSupplier = ({ harness, session }: Context, name: string, extra: object = {}) =>
  harness.json<Supplier>('POST', '/suppliers', { session, body: { name, ...extra } })

const supplierOf = ({ harness, session }: Context, id: string) => harness.json<Supplier>('GET', `/suppliers/${id}`, { session })

const line = (variantId: string, qtyMilli: number, unitCostMinor: number, extra: object = {}) => ({
  variantId,
  unitId: 'piece',
  qtyMilli,
  unitCostMinor,
  discountMinor: 0,
  taxRateBp: 0,
  ...extra,
})

function draft({ harness, session }: Context, supplierId: string, body: Partial<PurchaseInput>) {
  return harness.json<Purchase>('POST', '/purchases', {
    session,
    body: { kind: 'invoice', supplierId, warehouseId: MAIN, lines: [], ...body },
  })
}

const post = ({ harness, session }: Context, id: string) => harness.json<Purchase>('POST', `/purchases/${id}/post`, { session })

async function invoice(context: Context, supplierId: string, lines: PurchaseInput['lines'], extra: Partial<PurchaseInput> = {}) {
  return post(context, (await draft(context, supplierId, { lines, ...extra })).id)
}

async function stockOf({ harness, session }: Context, productId: string) {
  const stock = await harness.json<ProductStock>('GET', `/products/${productId}/stock`, { session })
  return stock.variants[0]!
}

async function statement({ harness, session }: Context, supplierId: string) {
  const { items } = await harness.json<{ items: StatementEntry[] }>('GET', `/suppliers/${supplierId}/statement`, { session })
  return items
}

async function staff(context: Context, username: string, roleId: string): Promise<string> {
  const { harness, session } = context
  await harness.json('POST', '/users', {
    session,
    body: { fullName: 'موظف', username, password: 'temporary-password', roleId },
  })
  const login = await harness.json<Session>('POST', '/auth/login', { body: { username, password: 'temporary-password' } })
  await harness.json('POST', '/auth/change-password', {
    session: login.token,
    body: { currentPassword: 'temporary-password', newPassword: 'staff-password' },
  })
  return login.token
}

describe('suppliers', () => {
  let context: Context
  beforeAll(async () => {
    context = await store()
  })

  it('flags a duplicate name on the name field', async () => {
    await addSupplier(context, 'شركة النيل')
    const failure = await context.harness.failure('POST', '/suppliers', {
      session: context.session,
      body: { name: 'شركة النيل' },
    })
    expect(failure.fields).toEqual({ name: ['SUPPLIER_NAME_TAKEN'] })
  })

  it('validates phone and tax number', async () => {
    const failure = await context.harness.failure('POST', '/suppliers', {
      session: context.session,
      body: { name: 'مورد', phone: 'abc', taxNumber: '12' },
    })
    expect(failure.fields).toEqual({ phone: ['PHONE_INVALID'], taxNumber: ['TAX_NUMBER_INVALID'] })
  })

  it('carries an opening balance onto the statement', async () => {
    const supplier = await addSupplier(context, 'رصيد قديم', { openingBalanceMinor: 50_000 })
    expect(supplier.balanceMinor).toBe(50_000)
    const [entry] = await statement(context, supplier.id)
    expect(entry).toMatchObject({ source: 'opening', amountMinor: 50_000, balanceMinor: 50_000 })
  })

  it('finds a supplier despite Arabic spelling differences', async () => {
    await addSupplier(context, 'مؤسسة الأمل')
    const { items } = await context.harness.json<{ items: Supplier[] }>(
      'GET',
      `/suppliers?search=${encodeURIComponent('موسسه الامل')}`,
      { session: context.session },
    )
    expect(items.map((item) => item.name)).toEqual(['مؤسسة الأمل'])
  })

  it('refuses a purchase from an archived supplier', async () => {
    const supplier = await addSupplier(context, 'مؤرشف')
    const { variantId } = await addProduct(context, 'صنف')
    const document = await draft(context, supplier.id, { lines: [line(variantId, 1000, 100)] })
    await context.harness.json('POST', `/suppliers/${supplier.id}/archive`, { session: context.session })

    const failure = await context.harness.failure('POST', `/purchases/${document.id}/post`, { session: context.session })
    expect(failure.code).toBe('SUPPLIER_ARCHIVED')
  })
})

describe('purchase invoices', () => {
  let context: Context
  let supplierId: string

  beforeAll(async () => {
    context = await store()
    supplierId = (await addSupplier(context, 'المورد')).id
  })

  it('moves stock, cost and the supplier balance together', async () => {
    const { product, variantId } = await addProduct(context, 'بنادول')
    const before = (await supplierOf(context, supplierId)).balanceMinor

    const document = await invoice(context, supplierId, [
      line(variantId, 10_000, 1000, { discountMinor: 500, taxRateBp: 1400 }),
    ])

    expect(document).toMatchObject({
      status: 'posted',
      number: 'PUR-000001',
      grossMinor: 10_000,
      discountMinor: 500,
      netMinor: 9500,
      taxMinor: 1330,
      totalMinor: 10_830,
    })

    // Stock is worth the net: recoverable VAT is a debt to the supplier, not a cost of goods.
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 10_000, valueMinor: 9500, averageCostMinor: 950 })
    expect((await supplierOf(context, supplierId)).balanceMinor).toBe(before + 10_830)

    const updated = await context.harness.json<Product>('GET', `/products/${product.id}`, { session: context.session })
    expect(updated.variants[0]?.costMinor).toBe(950)
  })

  it('averages the cost across purchases', async () => {
    const { product, variantId } = await addProduct(context, 'متوسط')
    await invoice(context, supplierId, [line(variantId, 10_000, 1000)])
    await invoice(context, supplierId, [line(variantId, 10_000, 2000)])
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 20_000, valueMinor: 30_000, averageCostMinor: 1500 })
  })

  it('converts a larger unit, costing it per that unit', async () => {
    const { product, variantId } = await addProduct(context, 'كرتونة', { conversions: [{ unitId: 'carton', factorMilli: 12_000 }] })
    await invoice(context, supplierId, [line(variantId, 2000, 12_000, { unitId: 'carton' })])
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 24_000, valueMinor: 24_000, averageCostMinor: 1000 })
  })

  it('records a payment made with the invoice, with its own number', async () => {
    const supplier = await addSupplier(context, 'نقدي')
    const { variantId } = await addProduct(context, 'مدفوع')
    await invoice(context, supplier.id, [line(variantId, 1000, 10_000)], { paidMinor: 4000, paymentMethod: 'cash' })

    expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(6000)
    const entries = await statement(context, supplier.id)
    expect(entries.map(({ source, amountMinor, balanceMinor }) => [source, amountMinor, balanceMinor]).sort()).toEqual(
      [
        ['payment', -4000, 6000],
        ['purchase', 10_000, 10_000],
      ].sort(),
    )
  })

  it('refuses to pay more than the invoice total', async () => {
    const { variantId } = await addProduct(context, 'زيادة')
    const document = await draft(context, supplierId, { lines: [line(variantId, 1000, 100)], paidMinor: 500 })
    const failure = await context.harness.failure('POST', `/purchases/${document.id}/post`, { session: context.session })
    expect(failure.fields).toEqual({ paidMinor: ['PAID_EXCEEDS_TOTAL'] })
  })

  it('changes nothing at all when one line fails', async () => {
    const supplier = await addSupplier(context, 'فشل')
    const good = await addProduct(context, 'سليم')
    const bad = await addProduct(context, 'كسر')

    const document = await draft(context, supplier.id, {
      lines: [line(good.variantId, 1000, 100), line(bad.variantId, 1500, 100)],
    })
    const failure = await context.harness.failure('POST', `/purchases/${document.id}/post`, { session: context.session })

    expect(failure.fields).toEqual({ 'lines.1.qtyMilli': ['QUANTITY_NOT_WHOLE'] })
    expect((await stockOf(context, good.product.id)).onHandMilli).toBe(0)
    expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(0)
    expect(await statement(context, supplier.id)).toEqual([])
  })

  it('applies batch rules on receipt', async () => {
    const { variantId } = await addProduct(context, 'دواء', { trackLots: true })
    const document = await draft(context, supplierId, { lines: [line(variantId, 1000, 100)] })
    const failure = await context.harness.failure('POST', `/purchases/${document.id}/post`, { session: context.session })
    expect(failure.fields).toEqual({ 'lines.0.lotNo': ['LOT_REQUIRED'] })
  })

  it('shows on the item history with its number', async () => {
    const { product, variantId } = await addProduct(context, 'تاريخ')
    const document = await invoice(context, supplierId, [line(variantId, 1000, 100)])
    const { items } = await context.harness.json<{ items: StockMovement[] }>('GET', `/products/${product.id}/movements`, {
      session: context.session,
    })
    expect(items[0]).toMatchObject({ documentKind: 'purchase', documentNumber: document.number, documentId: document.id })
  })

  it('lets a draft change, and freezes a posted invoice', async () => {
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'مسودة')
    const document = await draft(context, supplierId, { lines: [line(variantId, 1000, 100)] })

    const body = { kind: 'invoice', supplierId, warehouseId: MAIN, lines: [line(variantId, 2000, 100)] }
    const edited = await harness.json<Purchase>('PUT', `/purchases/${document.id}`, { session, body })
    expect(edited.lines[0]?.qtyMilli).toBe(2000)

    await post(context, document.id)
    expect((await harness.failure('PUT', `/purchases/${document.id}`, { session, body })).code).toBe('DOCUMENT_NOT_DRAFT')
    expect((await harness.failure('DELETE', `/purchases/${document.id}`, { session })).code).toBe('DOCUMENT_NOT_DRAFT')
  })
})

describe('voiding an invoice', () => {
  it('reverses stock, the balance and any payment made with it, keeping the history', async () => {
    const context = await store()
    const { harness, session } = context
    const supplier = await addSupplier(context, 'إلغاء')
    const { product, variantId } = await addProduct(context, 'صنف')
    const document = await invoice(context, supplier.id, [line(variantId, 5000, 1000)], { paidMinor: 2000 })

    const voided = await harness.json<Purchase>('POST', `/purchases/${document.id}/void`, { session })

    expect(voided.status).toBe('voided')
    expect(await stockOf(context, product.id)).toMatchObject({ onHandMilli: 0, valueMinor: 0 })
    expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(0)
    expect(await statement(context, supplier.id)).toHaveLength(4)
    expect((await harness.failure('POST', `/purchases/${document.id}/void`, { session })).code).toBe('DOCUMENT_NOT_POSTED')
  })

  it('refuses when the stock has since gone, and changes nothing', async () => {
    const context = await store()
    const { harness, session } = context
    const supplier = await addSupplier(context, 'مباع')
    const { product, variantId } = await addProduct(context, 'صنف')
    const document = await invoice(context, supplier.id, [line(variantId, 5000, 1000)])

    const adjustment = await harness.json<{ id: string }>('POST', '/stock/documents', {
      session,
      body: { kind: 'adjustment', warehouseId: MAIN, reason: 'damage', lines: [{ variantId, unitId: 'piece', qtyMilli: -3000 }] },
    })
    await harness.json('POST', `/stock/documents/${adjustment.id}/post`, { session })

    const failure = await harness.failure('POST', `/purchases/${document.id}/void`, { session })
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
    expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(5000)
    expect((await stockOf(context, product.id)).onHandMilli).toBe(2000)
  })
})

describe('purchase orders', () => {
  let context: Context
  let supplierId: string

  beforeAll(async () => {
    context = await store()
    supplierId = (await addSupplier(context, 'مورد الطلبات')).id
  })

  async function openOrder(variantId: string, qtyMilli: number, extra: object = {}) {
    const { harness, session } = context
    const order = await harness.json<Order>('POST', '/purchase-orders', {
      session,
      body: { supplierId, warehouseId: MAIN, lines: [{ variantId, unitId: 'piece', qtyMilli, unitCostMinor: 1000, ...extra }] },
    })
    return harness.json<Order>('POST', `/purchase-orders/${order.id}/open`, { session })
  }

  const receive = (order: Order, qtyMilli: number) =>
    invoice(context, supplierId, [line(order.lines[0]!.variantId, qtyMilli, 1000, { orderLineId: order.lines[0]!.id })], {
      orderId: order.id,
    })

  const reload = (order: Order) =>
    context.harness.json<Order>('GET', `/purchase-orders/${order.id}`, { session: context.session })

  it('numbers an order when it is opened, and changes no stock', async () => {
    const { product, variantId } = await addProduct(context, 'طلب')
    const order = await openOrder(variantId, 10_000)
    expect(order).toMatchObject({ status: 'open', number: 'PO-000001', totalMinor: 10_000 })
    expect((await stockOf(context, product.id)).onHandMilli).toBe(0)
  })

  it('tracks partial receipts until the order is complete', async () => {
    const { product, variantId } = await addProduct(context, 'جزئي')
    const order = await openOrder(variantId, 10_000)

    await receive(order, 4000)
    expect(await reload(order)).toMatchObject({ status: 'partial', lines: [expect.objectContaining({ receivedBaseMilli: 4000 })] })

    await receive(order, 6000)
    expect((await reload(order)).status).toBe('received')
    expect((await stockOf(context, product.id)).onHandMilli).toBe(10_000)
  })

  it('refuses receiving more than was ordered', async () => {
    const { variantId } = await addProduct(context, 'زيادة')
    const order = await openOrder(variantId, 3000)
    const document = await draft(context, supplierId, {
      orderId: order.id,
      lines: [line(variantId, 4000, 1000, { orderLineId: order.lines[0]!.id })],
    })
    const failure = await context.harness.failure('POST', `/purchases/${document.id}/post`, { session: context.session })
    expect(failure.fields).toEqual({ 'lines.0.qtyMilli': ['RECEIPT_EXCEEDS_ORDER'] })
  })

  it('compares in base units, whichever unit was received', async () => {
    const { variantId } = await addProduct(context, 'وحدات', { conversions: [{ unitId: 'box', factorMilli: 10_000 }] })
    const order = await openOrder(variantId, 2000, { unitId: 'box' })
    expect(order.lines[0]?.orderedBaseMilli).toBe(20_000)

    await invoice(context, supplierId, [line(variantId, 5000, 100, { orderLineId: order.lines[0]!.id })], { orderId: order.id })
    expect((await reload(order)).lines[0]?.receivedBaseMilli).toBe(5000)
  })

  it('reopens when a receipt against it is voided', async () => {
    const { variantId } = await addProduct(context, 'إعادة')
    const order = await openOrder(variantId, 5000)
    const document = await receive(order, 5000)
    expect((await reload(order)).status).toBe('received')

    await context.harness.json('POST', `/purchases/${document.id}/void`, { session: context.session })
    expect(await reload(order)).toMatchObject({ status: 'open', lines: [expect.objectContaining({ receivedBaseMilli: 0 })] })
  })

  it('refuses receiving against a cancelled order', async () => {
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'ملغي')
    const order = await openOrder(variantId, 5000)
    const document = await draft(context, supplierId, {
      orderId: order.id,
      lines: [line(variantId, 1000, 1000, { orderLineId: order.lines[0]!.id })],
    })
    await harness.json('POST', `/purchase-orders/${order.id}/cancel`, { session })
    expect((await harness.failure('POST', `/purchases/${document.id}/post`, { session })).code).toBe('ORDER_NOT_OPEN')
  })

  it('protects an opened order from edits', async () => {
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'محمي')
    const order = await openOrder(variantId, 1000)
    const body = { supplierId, warehouseId: MAIN, lines: [] }
    expect((await harness.failure('PUT', `/purchase-orders/${order.id}`, { session, body })).code).toBe('DOCUMENT_NOT_DRAFT')
  })

  it('refuses to open an empty order', async () => {
    const { harness, session } = context
    const order = await harness.json<Order>('POST', '/purchase-orders', { session, body: { supplierId, warehouseId: MAIN, lines: [] } })
    expect((await harness.failure('POST', `/purchase-orders/${order.id}/open`, { session })).code).toBe('DOCUMENT_EMPTY')
  })
})

describe('purchase returns', () => {
  let context: Context
  let supplierId: string

  beforeAll(async () => {
    context = await store()
    supplierId = (await addSupplier(context, 'مورد المرتجع')).id
  })

  const purchaseReturn = (lines: PurchaseInput['lines']) => invoice(context, supplierId, lines, { kind: 'return' })

  it('takes stock out and reduces what is owed', async () => {
    const { product, variantId } = await addProduct(context, 'مرتجع')
    await invoice(context, supplierId, [line(variantId, 10_000, 1000)])
    const before = (await supplierOf(context, supplierId)).balanceMinor

    const document = await purchaseReturn([line(variantId, 4000, 1000)])

    expect(document.number).toBe('PRT-000001')
    expect((await stockOf(context, product.id)).onHandMilli).toBe(6000)
    expect((await supplierOf(context, supplierId)).balanceMinor).toBe(before - 4000)
  })

  it('refuses returning more than is on hand', async () => {
    const { variantId } = await addProduct(context, 'أكثر')
    await invoice(context, supplierId, [line(variantId, 1000, 1000)])
    const document = await draft(context, supplierId, { kind: 'return', lines: [line(variantId, 3000, 1000)] })
    const failure = await context.harness.failure('POST', `/purchases/${document.id}/post`, { session: context.session })
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
  })

  it('can return an expired batch, nearest expiry first', async () => {
    const { product, variantId } = await addProduct(context, 'منتهي', { trackLots: true })
    await invoice(context, supplierId, [
      line(variantId, 2000, 100, { lotNo: 'OLD', expiryDate: '2020-01-01' }),
      line(variantId, 2000, 100, { lotNo: 'NEW', expiryDate: '2031-01-01' }),
    ])
    await purchaseReturn([line(variantId, 2000, 100)])
    const balances = (await stockOf(context, product.id)).balances
    expect(balances.map(({ lotNo, qtyMilli }) => [lotNo, qtyMilli])).toEqual([['NEW', 2000]])
  })

  it('restores stock and the balance when voided', async () => {
    const { harness, session } = context
    const { product, variantId } = await addProduct(context, 'رجوع')
    await invoice(context, supplierId, [line(variantId, 5000, 1000)])
    const balance = (await supplierOf(context, supplierId)).balanceMinor
    const document = await purchaseReturn([line(variantId, 2000, 1000)])

    await harness.json('POST', `/purchases/${document.id}/void`, { session })
    expect((await stockOf(context, product.id)).onHandMilli).toBe(5000)
    expect((await supplierOf(context, supplierId)).balanceMinor).toBe(balance)
  })
})

describe('supplier payments', () => {
  it('reduces the balance, and a void puts it back on the statement', async () => {
    const context = await store()
    const { harness, session } = context
    const supplier = await addSupplier(context, 'دفعات', { openingBalanceMinor: 10_000 })

    const payment = await harness.json<Payment>('POST', `/suppliers/${supplier.id}/payments`, {
      session,
      body: { amountMinor: 3000, method: 'bank', reference: 'TRX-1' },
    })
    expect(payment.number).toBe('PAY-000001')
    expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(7000)

    await harness.json('POST', `/supplier-payments/${payment.id}/void`, { session })
    expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(10_000)
    expect(await statement(context, supplier.id)).toHaveLength(3)

    expect((await harness.failure('POST', `/supplier-payments/${payment.id}/void`, { session })).code).toBe('PAYMENT_ALREADY_VOIDED')
  })

  it('leaves a payment made with an invoice to that invoice', async () => {
    const context = await store()
    const { harness, session } = context
    const supplier = await addSupplier(context, 'مع الفاتورة')
    const { variantId } = await addProduct(context, 'مرتبط')
    await invoice(context, supplier.id, [line(variantId, 1000, 10_000)], { paidMinor: 4000 })

    const payment = (await statement(context, supplier.id)).find(({ source }) => source === 'payment')!
    expect(payment.purchaseId).toBeTruthy()

    const failure = await harness.failure('POST', `/supplier-payments/${payment.documentId}/void`, { session })
    expect(failure.code).toBe('PAYMENT_BELONGS_TO_PURCHASE')
    expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(6000)
  })

  it('refuses a zero payment', async () => {
    const context = await store()
    const supplier = await addSupplier(context, 'صفر')
    const failure = await context.harness.failure('POST', `/suppliers/${supplier.id}/payments`, {
      session: context.session,
      body: { amountMinor: 0, method: 'cash' },
    })
    expect(failure.fields).toEqual({ amountMinor: ['PRICE_INVALID'] })
  })

  it('makes the statement impossible to rewrite', async () => {
    const context = await store()
    await addSupplier(context, 'ثابت', { openingBalanceMinor: 100 })
    const { sql } = await import('kysely')
    await expect(sql`update supplier_ledger set amount_minor = 1`.execute(context.harness.deps.db)).rejects.toThrow(/append-only/)
    await expect(sql`delete from supplier_ledger`.execute(context.harness.deps.db)).rejects.toThrow(/append-only/)
  })
})

describe('serial numbers', () => {
  let context: Context
  let supplierId: string

  beforeAll(async () => {
    context = await store()
    supplierId = (await addSupplier(context, 'مورد الأجهزة')).id
  })

  const device = (name: string) => addProduct(context, name, { trackSerials: true })

  async function failureOf(lines: PurchaseInput['lines'], kind: PurchaseInput['kind'] = 'invoice') {
    const document = await draft(context, supplierId, { kind, lines })
    return context.harness.failure('POST', `/purchases/${document.id}/post`, { session: context.session })
  }

  it('needs one serial for each unit received', async () => {
    const { variantId } = await device('موبايل 1')
    const failure = await failureOf([line(variantId, 2000, 100, { serials: ['A'] })])
    expect(failure.fields).toEqual({ 'lines.0.serials': ['SERIAL_COUNT_MISMATCH'] })
  })

  it('refuses a repeated serial, in one line, across lines, or already in stock', async () => {
    const { variantId } = await device('موبايل 2')
    expect((await failureOf([line(variantId, 2000, 100, { serials: ['A', 'A'] })])).fields).toEqual({
      'lines.0.serials': ['SERIAL_DUPLICATED'],
    })
    expect(
      (await failureOf([line(variantId, 1000, 100, { serials: ['B'] }), line(variantId, 1000, 100, { serials: ['B'] })])).fields,
    ).toEqual({ 'lines.1.serials': ['SERIAL_DUPLICATED'] })

    await invoice(context, supplierId, [line(variantId, 1000, 100, { serials: ['C'] })])
    expect((await failureOf([line(variantId, 1000, 100, { serials: ['C'] })])).fields).toEqual({ 'lines.0.serials': ['SERIAL_TAKEN'] })
  })

  it('allows the same serial on two different products', async () => {
    const first = await device('موبايل 3')
    const second = await device('موبايل 4')
    await invoice(context, supplierId, [line(first.variantId, 1000, 100, { serials: ['SAME'] })])
    await expect(invoice(context, supplierId, [line(second.variantId, 1000, 100, { serials: ['SAME'] })])).resolves.toBeTruthy()
  })

  it('returns only serials actually in stock, and a void restores them', async () => {
    const { harness, session } = context
    const { variantId } = await device('موبايل 5')
    await invoice(context, supplierId, [line(variantId, 2000, 100, { serials: ['X', 'Y'] })])

    expect((await failureOf([line(variantId, 1000, 100, { serials: ['Z'] })], 'return')).fields).toEqual({
      'lines.0.serials': ['SERIAL_NOT_IN_STOCK'],
    })

    const document = await invoice(context, supplierId, [line(variantId, 1000, 100, { serials: ['X'] })], { kind: 'return' })
    expect((await failureOf([line(variantId, 1000, 100, { serials: ['X'] })], 'return')).fields).toEqual({
      'lines.0.serials': ['SERIAL_NOT_IN_STOCK'],
    })

    await harness.json('POST', `/purchases/${document.id}/void`, { session })
    await expect(invoice(context, supplierId, [line(variantId, 1000, 100, { serials: ['X'] })], { kind: 'return' })).resolves.toBeTruthy()
  })

  it('frees the serials when the purchase is voided', async () => {
    const { harness, session } = context
    const { variantId } = await device('موبايل 6')
    const document = await invoice(context, supplierId, [line(variantId, 1000, 100, { serials: ['K'] })])
    await harness.json('POST', `/purchases/${document.id}/void`, { session })
    await expect(invoice(context, supplierId, [line(variantId, 1000, 100, { serials: ['K'] })])).resolves.toBeTruthy()
  })

  it('refuses to void a purchase whose serial has left the shop', async () => {
    const { harness, session } = context
    const { variantId } = await device('موبايل 7')
    const document = await invoice(context, supplierId, [line(variantId, 1000, 100, { serials: ['M'] })])
    await harness.deps.db.updateTable('serials').set({ status: 'sold' }).where('serial', '=', 'M').execute()
    expect((await harness.failure('POST', `/purchases/${document.id}/void`, { session })).code).toBe('SERIAL_ALREADY_SOLD')
  })
})

describe('permissions', () => {
  it('separates buying, paying and looking', async () => {
    const context = await store()
    const { harness } = context
    const supplier = await addSupplier(context, 'صلاحيات', { openingBalanceMinor: 1000 })
    const storekeeper = await staff(context, 'keeper', 'storekeeper')
    const cashier = await staff(context, 'till', 'cashier')

    expect((await harness.call('GET', '/purchases', { session: storekeeper })).status).toBe(200)
    const pay = { amountMinor: 100, method: 'cash' }
    expect((await harness.failure('POST', `/suppliers/${supplier.id}/payments`, { session: storekeeper, body: pay })).code).toBe('FORBIDDEN')
    expect((await harness.failure('POST', '/suppliers', { session: storekeeper, body: { name: 'جديد' } })).code).toBe('FORBIDDEN')

    expect((await harness.failure('GET', '/purchases', { session: cashier })).code).toBe('FORBIDDEN')
    expect((await harness.failure('GET', '/suppliers', { session: cashier })).code).toBe('FORBIDDEN')
  })
})

describe('reconciliation', () => {
  it(
    'keeps the supplier balance equal to its statement, and stock to its movements, through any mix',
    { timeout: 120_000 },
    async () => {
      const operation = fc.oneof(
        fc.record({
          kind: fc.constant('invoice' as const),
          qty: fc.integer({ min: 1, max: 30 }),
          cost: fc.integer({ min: 0, max: 2000 }),
          discount: fc.integer({ min: 0, max: 500 }),
          taxBp: fc.constantFrom(0, 1000, 1400),
          paidPercent: fc.constantFrom(0, 50, 100),
        }),
        fc.record({ kind: fc.constant('return' as const), qty: fc.integer({ min: 1, max: 30 }), cost: fc.integer({ min: 0, max: 2000 }) }),
        fc.record({ kind: fc.constant('pay' as const), amount: fc.integer({ min: 1, max: 5000 }) }),
        fc.record({ kind: fc.constant('void' as const), pick: fc.nat() }),
      )

      await fc.assert(
        fc.asyncProperty(fc.array(operation, { minLength: 3, maxLength: 12 }), async (operations) => {
          const context = await store()
          const { harness, session } = context
          const supplier = await addSupplier(context, 'خصائص')
          const { product, variantId } = await addProduct(context, 'صنف')
          const posted: string[] = []

          for (const step of operations) {
            if (step.kind === 'pay') {
              await harness.call('POST', `/suppliers/${supplier.id}/payments`, {
                session,
                body: { amountMinor: step.amount, method: 'cash' },
              })
            } else if (step.kind === 'void') {
              const id = posted[step.pick % Math.max(posted.length, 1)]
              if (!id) continue
              const response = await harness.call('POST', `/purchases/${id}/void`, { session })
              if (response.status === 200) posted.splice(posted.indexOf(id), 1)
            } else {
              const isInvoice = step.kind === 'invoice'
              const lines = [
                line(variantId, step.qty * 1000, step.cost, isInvoice ? { discountMinor: step.discount, taxRateBp: step.taxBp } : {}),
              ]
              const document = await draft(context, supplier.id, { kind: step.kind, lines })
              const paidMinor = isInvoice ? Math.floor((document.totalMinor * step.paidPercent) / 100) : 0
              if (paidMinor > 0) {
                await harness.json('PUT', `/purchases/${document.id}`, {
                  session,
                  body: { kind: 'invoice', supplierId: supplier.id, warehouseId: MAIN, lines, paidMinor, paymentMethod: 'cash' },
                })
              }
              const response = await harness.call('POST', `/purchases/${document.id}/post`, { session })
              if (response.status === 200) posted.push(document.id)
            }
          }

          const { db } = harness.deps
          const entries = await db.selectFrom('supplier_ledger').selectAll().where('supplier_id', '=', supplier.id).execute()
          const balance = entries.reduce((sum, { amount_minor }) => sum + Number(amount_minor), 0)
          expect((await supplierOf(context, supplier.id)).balanceMinor).toBe(balance)

          const stock = await stockOf(context, product.id)
          const movements = await db.selectFrom('stock_movements').selectAll().execute()
          expect(movements.reduce((sum, { qty_milli }) => sum + Number(qty_milli), 0)).toBe(stock.onHandMilli)
          expect(movements.reduce((sum, { value_minor }) => sum + Number(value_minor), 0)).toBe(stock.valueMinor)
          expect(stock.onHandMilli).toBeGreaterThanOrEqual(0)
          if (stock.onHandMilli === 0) expect(stock.valueMinor).toBe(0)
        }),
        { numRuns: 20 },
      )
    },
  )
})

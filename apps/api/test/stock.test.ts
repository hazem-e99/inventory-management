import type {
  ProductInput,
  Product,
  ProductPage,
  ProductStock,
  Session,
  StockDocument,
  StockDocumentInput,
  StockMovement,
  StockPickRow,
  User,
} from '@inv/contracts'
import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { onboarded, type Harness } from './harness'

interface Context {
  harness: Harness
  session: string
}

const MAIN = 'main'

const emptyVariant = { label: null, costMinor: 100, barcodes: [], prices: [], attributeValueIds: [] }

function productBody(name: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name,
    baseUnitId: 'piece',
    prescriptionRequired: false,
    trackLots: false,
    trackSerials: false,
    conversions: [],
    variants: [emptyVariant],
    ...overrides,
  }
}

async function addProduct({ harness, session }: Context, name: string, overrides: Partial<ProductInput> = {}) {
  const product = await harness.json<Product>('POST', '/products', { session, body: productBody(name, overrides) })
  return { product, variantId: product.variants[0]!.id }
}

const line = (variantId: string, qtyMilli: number, extra: object = {}) => ({ variantId, unitId: 'piece', qtyMilli, ...extra })

function draft({ harness, session }: Context, body: Partial<StockDocumentInput>) {
  return harness.json<StockDocument>('POST', '/stock/documents', {
    session,
    body: { kind: 'adjustment', warehouseId: MAIN, reason: 'correction', lines: [], ...body },
  })
}

const post = ({ harness, session }: Context, id: string) =>
  harness.json<StockDocument>('POST', `/stock/documents/${id}/post`, { session })

async function adjust(context: Context, lines: StockDocumentInput['lines'], reason: StockDocumentInput['reason'] = 'correction') {
  return post(context, (await draft(context, { reason, lines })).id)
}

async function onHand({ harness, session }: Context, productId: string): Promise<ProductStock['variants'][number]> {
  const stock = await harness.json<ProductStock>('GET', `/products/${productId}/stock`, { session })
  return stock.variants[0]!
}

async function freshStore(): Promise<Context> {
  const { harness, owner } = await onboarded()
  return { harness, session: owner.token }
}

describe('adjustments', () => {
  let context: Context
  beforeAll(async () => {
    context = await freshStore()
  })

  it('adds stock at a stated cost, numbers the document, and shows on the product', async () => {
    const { product, variantId } = await addProduct(context, 'سكر')
    const document = await adjust(context, [line(variantId, 10_000, { unitCostMinor: 2500 })], 'opening')

    expect(document).toMatchObject({ status: 'posted', number: 'ADJ-000001' })
    expect(await onHand(context, product.id)).toMatchObject({
      onHandMilli: 10_000,
      valueMinor: 25_000,
      averageCostMinor: 2500,
    })

    const page = await context.harness.json<ProductPage>('GET', `/products?search=${encodeURIComponent('سكر')}`, {
      session: context.session,
    })
    expect(page.items[0]?.onHandMilli).toBe(10_000)
  })

  it('removes stock at the average cost', async () => {
    const { product, variantId } = await addProduct(context, 'زيت')
    await adjust(context, [line(variantId, 10_000, { unitCostMinor: 1000 })])
    await adjust(context, [line(variantId, 10_000, { unitCostMinor: 3000 })])
    await adjust(context, [line(variantId, -5000)], 'damage')

    expect(await onHand(context, product.id)).toMatchObject({ onHandMilli: 15_000, valueMinor: 30_000, averageCostMinor: 2000 })
  })

  it('refuses to remove more than exists, naming the item and amounts, and burns no number', async () => {
    const { product, variantId } = await addProduct(context, 'أرز')
    await adjust(context, [line(variantId, 3000, { unitCostMinor: 100 })])

    const document = await draft(context, { lines: [line(variantId, -5000)] })
    const failure = await context.harness.failure('POST', `/stock/documents/${document.id}/post`, { session: context.session })

    expect(failure.code).toBe('STOCK_INSUFFICIENT')
    expect(failure.params).toEqual({ item: 'أرز', available: '3', requested: '5' })
    expect((await onHand(context, product.id)).onHandMilli).toBe(3000)

    const before = (await adjust(context, [line(variantId, 1000)])).number
    expect(Number(before?.slice(-6))).toBeGreaterThan(0)
    const retried = await context.harness.json<StockDocument>('GET', `/stock/documents/${document.id}`, { session: context.session })
    expect(retried).toMatchObject({ status: 'draft', number: null })
  })

  it('rolls back a whole document when one line fails', async () => {
    const first = await addProduct(context, 'صنف أ')
    const second = await addProduct(context, 'صنف ب')
    await adjust(context, [line(first.variantId, 5000, { unitCostMinor: 100 })])

    const document = await draft(context, { lines: [line(first.variantId, -1000), line(second.variantId, -1000)] })
    await context.harness.failure('POST', `/stock/documents/${document.id}/post`, { session: context.session })

    expect((await onHand(context, first.product.id)).onHandMilli).toBe(5000)
  })

  it('converts a larger unit to the base unit', async () => {
    const { product, variantId } = await addProduct(context, 'لبن', { conversions: [{ unitId: 'carton', factorMilli: 12_000 }] })
    await adjust(context, [{ variantId, unitId: 'carton', qtyMilli: 2000, unitCostMinor: 12_000 }])
    expect(await onHand(context, product.id)).toMatchObject({ onHandMilli: 24_000, valueMinor: 24_000 })
  })

  it('refuses half a piece, and a unit the product does not use', async () => {
    const { variantId } = await addProduct(context, 'علبة')
    const half = await draft(context, { lines: [line(variantId, 1500)] })
    const wrongUnit = await draft(context, { lines: [{ variantId, unitId: 'carton', qtyMilli: 1000 }] })
    const { harness, session } = context

    expect((await harness.failure('POST', `/stock/documents/${half.id}/post`, { session })).fields).toEqual({
      'lines.0.qtyMilli': ['QUANTITY_NOT_WHOLE'],
    })
    expect((await harness.failure('POST', `/stock/documents/${wrongUnit.id}/post`, { session })).fields).toEqual({
      'lines.0.unitId': ['UNIT_CONVERSION_INVALID'],
    })
  })

  it('accepts fractions in a unit that allows them', async () => {
    const { product, variantId } = await addProduct(context, 'جبنة', { baseUnitId: 'kilogram' })
    await adjust(context, [{ variantId, unitId: 'kilogram', qtyMilli: 1250, unitCostMinor: 20_000 }])
    expect(await onHand(context, product.id)).toMatchObject({ onHandMilli: 1250, valueMinor: 25_000 })
  })

  it('needs a reason, and at least one line', async () => {
    const { variantId } = await addProduct(context, 'بدون سبب')
    const noReason = await draft(context, { reason: null, lines: [line(variantId, 1000)] })
    const empty = await draft(context, { lines: [] })
    const { harness, session } = context

    expect((await harness.failure('POST', `/stock/documents/${noReason.id}/post`, { session })).fields).toEqual({ reason: ['REQUIRED'] })
    expect((await harness.failure('POST', `/stock/documents/${empty.id}/post`, { session })).code).toBe('DOCUMENT_EMPTY')
  })
})

describe('document life cycle', () => {
  let context: Context
  beforeAll(async () => {
    context = await freshStore()
  })

  it('lets a draft change or disappear, and a posted document do neither', async () => {
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'مستند')
    const document = await draft(context, { lines: [line(variantId, 1000)] })

    const edited = await harness.json<StockDocument>('PUT', `/stock/documents/${document.id}`, {
      session,
      body: { kind: 'adjustment', warehouseId: MAIN, reason: 'gift', lines: [line(variantId, 2000)] },
    })
    expect(edited.lines[0]?.qtyMilli).toBe(2000)

    const removable = await draft(context, { lines: [] })
    expect((await harness.call('DELETE', `/stock/documents/${removable.id}`, { session })).status).toBe(200)

    await post(context, document.id)
    const body = { kind: 'adjustment', warehouseId: MAIN, reason: 'gift', lines: [] }
    expect((await harness.failure('PUT', `/stock/documents/${document.id}`, { session, body })).code).toBe('DOCUMENT_NOT_DRAFT')
    expect((await harness.failure('DELETE', `/stock/documents/${document.id}`, { session })).code).toBe('DOCUMENT_NOT_DRAFT')
    expect((await harness.failure('POST', `/stock/documents/${document.id}/post`, { session })).code).toBe('DOCUMENT_NOT_DRAFT')
  })

  it('voids with reversing movements, keeps the original, and only once', async () => {
    const { harness, session } = context
    const { product, variantId } = await addProduct(context, 'إلغاء')
    const document = await adjust(context, [line(variantId, 4000, { unitCostMinor: 500 })])

    const voided = await harness.json<StockDocument>('POST', `/stock/documents/${document.id}/void`, { session })
    expect(voided).toMatchObject({ status: 'voided', number: document.number })
    expect(await onHand(context, product.id)).toMatchObject({ onHandMilli: 0, valueMinor: 0 })

    const { items } = await harness.json<{ items: StockMovement[] }>('GET', `/products/${product.id}/movements`, { session })
    expect(items.map(({ qtyMilli, reversal }) => [qtyMilli, reversal])).toEqual([
      [-4000, true],
      [4000, false],
    ])

    expect((await harness.failure('POST', `/stock/documents/${document.id}/void`, { session })).code).toBe('DOCUMENT_NOT_POSTED')
  })

  it('refuses a void when the stock has since been sold or removed', async () => {
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'مباع')
    const document = await adjust(context, [line(variantId, 4000, { unitCostMinor: 500 })])
    await adjust(context, [line(variantId, -3000)])

    const failure = await harness.failure('POST', `/stock/documents/${document.id}/void`, { session })
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
  })

  it('numbers each kind on its own sequence, with no gaps', async () => {
    const { variantId } = await addProduct(context, 'تسلسل')
    const first = await adjust(context, [line(variantId, 1000)])
    const second = await adjust(context, [line(variantId, 1000)])
    const delta = Number(second.number!.slice(-6)) - Number(first.number!.slice(-6))
    expect(delta).toBe(1)
  })

  it('records who posted and voided in the audit log', async () => {
    const { harness, session } = context
    const { variantId } = await addProduct(context, 'سجل')
    const document = await adjust(context, [line(variantId, 1000)])
    await harness.json('POST', `/stock/documents/${document.id}/void`, { session })

    const page = await harness.json<{ items: Array<{ action: string; entityId: string | null }> }>('GET', '/audit?limit=2', { session })
    expect(page.items.map(({ action }) => action)).toEqual(['stock.voided', 'stock.posted'])
    expect(page.items[0]?.entityId).toBe(document.id)
  })
})

describe('transfers', () => {
  let context: Context
  let branch: string

  beforeAll(async () => {
    context = await freshStore()
    const warehouse = await context.harness.json<{ id: string }>('POST', '/catalog/warehouses', {
      session: context.session,
      body: { name: 'مخزن الفرع' },
    })
    branch = warehouse.id
  })

  const transfer = (lines: StockDocumentInput['lines'], toWarehouseId: string | null = branch) =>
    draft(context, { kind: 'transfer', reason: null, toWarehouseId, lines })

  it('moves stock between warehouses without changing total quantity or value', async () => {
    const { product, variantId } = await addProduct(context, 'نقل')
    await adjust(context, [line(variantId, 10_000, { unitCostMinor: 300 })])
    const document = await post(context, (await transfer([line(variantId, 4000)])).id)

    expect(document.number).toBe('TRF-000001')
    const stock = await onHand(context, product.id)
    expect(stock).toMatchObject({ onHandMilli: 10_000, valueMinor: 3000 })
    expect(Object.fromEntries(stock.balances.map(({ warehouseId, qtyMilli }) => [warehouseId, qtyMilli]))).toEqual({
      main: 6000,
      [branch]: 4000,
    })
  })

  it('refuses a transfer to the same warehouse, or with no destination', async () => {
    const { variantId } = await addProduct(context, 'نقل خطأ')
    const same = await transfer([line(variantId, 1000)], MAIN)
    const none = await transfer([line(variantId, 1000)], null)
    const { harness, session } = context

    expect((await harness.failure('POST', `/stock/documents/${same.id}/post`, { session })).fields).toEqual({ toWarehouseId: ['SAME_WAREHOUSE'] })
    expect((await harness.failure('POST', `/stock/documents/${none.id}/post`, { session })).fields).toEqual({ toWarehouseId: ['REQUIRED'] })
  })

  it('needs stock in the source warehouse, not just somewhere', async () => {
    const { variantId } = await addProduct(context, 'نقل عكسي')
    await adjust(context, [line(variantId, 5000)])
    const document = await draft(context, {
      kind: 'transfer',
      reason: null,
      warehouseId: branch,
      toWarehouseId: MAIN,
      lines: [line(variantId, 1000)],
    })
    const failure = await context.harness.failure('POST', `/stock/documents/${document.id}/post`, { session: context.session })
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
  })

  it('restores both sides when voided', async () => {
    const { product, variantId } = await addProduct(context, 'نقل ملغي')
    await adjust(context, [line(variantId, 5000, { unitCostMinor: 100 })])
    const document = await post(context, (await transfer([line(variantId, 5000)])).id)
    await context.harness.json('POST', `/stock/documents/${document.id}/void`, { session: context.session })

    const stock = await onHand(context, product.id)
    expect(stock.balances).toEqual([expect.objectContaining({ warehouseId: MAIN, qtyMilli: 5000 })])
    expect(stock).toMatchObject({ onHandMilli: 5000, valueMinor: 500 })
  })
})

describe('stock counts', () => {
  let context: Context
  beforeAll(async () => {
    context = await freshStore()
  })

  const sheet = () =>
    context.harness.json<StockDocument>('POST', '/stock/documents/count-sheet', {
      session: context.session,
      body: { warehouseId: MAIN },
    })

  async function saveCounts(document: StockDocument, counts: Record<string, number>) {
    return context.harness.json<StockDocument>('PUT', `/stock/documents/${document.id}`, {
      session: context.session,
      body: {
        kind: 'count',
        warehouseId: MAIN,
        lines: document.lines.map((row) => ({
          variantId: row.variantId,
          unitId: row.unitId,
          qtyMilli: counts[row.variantId] ?? row.qtyMilli,
          lotId: row.lotId,
        })),
      },
    })
  }

  it('starts from what the system holds, and sets the shelf to what was counted', async () => {
    const over = await addProduct(context, 'زيادة')
    const short = await addProduct(context, 'عجز')
    const exact = await addProduct(context, 'مطابق')
    await adjust(context, [
      line(over.variantId, 10_000, { unitCostMinor: 200 }),
      line(short.variantId, 10_000, { unitCostMinor: 200 }),
      line(exact.variantId, 10_000, { unitCostMinor: 200 }),
    ])

    const document = await sheet()
    expect(document.lines.find((row) => row.variantId === over.variantId)?.expectedMilli).toBe(10_000)

    const counted = await saveCounts(document, { [over.variantId]: 12_000, [short.variantId]: 7000 })
    const posted = await post(context, counted.id)

    expect(posted.number).toBe('CNT-000001')
    expect((await onHand(context, over.product.id)).onHandMilli).toBe(12_000)
    expect((await onHand(context, short.product.id)).onHandMilli).toBe(7000)
    expect((await onHand(context, exact.product.id)).onHandMilli).toBe(10_000)

    const { items } = await context.harness.json<{ items: StockMovement[] }>('GET', `/products/${exact.product.id}/movements`, {
      session: context.session,
    })
    expect(items).toHaveLength(1)
  })

  it('measures against the stock at posting, so sales during the count are not lost', async () => {
    const { product, variantId } = await addProduct(context, 'أثناء الجرد')
    await adjust(context, [line(variantId, 10_000, { unitCostMinor: 100 })])
    const document = await sheet()
    const counted = await saveCounts(document, { [variantId]: 8000 })

    await adjust(context, [line(variantId, -1000)])
    const posted = await post(context, counted.id)

    expect((await onHand(context, product.id)).onHandMilli).toBe(8000)
    expect(posted.lines.find((row) => row.variantId === variantId)?.expectedMilli).toBe(9000)
  })

  it('can count down to zero, leaving no value behind', async () => {
    const { product, variantId } = await addProduct(context, 'صفر')
    await adjust(context, [line(variantId, 3000, { unitCostMinor: 333 })])
    await post(context, (await saveCounts(await sheet(), { [variantId]: 0 })).id)
    expect(await onHand(context, product.id)).toMatchObject({ onHandMilli: 0, valueMinor: 0 })
  })

  it('refuses the same item twice in one count', async () => {
    const { variantId } = await addProduct(context, 'مكرر')
    const document = await draft(context, { kind: 'count', reason: null, lines: [line(variantId, 1000), line(variantId, 2000)] })
    const failure = await context.harness.failure('POST', `/stock/documents/${document.id}/post`, { session: context.session })
    expect(failure.fields).toEqual({ 'lines.1.variantId': ['LINE_DUPLICATED'] })
  })
})

describe('batches and expiry in a pharmacy', () => {
  let context: Context
  beforeAll(async () => {
    context = await freshStore()
  })

  const tracked = (name: string) => addProduct(context, name, { trackLots: true })

  it('needs a batch number and an expiry date on receipt', async () => {
    const { variantId } = await tracked('دواء 1')
    const noLot = await draft(context, { lines: [line(variantId, 1000)] })
    const noExpiry = await draft(context, { lines: [line(variantId, 1000, { lotNo: 'A1' })] })
    const { harness, session } = context

    expect((await harness.failure('POST', `/stock/documents/${noLot.id}/post`, { session })).fields).toEqual({ 'lines.0.lotNo': ['LOT_REQUIRED'] })
    expect((await harness.failure('POST', `/stock/documents/${noExpiry.id}/post`, { session })).fields).toEqual({ 'lines.0.expiryDate': ['EXPIRY_REQUIRED'] })
  })

  it('keeps one batch as one lot, and refuses a second expiry for it', async () => {
    const { product, variantId } = await tracked('دواء 2')
    await adjust(context, [line(variantId, 1000, { lotNo: 'A1', expiryDate: '2030-01-01' })])
    await adjust(context, [line(variantId, 2000, { lotNo: 'A1', expiryDate: '2030-01-01' })])
    expect((await onHand(context, product.id)).balances).toHaveLength(1)

    const clash = await draft(context, { lines: [line(variantId, 1000, { lotNo: 'A1', expiryDate: '2031-01-01' })] })
    const failure = await context.harness.failure('POST', `/stock/documents/${clash.id}/post`, { session: context.session })
    expect(failure.fields).toEqual({ 'lines.0.expiryDate': ['LOT_EXPIRY_MISMATCH'] })
  })

  it('issues the nearest expiry first, across batches', async () => {
    const { product, variantId } = await tracked('دواء 3')
    await adjust(context, [
      line(variantId, 5000, { lotNo: 'LATER', expiryDate: '2031-01-01', unitCostMinor: 100 }),
      line(variantId, 3000, { lotNo: 'SOON', expiryDate: '2030-01-01', unitCostMinor: 100 }),
    ])

    await adjust(context, [line(variantId, -4000)], 'gift')

    const left = Object.fromEntries((await onHand(context, product.id)).balances.map(({ lotNo, qtyMilli }) => [lotNo, qtyMilli]))
    expect(left).toEqual({ LATER: 4000 })
  })

  it('respects a batch chosen by hand', async () => {
    const { product, variantId } = await tracked('دواء 4')
    await adjust(context, [
      line(variantId, 2000, { lotNo: 'SOON', expiryDate: '2030-01-01' }),
      line(variantId, 2000, { lotNo: 'LATER', expiryDate: '2031-01-01' }),
    ])
    const stock = await onHand(context, product.id)
    const later = stock.balances.find(({ lotNo }) => lotNo === 'LATER')!

    await adjust(context, [line(variantId, -1000, { lotId: later.lotId })])
    const left = Object.fromEntries((await onHand(context, product.id)).balances.map(({ lotNo, qtyMilli }) => [lotNo, qtyMilli]))
    expect(left).toEqual({ SOON: 2000, LATER: 1000 })
  })

  it('leaves expired stock alone, except when writing it off', async () => {
    const { product, variantId } = await tracked('دواء 5')
    await adjust(context, [
      line(variantId, 2000, { lotNo: 'OLD', expiryDate: '2020-01-01', unitCostMinor: 100 }),
      line(variantId, 2000, { lotNo: 'GOOD', expiryDate: '2031-01-01', unitCostMinor: 100 }),
    ])

    await adjust(context, [line(variantId, -1000)], 'gift')
    let left = Object.fromEntries((await onHand(context, product.id)).balances.map(({ lotNo, qtyMilli }) => [lotNo, qtyMilli]))
    expect(left).toEqual({ OLD: 2000, GOOD: 1000 })

    await adjust(context, [line(variantId, -2000)], 'expired')
    left = Object.fromEntries((await onHand(context, product.id)).balances.map(({ lotNo, qtyMilli }) => [lotNo, qtyMilli]))
    expect(left).toEqual({ GOOD: 1000 })
  })

  it('refuses to issue when only expired stock is left', async () => {
    const { variantId } = await tracked('دواء 6')
    await adjust(context, [line(variantId, 2000, { lotNo: 'OLD', expiryDate: '2020-01-01' })])
    const document = await draft(context, { reason: 'gift', lines: [line(variantId, -1000)] })
    const failure = await context.harness.failure('POST', `/stock/documents/${document.id}/post`, { session: context.session })
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
    expect(failure.params).toMatchObject({ available: '0', requested: '1' })
  })

  it('reports the real total when batches together fall short', async () => {
    const { variantId } = await tracked('دواء 8')
    await adjust(context, [
      line(variantId, 2000, { lotNo: 'A', expiryDate: '2030-01-01' }),
      line(variantId, 1000, { lotNo: 'B', expiryDate: '2031-01-01' }),
    ])
    const document = await draft(context, { reason: 'gift', lines: [line(variantId, -5000)] })
    const failure = await context.harness.failure('POST', `/stock/documents/${document.id}/post`, { session: context.session })
    expect(failure.params).toMatchObject({ available: '3', requested: '5' })
  })

  it('counts each batch separately', async () => {
    const { product, variantId } = await tracked('دواء 7')
    await adjust(context, [
      line(variantId, 2000, { lotNo: 'A', expiryDate: '2030-01-01' }),
      line(variantId, 3000, { lotNo: 'B', expiryDate: '2031-01-01' }),
    ])
    const stock = await onHand(context, product.id)
    const [a, b] = stock.balances

    const document = await draft(context, {
      kind: 'count',
      reason: null,
      lines: [line(variantId, 1000, { lotId: a!.lotId }), line(variantId, 3000, { lotId: b!.lotId })],
    })
    await post(context, document.id)
    expect((await onHand(context, product.id)).onHandMilli).toBe(4000)
  })

  it('finds an item for a document line by barcode, with its batches', async () => {
    const code = '96385074'
    const { variantId } = await addProduct(context, 'بحث باركود', {
      trackLots: true,
      conversions: [{ unitId: 'box', factorMilli: 10_000 }],
      variants: [{ ...emptyVariant, barcodes: [{ code, unitId: 'box' }] }],
    })
    await adjust(context, [line(variantId, 1000, { lotNo: 'Z', expiryDate: '2030-01-01' })])

    const { items } = await context.harness.json<{ items: StockPickRow[] }>('GET', `/stock/pick?warehouseId=${MAIN}&search=${code}`, {
      session: context.session,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ variantId, unitId: 'box', onHandMilli: 1000, trackLots: true })
    expect(items[0]?.lots).toEqual([expect.objectContaining({ lotNo: 'Z', availableMilli: 1000 })])
    expect(items[0]?.units).toEqual([{ unitId: 'box', factorMilli: 10_000 }])
  })
})

describe('negative stock', () => {
  it('needs both the shop setting and the permission', async () => {
    const context = await freshStore()
    const { harness, session } = context
    const { product, variantId } = await addProduct(context, 'سالب')

    const refused = await draft(context, { lines: [line(variantId, -1000)] })
    expect((await harness.failure('POST', `/stock/documents/${refused.id}/post`, { session })).code).toBe('STOCK_INSUFFICIENT')

    await harness.json('PUT', '/settings/stock-policy', { session, body: { allowNegative: true } })
    await post(context, refused.id)
    expect((await onHand(context, product.id)).onHandMilli).toBe(-1000)

    // A manager has no `stock.negative`, so the shop setting alone does not let them through.
    await harness.json<User>('POST', '/users', {
      session,
      body: { fullName: 'مدير', username: 'boss', password: 'temporary-password', roleId: 'manager' },
    })
    const login = await harness.json<Session>('POST', '/auth/login', {
      body: { username: 'boss', password: 'temporary-password' },
    })
    await harness.json('POST', '/auth/change-password', {
      session: login.token,
      body: { currentPassword: 'temporary-password', newPassword: 'manager-password' },
    })
    const manager = { harness, session: login.token }
    const other = await addProduct(context, 'سالب 2')
    const blocked = await draft(manager, { lines: [line(other.variantId, -1000)] })
    const failure = await harness.failure('POST', `/stock/documents/${blocked.id}/post`, { session: login.token })
    expect(failure.code).toBe('STOCK_INSUFFICIENT')
  })
})

describe('permissions', () => {
  it('lets a cashier look but not change stock', async () => {
    const context = await freshStore()
    const { harness, session } = context
    await harness.json('POST', '/users', {
      session,
      body: { fullName: 'كاشير', username: 'till', password: 'temporary-password', roleId: 'cashier' },
    })
    const login = await harness.json<Session>('POST', '/auth/login', { body: { username: 'till', password: 'temporary-password' } })
    await harness.json('POST', '/auth/change-password', {
      session: login.token,
      body: { currentPassword: 'temporary-password', newPassword: 'cashier-password' },
    })
    const till = login.token

    const { variantId } = await addProduct(context, 'صلاحيات')
    const document = await adjust(context, [line(variantId, 1000)])

    expect((await harness.call('GET', '/stock/documents', { session: till })).status).toBe(200)
    const body = { kind: 'adjustment', warehouseId: MAIN, lines: [] }
    expect((await harness.failure('POST', '/stock/documents', { session: till, body })).code).toBe('FORBIDDEN')
    expect((await harness.failure('POST', `/stock/documents/${document.id}/void`, { session: till })).code).toBe('FORBIDDEN')
  })
})

describe('documents, end to end', () => {
  it(
    'keeps quantity and value reconciled through any mix of documents',
    { timeout: 120_000 },
    async () => {
      const operation = fc.oneof(
        fc.record({ kind: fc.constant('in' as const), qty: fc.integer({ min: 1, max: 40 }), cost: fc.integer({ min: 0, max: 900 }) }),
        fc.record({ kind: fc.constant('out' as const), qty: fc.integer({ min: 1, max: 40 }) }),
        fc.record({ kind: fc.constant('count' as const), qty: fc.integer({ min: 0, max: 60 }) }),
        fc.record({ kind: fc.constant('void' as const), pick: fc.nat() }),
      )

      await fc.assert(
        fc.asyncProperty(fc.array(operation, { minLength: 3, maxLength: 12 }), async (operations) => {
          const context = await freshStore()
          const { harness, session } = context
          const { product, variantId } = await addProduct(context, 'خصائص')
          const posted: string[] = []
          let expected = 0

          for (const step of operations) {
            if (step.kind === 'void') {
              const id = posted[step.pick % Math.max(posted.length, 1)]
              if (!id) continue
              const response = await harness.call('POST', `/stock/documents/${id}/void`, { session })
              if (response.status === 200) {
                posted.splice(posted.indexOf(id), 1)
                expected = (await onHand(context, product.id)).onHandMilli
              }
              continue
            }

            const lines =
              step.kind === 'in'
                ? [line(variantId, step.qty * 1000, { unitCostMinor: step.cost })]
                : [line(variantId, step.kind === 'out' ? -step.qty * 1000 : step.qty * 1000)]
            const document = await draft(context, {
              kind: step.kind === 'count' ? 'count' : 'adjustment',
              reason: step.kind === 'count' ? null : 'correction',
              lines,
            })
            const response = await harness.call('POST', `/stock/documents/${document.id}/post`, { session })
            if (response.status === 200) {
              posted.push(document.id)
              if (step.kind === 'in') expected += step.qty * 1000
              else if (step.kind === 'out') expected -= step.qty * 1000
              else expected = step.qty * 1000
            }
          }

          const stock = await onHand(context, product.id)
          expect(stock.onHandMilli).toBe(expected)
          expect(stock.onHandMilli).toBeGreaterThanOrEqual(0)

          const movements = await harness.deps.db.selectFrom('stock_movements').selectAll().execute()
          expect(movements.reduce((sum, { qty_milli }) => sum + Number(qty_milli), 0)).toBe(stock.onHandMilli)
          expect(movements.reduce((sum, { value_minor }) => sum + Number(value_minor), 0)).toBe(stock.valueMinor)
          if (stock.onHandMilli === 0) expect(stock.valueMinor).toBe(0)
        }),
        { numRuns: 25 },
      )
    },
  )
})

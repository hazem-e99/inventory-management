import type { ProductInput, Product, ProductLabel, ProductPage, Reference, Session, User } from '@inv/contracts'
import { gs1CheckDigit } from '@inv/domain'
import { beforeAll, describe, expect, it } from 'vitest'
import { onboarded, type Harness } from './harness'

let harness: Harness
let session: string

const VALID_EAN = `622100000001${gs1CheckDigit('622100000001')}`
const OTHER_EAN = '4006381333931'

function productBody(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: 'بنادول اكسترا',
    baseUnitId: 'strip',
    prescriptionRequired: false,
    trackLots: true,
    trackSerials: false,
    conversions: [{ unitId: 'box', factorMilli: 3000 }],
    variants: [
      {
        label: null,
        costMinor: 3000,
        barcodes: [{ code: VALID_EAN, unitId: 'strip' }],
        prices: [
          { priceListId: 'retail', unitId: 'strip', amountMinor: 4550 },
          { priceListId: 'retail', unitId: 'box', amountMinor: 12500 },
        ],
        attributeValueIds: [],
      },
    ],
    ...overrides,
  }
}

const create = (body: ProductInput) => harness.json<Product>('POST', '/products', { session, body })
const failure = (body: ProductInput) => harness.failure('POST', '/products', { session, body })

beforeAll(async () => {
  const context = await onboarded()
  harness = context.harness
  session = context.owner.token
})

describe('creating a product', () => {
  it('saves units, conversions, prices and barcodes, and generates a SKU', async () => {
    const product = await create(productBody())

    expect(product.conversions).toEqual([{ unitId: 'box', factorMilli: 3000 }])
    expect(product.variants[0]).toMatchObject({ sku: 'SKU-000001', isDefault: true, costMinor: 3000 })
    expect(product.variants[0]?.barcodes).toEqual([{ code: VALID_EAN, unitId: 'strip' }])
    expect(product.variants[0]?.prices).toHaveLength(2)
  })

  it('names the exact field for a barcode already in use', async () => {
    const failed = await failure(productBody({ name: 'صنف آخر' }))
    expect(failed.fields).toEqual({ 'variants.0.barcodes.0.code': ['BARCODE_TAKEN'] })
  })

  it('catches a typo through the check digit', async () => {
    const body = productBody()
    body.variants[0]!.barcodes = [{ code: '4006381333932', unitId: 'strip' }]
    expect((await failure(body)).fields).toEqual({ 'variants.0.barcodes.0.code': ['BARCODE_INVALID'] })
  })

  it('refuses a price or barcode in a unit the product does not use', async () => {
    const body = productBody({ conversions: [] })
    const failed = await failure(body)
    expect(failed.fields?.['variants.0.prices.1.unitId']).toEqual(['UNIT_NOT_FOUND'])
  })

  it('refuses the same barcode twice in one form', async () => {
    const body = productBody()
    body.variants[0]!.barcodes = [
      { code: OTHER_EAN, unitId: 'strip' },
      { code: OTHER_EAN, unitId: 'box' },
    ]
    expect((await failure(body)).fields).toEqual({ 'variants.0.barcodes.1.code': ['BARCODE_DUPLICATED'] })
  })

  it('refuses a conversion that repeats the base unit', async () => {
    const body = productBody({ conversions: [{ unitId: 'strip', factorMilli: 1000 }] })
    expect((await failure(body)).fields?.['conversions.0.unitId']).toEqual(['UNIT_DUPLICATED'])
  })

  it('needs a label on each variant when there is more than one', async () => {
    const variant = { label: null, costMinor: 0, barcodes: [], prices: [], attributeValueIds: [] }
    const failed = await failure(productBody({ conversions: [], variants: [variant, variant] }))
    expect(failed.fields).toEqual({
      'variants.0.label': ['VARIANT_LABEL_REQUIRED'],
      'variants.1.label': ['VARIANT_LABEL_REQUIRED'],
    })
  })

  it('needs at least one variant', async () => {
    expect((await failure(productBody({ variants: [] }))).fields).toEqual({ variants: ['VARIANT_REQUIRED'] })
  })

  it('rejects a fractional amount so no float reaches the ledger', async () => {
    const body = productBody()
    body.variants[0]!.costMinor = 12.5
    expect((await failure(body)).fields).toEqual({ 'variants.0.costMinor': ['PRICE_INVALID'] })
  })
})

describe('editing a product', () => {
  it('rebuilds search, and lets a barcode move between its own variants', async () => {
    const product = await create(productBody({ name: 'شاي', conversions: [], variants: [
      { label: null, costMinor: 0, barcodes: [{ code: '96385074', unitId: 'strip' }], prices: [], attributeValueIds: [] },
    ] }))
    const variant = product.variants[0]!

    const updated = await harness.json<Product>('PUT', `/products/${product.id}`, {
      session,
      body: productBody({
        name: 'شاي أخضر',
        conversions: [],
        variants: [
          { id: variant.id, label: 'صغير', costMinor: 0, barcodes: [], prices: [], attributeValueIds: [] },
          { label: 'كبير', costMinor: 0, barcodes: [{ code: '96385074', unitId: 'strip' }], prices: [], attributeValueIds: [] },
        ],
      }),
    })

    expect(updated.variants.map((item) => item.label)).toEqual(['صغير', 'كبير'])
    expect(updated.variants[1]?.barcodes[0]?.code).toBe('96385074')

    const page = await harness.json<ProductPage>('GET', `/products?search=${encodeURIComponent('اخضر')}`, { session })
    expect(page.items.map((item) => item.name)).toEqual(['شاي أخضر'])
  })

  it('refuses a variant belonging to another product', async () => {
    const first = await create(productBody({ name: 'أ', conversions: [], variants: [{ costMinor: 0, label: null, barcodes: [], prices: [], attributeValueIds: [] }] }))
    const second = await create(productBody({ name: 'ب', conversions: [], variants: [{ costMinor: 0, label: null, barcodes: [], prices: [], attributeValueIds: [] }] }))

    const failed = await harness.failure('PUT', `/products/${first.id}`, {
      session,
      body: productBody({
        name: 'أ',
        conversions: [],
        variants: [{ id: second.variants[0]!.id, costMinor: 0, label: null, barcodes: [], prices: [], attributeValueIds: [] }],
      }),
    })
    expect(failed.code).toBe('NOT_FOUND')
  })

  it('archives and restores, moving between the lists', async () => {
    const product = await create(productBody({ name: 'مؤرشف جدا', conversions: [], variants: [{ costMinor: 0, label: null, barcodes: [], prices: [], attributeValueIds: [] }] }))
    const search = `/products?search=${encodeURIComponent('مؤرشف')}`

    await harness.json('POST', `/products/${product.id}/archive`, { session })
    expect((await harness.json<ProductPage>('GET', search, { session })).total).toBe(0)
    expect((await harness.json<ProductPage>('GET', `${search}&archived=true`, { session })).total).toBe(1)

    await harness.json('POST', `/products/${product.id}/restore`, { session })
    expect((await harness.json<ProductPage>('GET', search, { session })).total).toBe(1)
  })
})

describe('barcode tools', () => {
  it('generates valid, unique in-store barcodes', async () => {
    const first = await harness.json<{ code: string }>('POST', '/catalog/barcodes/generate', { session })
    const second = await harness.json<{ code: string }>('POST', '/catalog/barcodes/generate', { session })
    expect(first.code).toMatch(/^200\d{10}$/)
    expect(first.code).not.toBe(second.code)
  })

  it('returns label data with the price in the barcode unit', async () => {
    const product = await create(
      productBody({
        name: 'صنف ملصق',
        variants: [
          {
            label: null,
            costMinor: 0,
            barcodes: [{ code: OTHER_EAN, unitId: 'strip' }],
            prices: [{ priceListId: 'retail', unitId: 'strip', amountMinor: 999 }],
            attributeValueIds: [],
          },
        ],
      }),
    )
    const { items } = await harness.json<{ items: ProductLabel[] }>('GET', `/products/${product.id}/labels`, { session })
    expect(items).toEqual([expect.objectContaining({ barcode: OTHER_EAN, priceMinor: 999, productName: 'صنف ملصق' })])
  })
})

describe('reference data', () => {
  const add = (kind: string, body: object) => harness.json<Reference>('POST', `/catalog/${kind}`, { session, body })

  it('flags a duplicate name on the name field', async () => {
    await add('brands', { name: 'نوفارتس' })
    const failed = await harness.failure('POST', '/catalog/brands', { session, body: { name: 'نوفارتس' } })
    expect(failed.fields).toEqual({ name: ['NAME_TAKEN'] })
  })

  it('protects built-in rows from renaming and deletion, but allows rate changes', async () => {
    const rename = await harness.failure('PUT', '/catalog/units/piece', { session, body: { name: 'عدد' } })
    const remove = await harness.failure('DELETE', '/catalog/units/piece', { session })
    expect([rename.code, remove.code]).toEqual(['REFERENCE_IS_SYSTEM', 'REFERENCE_IS_SYSTEM'])

    const tax = await harness.json<Reference>('PUT', '/catalog/tax-rates/vat', {
      session,
      body: { name: 'vat', rateBp: 1500 },
    })
    expect(tax.rateBp).toBe(1500)
  })

  it('says how many products block a delete, and archiving still works', async () => {
    const category = await add('categories', { name: 'مسكنات' })
    await create(productBody({ name: 'مسكن', categoryId: category.id, conversions: [], variants: [{ costMinor: 0, label: null, barcodes: [], prices: [], attributeValueIds: [] }] }))

    const failed = await harness.failure('DELETE', `/catalog/categories/${category.id}`, { session })
    expect(failed.code).toBe('REFERENCE_IN_USE')
    expect(failed.params).toEqual({ count: 1 })

    const archived = await harness.json<Reference>('PUT', `/catalog/categories/${category.id}`, {
      session,
      body: { name: 'مسكنات', archived: true },
    })
    expect(archived.archived).toBe(true)
  })

  it('refuses a category loop', async () => {
    const parent = await add('categories', { name: 'أب' })
    const child = await add('categories', { name: 'ابن', parentId: parent.id })
    const failed = await harness.failure('PUT', `/catalog/categories/${parent.id}`, {
      session,
      body: { name: 'أب', parentId: child.id },
    })
    expect(failed.fields).toEqual({ parentId: ['CATEGORY_CYCLE'] })
  })

  it('deletes an unused row', async () => {
    const unit = await add('units', { name: 'دستة', allowsFraction: false })
    expect((await harness.call('DELETE', `/catalog/units/${unit.id}`, { session })).status).toBe(200)
  })
})

describe('catalog permissions', () => {
  it('lets a cashier read but not change', async () => {
    await harness.json<User>('POST', '/users', {
      session,
      body: { fullName: 'كاشير', username: 'till', password: 'temporary-password', roleId: 'cashier' },
    })
    const login = await harness.json<Session>('POST', '/auth/login', {
      body: { username: 'till', password: 'temporary-password' },
    })
    await harness.json('POST', '/auth/change-password', {
      session: login.token,
      body: { currentPassword: 'temporary-password', newPassword: 'cashier-password' },
    })

    expect((await harness.call('GET', '/products', { session: login.token })).status).toBe(200)
    expect((await harness.failure('POST', '/products', { session: login.token, body: productBody() })).code).toBe('FORBIDDEN')
    expect(
      (await harness.failure('POST', '/catalog/import/preview', { session: login.token, body: { path: 'x.xlsx' } })).code,
    ).toBe('FORBIDDEN')
  })
})

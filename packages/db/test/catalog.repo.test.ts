import { buildSearchText, searchTerms } from '@inv/domain'
import type { Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  attributesRepo,
  catalogRepo,
  classifyConstraintError,
  migrateToLatest,
  newId,
  nextSequence,
  referenceRepo,
  type Database,
} from '../src'
import { dialects, tempDir } from './helpers'

const dir = tempDir()

async function addProduct(
  db: Kysely<Database>,
  name: string,
  options: { barcode?: string; priceMinor?: number; categoryId?: string; generic?: string } = {},
) {
  const repo = catalogRepo(db)
  const id = newId()
  const variantId = newId()
  const text = buildSearchText([name, options.generic, options.barcode])
  await repo.insertProduct({
    id,
    name,
    name_en: null,
    generic_name: options.generic ?? null,
    description: null,
    search_text: text,
    category_id: options.categoryId ?? null,
    brand_id: null,
    tax_rate_id: 'vat',
    base_unit_id: 'piece',
    prescription_required: 0,
    track_lots: 0,
    track_serials: 0,
    created_at: 1,
    updated_at: 1,
  })
  await repo.insertVariant({
    id: variantId,
    product_id: id,
    sku: `SKU-${variantId}`,
    label: null,
    cost_minor: 500,
    is_default: 1,
    created_at: 1,
    updated_at: 1,
  })
  if (options.barcode) await repo.replaceBarcodes(variantId, [{ code: options.barcode, unitId: 'piece' }], 1)
  if (options.priceMinor !== undefined) {
    await repo.replacePrices(variantId, [{ price_list_id: 'retail', unit_id: 'piece', amount_minor: options.priceMinor }])
  }
  await repo.indexNewProduct(id, text)
  return { id, variantId }
}

describe.each(dialects(dir))('catalog on %s', (_name, create) => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = create()
    await migrateToLatest(db)
    await addProduct(db, 'بنادول اكسترا', { barcode: '6221000000017', priceMinor: 4550, generic: 'باراسيتامول' })
    await addProduct(db, 'أموكسيسيلين 500', { barcode: '6221000000024', priceMinor: 8000 })
    await addProduct(db, 'حليب كامل الدسم', { priceMinor: 3500 })
  })

  afterAll(() => db.destroy())

  const search = async (text: string) => {
    const { items } = await catalogRepo(db).listProducts({ terms: searchTerms(text), archived: false, limit: 50 })
    return items.map((item) => item.name)
  }

  it('seeds units, taxes and the default price list', async () => {
    const units = await referenceRepo(db, 'units').list()
    expect(units.map((unit) => unit.id)).toEqual(expect.arrayContaining(['piece', 'box', 'kilogram']))
    expect(units.find((unit) => unit.id === 'kilogram')?.allowsFraction).toBe(true)
    expect((await referenceRepo(db, 'tax_rates').find('vat'))?.rateBp).toBe(1400)
    expect((await referenceRepo(db, 'price_lists').find('retail'))?.isSystem).toBe(true)
  })

  it('finds a product despite Arabic spelling differences', async () => {
    expect(await search('اموكسيسيلين')).toEqual(['أموكسيسيلين 500'])
  })

  it('matches by prefix and across fields', async () => {
    expect(await search('بناد')).toEqual(['بنادول اكسترا'])
    expect(await search('باراسيت')).toEqual(['بنادول اكسترا'])
    expect(await search('بنادول باراسيتامول')).toEqual(['بنادول اكسترا'])
  })

  it('finds by barcode text', async () => {
    expect(await search('6221000000024')).toEqual(['أموكسيسيلين 500'])
  })

  it('returns nothing for an unmatched search', async () => {
    expect(await search('غير موجود')).toEqual([])
  })

  it('treats search punctuation as text, not query syntax', async () => {
    expect(await search('"بنادول" OR *')).toEqual([])
  })

  it('lists with the joined details, as numbers', async () => {
    const { items } = await catalogRepo(db).listProducts({ terms: searchTerms('بنادول'), archived: false, limit: 10 })
    expect(items[0]).toMatchObject({
      barcode: '6221000000017',
      priceMinor: 4550,
      variantCount: 1,
      archived: false,
    })
  })

  it('pages by name without gaps or repeats, including equal names', async () => {
    await addProduct(db, 'زجاجة')
    await addProduct(db, 'زجاجة')
    await addProduct(db, 'زجاجة')
    const repo = catalogRepo(db)

    const first = await repo.listProducts({ terms: searchTerms('زجاجه'), archived: false, limit: 2 })
    const second = await repo.listProducts({
      terms: searchTerms('زجاجه'),
      archived: false,
      limit: 2,
      cursor: first.nextCursor!,
    })

    const ids = [...first.items, ...second.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(3)
    expect(second.nextCursor).toBeNull()
  })

  it('counts what the filter matches', async () => {
    expect(await catalogRepo(db).countProducts({ terms: searchTerms('زجاجه'), archived: false })).toBe(3)
  })

  it('filters by category and hides archived products', async () => {
    const categoryId = await referenceRepo(db, 'categories').insert({ name: 'أدوية' }, 1)
    const { id } = await addProduct(db, 'شراب كحة', { categoryId })
    const repo = catalogRepo(db)

    expect((await repo.listProducts({ terms: [], categoryId, archived: false, limit: 10 })).items).toHaveLength(1)

    await repo.updateProduct(id, { archived_at: 5 })
    await repo.removeFromSearch(id)
    expect((await repo.listProducts({ terms: [], categoryId, archived: false, limit: 10 })).items).toHaveLength(0)
    expect((await repo.listProducts({ terms: [], categoryId, archived: true, limit: 10 })).items).toHaveLength(1)
  })

  it('searches archived products too, on request', async () => {
    const { id } = await addProduct(db, 'صنف قديم جدا')
    const repo = catalogRepo(db)
    await repo.updateProduct(id, { archived_at: 5 })
    await repo.removeFromSearch(id)

    const terms = searchTerms('قديم')
    expect((await repo.listProducts({ terms, archived: false, limit: 10 })).items).toHaveLength(0)
    expect(await repo.countProducts({ terms, archived: false })).toBe(0)
    expect((await repo.listProducts({ terms, archived: true, limit: 10 })).items).toHaveLength(1)
    expect(await repo.countProducts({ terms, archived: true })).toBe(1)
  })

  it('combines a text search with a category filter', async () => {
    const categoryId = await referenceRepo(db, 'categories').insert({ name: 'مكملات' }, 1)
    await addProduct(db, 'زنك 50', { categoryId })
    await addProduct(db, 'زنك 100')

    const repo = catalogRepo(db)
    const terms = searchTerms('زنك')
    expect(await repo.countProducts({ terms, archived: false })).toBe(2)
    expect(await repo.countProducts({ terms, categoryId, archived: false })).toBe(1)
    const { items } = await repo.listProducts({ terms, categoryId, archived: false, limit: 10 })
    expect(items.map((item) => item.name)).toEqual(['زنك 50'])
  })

  it('refuses a duplicate barcode at the database level', async () => {
    const { variantId } = await addProduct(db, 'صنف مكرر')
    const error = await catalogRepo(db)
      .replaceBarcodes(variantId, [{ code: '6221000000017', unitId: 'piece' }], 1)
      .catch((reason: unknown) => reason)
    expect(classifyConstraintError(error)?.kind).toBe('unique')
  })

  it('refuses two top-level categories with one name, but allows them under different parents', async () => {
    const categories = referenceRepo(db, 'categories')
    const parent = await categories.insert({ name: 'ألبان' }, 1)
    const error = await categories.insert({ name: 'ألبان' }, 2).catch((reason: unknown) => reason)
    expect(classifyConstraintError(error)?.kind).toBe('unique')

    await categories.insert({ name: 'أجبان', parentId: parent }, 3)
    const other = await categories.insert({ name: 'معلبات' }, 4)
    await expect(categories.insert({ name: 'أجبان', parentId: other }, 5)).resolves.toBeTruthy()
  })

  it('reports how many products use a reference, and refuses to delete it', async () => {
    const brands = referenceRepo(db, 'brands')
    const brandId = await brands.insert({ name: 'جلاكسو' }, 1)
    const { id } = await addProduct(db, 'صنف بماركة')
    await catalogRepo(db).updateProduct(id, { brand_id: brandId })

    expect((await brands.find(brandId))?.usageCount).toBe(1)
    const error = await brands.delete(brandId).catch((reason: unknown) => reason)
    expect(classifyConstraintError(error)?.kind).toBe('foreign_key')
  })

  it('archives only the variants that were removed', async () => {
    const { id, variantId } = await addProduct(db, 'تيشيرت')
    const repo = catalogRepo(db)
    const second = newId()
    await repo.insertVariant({
      id: second,
      product_id: id,
      sku: `SKU-${second}`,
      label: 'L',
      cost_minor: 0,
      is_default: 0,
      created_at: 2,
      updated_at: 2,
    })

    await repo.archiveMissingVariants(id, [variantId], 9)
    const loaded = await repo.loadProduct(id)
    expect(loaded?.variants.map((variant) => variant.id)).toEqual([variantId])
  })

  it('numbers sequences without gaps, and a rollback gives the number back', async () => {
    expect(await nextSequence(db, 'test')).toBe(1)
    expect(await nextSequence(db, 'test')).toBe(2)
    await db
      .transaction()
      .execute(async (trx) => {
        await nextSequence(trx, 'test')
        throw new Error('stop')
      })
      .catch(() => {})
    expect(await nextSequence(db, 'test')).toBe(3)
  })

  it('keeps attribute values unique per attribute', async () => {
    const repo = attributesRepo(db)
    await repo.addValue('size', 'XL', 1)
    await repo.addValue('color', 'XL', 2)
    const error = await repo.addValue('size', 'XL', 3).catch((reason: unknown) => reason)
    expect(classifyConstraintError(error)?.kind).toBe('unique')
    expect((await repo.list()).find((attribute) => attribute.id === 'size')?.values).toHaveLength(1)
  })
})

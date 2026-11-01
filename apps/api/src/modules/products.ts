import { createRoute, z } from '@hono/zod-openapi'
import {
  generatedBarcodeSchema,
  okSchema,
  productInputSchema,
  productLabelsSchema,
  productPageSchema,
  productQuerySchema,
  productSchema,
  type ErrorCode,
  type Product,
  type ProductOutput,
} from '@inv/contracts'
import {
  auditRepo,
  catalogRepo,
  DEFAULT_PRICE_LIST_ID,
  newId,
  nextSequence,
  referenceRepo,
  type Database,
  type Kysely,
} from '@inv/db'
import { buildSearchText, internalBarcode, internalSku, isValidBarcode, searchTerms } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'

const params = z.object({ id: z.string() })

type Fields = Record<string, ErrorCode[]>

function addIssue(fields: Fields, path: string, code: ErrorCode): void {
  fields[path] = [...(fields[path] ?? []), code]
}

/** Rules that span fields, which a single-field schema cannot express. */
function validateProduct(input: ProductOutput): Fields {
  const fields: Fields = {}
  const known = new Set([input.baseUnitId])

  input.conversions.forEach((conversion, index) => {
    if (known.has(conversion.unitId)) addIssue(fields, `conversions.${index}.unitId`, 'UNIT_DUPLICATED')
    known.add(conversion.unitId)
  })

  const codes = new Set<string>()
  input.variants.forEach((variant, variantIndex) => {
    if (input.variants.length > 1 && !variant.label) {
      addIssue(fields, `variants.${variantIndex}.label`, 'VARIANT_LABEL_REQUIRED')
    }

    variant.barcodes.forEach((barcode, barcodeIndex) => {
      const path = `variants.${variantIndex}.barcodes.${barcodeIndex}`
      if (!isValidBarcode(barcode.code)) addIssue(fields, `${path}.code`, 'BARCODE_INVALID')
      if (codes.has(barcode.code)) addIssue(fields, `${path}.code`, 'BARCODE_DUPLICATED')
      if (!known.has(barcode.unitId)) addIssue(fields, `${path}.unitId`, 'UNIT_NOT_FOUND')
      codes.add(barcode.code)
    })

    variant.prices.forEach((price, priceIndex) => {
      if (!known.has(price.unitId)) {
        addIssue(fields, `variants.${variantIndex}.prices.${priceIndex}.unitId`, 'UNIT_NOT_FOUND')
      }
    })
  })

  return fields
}

/** Names the exact input that clashes, which the unique index alone cannot do. */
async function findClashes(db: Kysely<Database>, input: ProductOutput, productId: string | null): Promise<Fields> {
  const repo = catalogRepo(db)
  const own = productId ? await repo.variantCodes(productId) : []
  const ownCodes = new Set(own.map((row) => row.code))
  const ownSkus = new Set(own.map((row) => row.sku))
  const fields: Fields = {}

  const codes = input.variants.flatMap((variant) => variant.barcodes.map(({ code }) => code))
  const skus = input.variants.flatMap((variant) => (variant.sku ? [variant.sku] : []))
  const takenCodes = await repo.existingCodes(codes.filter((code) => !ownCodes.has(code)))
  const takenSkus = await repo.existingSkus(skus.filter((sku) => !ownSkus.has(sku)))

  input.variants.forEach((variant, variantIndex) => {
    if (variant.sku && takenSkus.has(variant.sku)) addIssue(fields, `variants.${variantIndex}.sku`, 'SKU_TAKEN')
    variant.barcodes.forEach((barcode, barcodeIndex) => {
      if (takenCodes.has(barcode.code)) {
        addIssue(fields, `variants.${variantIndex}.barcodes.${barcodeIndex}.code`, 'BARCODE_TAKEN')
      }
    })
  })
  return fields
}

async function freeSku(db: Kysely<Database>): Promise<string> {
  const repo = catalogRepo(db)
  for (;;) {
    const sku = internalSku(await nextSequence(db, 'sku'))
    if ((await repo.existingSkus([sku])).size === 0) return sku
  }
}

async function searchTextFor(db: Kysely<Database>, input: ProductOutput, skus: readonly string[]): Promise<string> {
  const [category, brand] = await Promise.all([
    input.categoryId ? referenceRepo(db, 'categories').find(input.categoryId) : undefined,
    input.brandId ? referenceRepo(db, 'brands').find(input.brandId) : undefined,
  ])
  return buildSearchText([
    input.name,
    input.nameEn,
    input.genericName,
    category?.name,
    brand?.name,
    ...skus,
    ...input.variants.flatMap((variant) => [variant.label, ...variant.barcodes.map(({ code }) => code)]),
  ])
}

async function writeVariants(trx: Kysely<Database>, input: ProductOutput, productId: string, now: number) {
  const repo = catalogRepo(trx)
  const keep: string[] = []
  const skus: string[] = []

  // A barcode can move between variants in one save, so old ones must go first.
  const existing = await repo.variantCodes(productId)
  for (const id of new Set(existing.map((row) => row.id))) await repo.replaceBarcodes(id, [], now)

  for (const [index, variant] of input.variants.entries()) {
    const id = variant.id ?? newId()
    const sku = variant.sku || existing.find((row) => row.id === id)?.sku || (await freeSku(trx))
    keep.push(id)
    skus.push(sku)

    const fields = {
      sku,
      label: variant.label ?? null,
      cost_minor: variant.costMinor,
      reorder_level_milli: variant.reorderLevelMilli ?? null,
      is_default: index === 0 ? 1 : 0,
      updated_at: now,
    }
    if (variant.id) await repo.updateVariant(id, fields)
    else await repo.insertVariant({ ...fields, id, product_id: productId, created_at: now })

    await repo.replaceBarcodes(id, variant.barcodes, now)
    await repo.replacePrices(
      id,
      variant.prices.map(({ priceListId, unitId, amountMinor }) => ({
        price_list_id: priceListId,
        unit_id: unitId,
        amount_minor: amountMinor,
      })),
    )
    await repo.replaceAttributeValues(id, variant.attributeValueIds)
  }

  await repo.archiveMissingVariants(productId, keep, now)
  return skus
}

function productFields(input: ProductOutput) {
  return {
    name: input.name,
    name_en: input.nameEn ?? null,
    generic_name: input.genericName ?? null,
    description: input.description ?? null,
    category_id: input.categoryId ?? null,
    brand_id: input.brandId ?? null,
    tax_rate_id: input.taxRateId ?? null,
    base_unit_id: input.baseUnitId,
    prescription_required: input.prescriptionRequired ? 1 : 0,
    track_lots: input.trackLots ? 1 : 0,
    track_serials: input.trackSerials ? 1 : 0,
  }
}

async function loadProduct(db: Kysely<Database>, id: string): Promise<Product> {
  const loaded = await catalogRepo(db).loadProduct(id)
  if (!loaded) throw new AppError('NOT_FOUND')
  const { product, variants, conversions, barcodes, prices, attributeValues } = loaded

  return {
    id: product.id,
    name: product.name,
    nameEn: product.name_en,
    genericName: product.generic_name,
    description: product.description,
    categoryId: product.category_id,
    brandId: product.brand_id,
    taxRateId: product.tax_rate_id,
    baseUnitId: product.base_unit_id,
    prescriptionRequired: product.prescription_required === 1,
    trackLots: product.track_lots === 1,
    trackSerials: product.track_serials === 1,
    archived: product.archived_at !== null,
    conversions: conversions.map(({ unit_id, factor_milli }) => ({ unitId: unit_id, factorMilli: Number(factor_milli) })),
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      sku: variant.sku,
      costMinor: Number(variant.cost_minor),
      reorderLevelMilli: variant.reorder_level_milli === null ? null : Number(variant.reorder_level_milli),
      isDefault: variant.is_default === 1,
      barcodes: barcodes
        .filter((barcode) => barcode.variant_id === variant.id)
        .map(({ code, unit_id }) => ({ code, unitId: unit_id })),
      prices: prices
        .filter((price) => price.variant_id === variant.id)
        .map(({ price_list_id, unit_id, amount_minor }) => ({
          priceListId: price_list_id,
          unitId: unit_id,
          amountMinor: Number(amount_minor),
        })),
      attributeValueIds: attributeValues
        .filter((value) => value.variant_id === variant.id)
        .map(({ value_id }) => value_id),
    })),
  }
}

export function productRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('catalog.view')]
  const canManage = [...guard, requirePermission('catalog.manage')]

  const listRoute = createRoute({
    method: 'get',
    path: '/products',
    middleware: canView,
    request: { query: productQuerySchema },
    responses: { 200: jsonOk(productPageSchema) },
  })

  const readRoute = createRoute({
    method: 'get',
    path: '/products/{id}',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(productSchema) },
  })

  const createProductRoute = createRoute({
    method: 'post',
    path: '/products',
    middleware: canManage,
    request: { body: jsonBody(productInputSchema) },
    responses: { 200: jsonOk(productSchema) },
  })

  const updateRoute = createRoute({
    method: 'put',
    path: '/products/{id}',
    middleware: canManage,
    request: { params, body: jsonBody(productInputSchema) },
    responses: { 200: jsonOk(productSchema) },
  })

  const archiveRoute = createRoute({
    method: 'post',
    path: '/products/{id}/archive',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  const restoreRoute = createRoute({
    method: 'post',
    path: '/products/{id}/restore',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  const labelsRoute = createRoute({
    method: 'get',
    path: '/products/{id}/labels',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(productLabelsSchema) },
  })

  const generateBarcodeRoute = createRoute({
    method: 'post',
    path: '/catalog/barcodes/generate',
    middleware: canManage,
    responses: { 200: jsonOk(generatedBarcodeSchema) },
  })

  async function setArchived(id: string, archived: boolean, actorId: string): Promise<void> {
    const product = await catalogRepo(deps.db).findProduct(id)
    if (!product) throw new AppError('NOT_FOUND')
    if ((product.archived_at !== null) === archived) return

    const now = deps.clock()
    await deps.db.transaction().execute(async (trx) => {
      const repo = catalogRepo(trx)
      await repo.updateProduct(id, { archived_at: archived ? now : null, updated_at: now })
      if (archived) await repo.removeFromSearch(id)
      else await repo.indexNewProduct(id, product.search_text)
      await auditRepo(trx).record({
        actorId,
        action: archived ? 'product.archived' : 'product.restored',
        entityType: 'product',
        entityId: id,
        occurredAt: now,
      })
    })
  }

  return router()
    .openapi(listRoute, async (c) => {
      const { limit, cursor, search, categoryId, brandId, archived } = c.req.valid('query')
      const repo = catalogRepo(deps.db)
      const filter = {
        terms: searchTerms(search ?? ''),
        categoryId,
        brandId,
        archived: archived === 'true',
      }
      const [page, total] = await Promise.all([
        repo.listProducts({ ...filter, limit, cursor }),
        repo.countProducts(filter),
      ])
      return c.json({ ...page, total }, 200)
    })
    .openapi(readRoute, async (c) => c.json(await loadProduct(deps.db, c.req.valid('param').id), 200))
    .openapi(createProductRoute, async (c) => {
      const input = c.req.valid('json')
      const fields = { ...validateProduct(input), ...(await findClashes(deps.db, input, null)) }
      if (Object.keys(fields).length > 0) throw new AppError('VALIDATION_FAILED', { fields })

      const id = newId()
      const now = deps.clock()
      await deps.db.transaction().execute(async (trx) => {
        const repo = catalogRepo(trx)
        await repo.insertProduct({ ...productFields(input), id, search_text: '', created_at: now, updated_at: now })
        await repo.replaceConversions(
          id,
          input.conversions.map(({ unitId, factorMilli }) => ({ unit_id: unitId, factor_milli: factorMilli })),
        )
        const skus = await writeVariants(trx, input, id, now)
        const text = await searchTextFor(trx, input, skus)
        await repo.updateProduct(id, { search_text: text })
        await repo.indexNewProduct(id, text)
        await auditRepo(trx).record({
          actorId: c.get('actor').id,
          action: 'product.created',
          entityType: 'product',
          entityId: id,
          details: { name: input.name },
          occurredAt: now,
        })
      })
      return c.json(await loadProduct(deps.db, id), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const existing = await catalogRepo(deps.db).findProduct(id)
      if (!existing) throw new AppError('NOT_FOUND')

      const owned = new Set((await catalogRepo(deps.db).variantCodes(id)).map((row) => row.id))
      if (input.variants.some((variant) => variant.id && !owned.has(variant.id))) {
        throw new AppError('NOT_FOUND')
      }

      const fields = { ...validateProduct(input), ...(await findClashes(deps.db, input, id)) }
      if (Object.keys(fields).length > 0) throw new AppError('VALIDATION_FAILED', { fields })

      const now = deps.clock()
      await deps.db.transaction().execute(async (trx) => {
        const repo = catalogRepo(trx)
        await repo.updateProduct(id, { ...productFields(input), updated_at: now })
        await repo.replaceConversions(
          id,
          input.conversions.map(({ unitId, factorMilli }) => ({ unit_id: unitId, factor_milli: factorMilli })),
        )
        const skus = await writeVariants(trx, input, id, now)
        const text = await searchTextFor(trx, input, skus)
        await repo.updateProduct(id, { search_text: text })
        if (existing.archived_at === null) await repo.reindexProduct(id, text)
        await auditRepo(trx).record({
          actorId: c.get('actor').id,
          action: 'product.updated',
          entityType: 'product',
          entityId: id,
          occurredAt: now,
        })
      })
      return c.json(await loadProduct(deps.db, id), 200)
    })
    .openapi(archiveRoute, async (c) => {
      await setArchived(c.req.valid('param').id, true, c.get('actor').id)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(restoreRoute, async (c) => {
      await setArchived(c.req.valid('param').id, false, c.get('actor').id)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(labelsRoute, async (c) => {
      const product = await loadProduct(deps.db, c.req.valid('param').id)
      const items = product.variants.flatMap((variant) => {
        const barcode = variant.barcodes.find(({ unitId }) => unitId === product.baseUnitId) ?? variant.barcodes[0]
        if (!barcode) return []
        const price = variant.prices.find(
          ({ priceListId, unitId }) => priceListId === DEFAULT_PRICE_LIST_ID && unitId === barcode.unitId,
        )
        return [
          {
            variantId: variant.id,
            productName: product.name,
            variantLabel: variant.label,
            barcode: barcode.code,
            priceMinor: price?.amountMinor ?? null,
          },
        ]
      })
      return c.json({ items }, 200)
    })
    .openapi(generateBarcodeRoute, async (c) => {
      const repo = catalogRepo(deps.db)
      for (;;) {
        const code = internalBarcode(await nextSequence(deps.db, 'internal_barcode'))
        if ((await repo.existingCodes([code])).size === 0) return c.json({ code }, 200)
      }
    })
}

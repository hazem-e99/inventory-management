import { createRoute } from '@hono/zod-openapi'
import {
  catalogDestinationSchema,
  catalogFileSchema,
  fileSavedSchema,
  IMPORT_COLUMN_KEYS,
  IMPORT_COLUMNS,
  importIssuesExportSchema,
  importReportSchema,
  MAX_IMPORT_ROWS,
  SYSTEM_UNITS,
  type ErrorCode,
  type ImportColumn,
  type ImportIssue,
  type ImportReport,
  type Locale,
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
import {
  buildSearchText,
  internalSku,
  isValidBarcode,
  moneyToText,
  normalizeSearchText,
  parseMoney,
} from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { readCatalogFile, writeSheet, type SheetRows } from './catalog-files'
import { storeSettings } from './store'

const QUERY_CHUNK = 500
const EXPORT_LIMIT = 200_000
const DEFAULT_UNIT_ID = 'piece'
const MAX_NAME_LENGTH = 120

interface ValidRow {
  row: number
  name: string
  nameEn: string | null
  genericName: string | null
  category: string | null
  brand: string | null
  unitId: string
  barcode: string | null
  sku: string | null
  priceMinor: number | null
  costMinor: number
}

interface Analysis {
  report: ImportReport
  rows: ValidRow[]
}

function mapHeaders(header: readonly string[]): Map<ImportColumn, number> {
  const aliases = new Map<string, ImportColumn>()
  for (const key of IMPORT_COLUMN_KEYS) {
    for (const alias of [...IMPORT_COLUMNS[key].ar, ...IMPORT_COLUMNS[key].en]) {
      aliases.set(normalizeSearchText(alias), key)
    }
  }

  const columns = new Map<ImportColumn, number>()
  header.forEach((title, index) => {
    const key = aliases.get(normalizeSearchText(title))
    if (key && !columns.has(key)) columns.set(key, index)
  })
  return columns
}

async function chunkedLookup(
  values: readonly string[],
  lookup: (chunk: readonly string[]) => Promise<Set<string>>,
): Promise<Set<string>> {
  const found = new Set<string>()
  for (let start = 0; start < values.length; start += QUERY_CHUNK) {
    for (const value of await lookup(values.slice(start, start + QUERY_CHUNK))) found.add(value)
  }
  return found
}

async function unitIndex(db: Kysely<Database>): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  for (const unit of await referenceRepo(db, 'units').list()) index.set(normalizeSearchText(unit.name), unit.id)
  for (const [id, names] of Object.entries(SYSTEM_UNITS)) {
    index.set(normalizeSearchText(names.ar), id)
    index.set(normalizeSearchText(names.en), id)
  }
  return index
}

async function nameIndex(db: Kysely<Database>, table: 'categories' | 'brands'): Promise<Map<string, string>> {
  const rows = await referenceRepo(db, table).list()
  return new Map(rows.map((row) => [normalizeSearchText(row.name), row.id]))
}

/** Validates the whole file without writing, so the preview and the import can never disagree. */
async function analyse(db: Kysely<Database>, sheet: SheetRows): Promise<Analysis> {
  const [header = [], ...body] = sheet
  const columns = mapHeaders(header)

  const missing = IMPORT_COLUMN_KEYS.filter((key) => IMPORT_COLUMNS[key].required && !columns.has(key))
  if (missing.length > 0) {
    throw new AppError('IMPORT_COLUMNS_MISSING', {
      params: { columns: missing.map((key) => IMPORT_COLUMNS[key].ar[0]).join(', ') },
    })
  }

  const dataRows = body
    .map((cells, index) => ({ cells, row: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell !== ''))

  if (dataRows.length === 0) throw new AppError('IMPORT_EMPTY')
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new AppError('IMPORT_TOO_MANY_ROWS', { params: { limit: MAX_IMPORT_ROWS } })
  }

  const cell = (cells: readonly string[], key: ImportColumn): string => {
    const index = columns.get(key)
    return index === undefined ? '' : (cells[index] ?? '')
  }

  const repo = catalogRepo(db)
  const units = await unitIndex(db)
  const categories = await nameIndex(db, 'categories')
  const brands = await nameIndex(db, 'brands')

  const allCodes = dataRows.map(({ cells }) => cell(cells, 'barcode')).filter(Boolean)
  const allSkus = dataRows.map(({ cells }) => cell(cells, 'sku')).filter(Boolean)
  const takenCodes = await chunkedLookup(allCodes, (chunk) => repo.existingCodes(chunk))
  const takenSkus = await chunkedLookup(allSkus, (chunk) => repo.existingSkus(chunk))

  const seenCodes = new Set<string>()
  const seenSkus = new Set<string>()
  const newCategories = new Map<string, string>()
  const newBrands = new Map<string, string>()
  const issues: ImportIssue[] = []
  const rows: ValidRow[] = []

  for (const { cells, row } of dataRows) {
    const rowIssues: ImportIssue[] = []
    const report = (column: ImportColumn, code: ErrorCode, value: string) =>
      rowIssues.push({ row, column, code, value: value || null })

    const name = cell(cells, 'name')
    if (!name) report('name', 'REQUIRED', name)
    else if (name.length > MAX_NAME_LENGTH) report('name', 'TEXT_TOO_LONG', name)

    const barcode = cell(cells, 'barcode')
    if (barcode) {
      if (!isValidBarcode(barcode)) report('barcode', 'BARCODE_INVALID', barcode)
      else if (seenCodes.has(barcode)) report('barcode', 'BARCODE_DUPLICATED', barcode)
      else if (takenCodes.has(barcode)) report('barcode', 'BARCODE_TAKEN', barcode)
      seenCodes.add(barcode)
    }

    const sku = cell(cells, 'sku')
    if (sku) {
      if (seenSkus.has(sku)) report('sku', 'SKU_TAKEN', sku)
      else if (takenSkus.has(sku)) report('sku', 'SKU_TAKEN', sku)
      seenSkus.add(sku)
    }

    const unitText = cell(cells, 'unit')
    const unitId = unitText ? units.get(normalizeSearchText(unitText)) : DEFAULT_UNIT_ID
    if (!unitId) report('unit', 'UNIT_NOT_FOUND', unitText)

    const priceText = cell(cells, 'price')
    const priceMinor = priceText ? parseMoney(priceText) : null
    if (priceText && priceMinor === null) report('price', 'PRICE_INVALID', priceText)

    const costText = cell(cells, 'cost')
    const costMinor = costText ? parseMoney(costText) : 0
    if (costMinor === null) report('cost', 'PRICE_INVALID', costText)

    if (rowIssues.length > 0) {
      issues.push(...rowIssues)
      continue
    }

    const category = cell(cells, 'category') || null
    const categoryKey = category ? normalizeSearchText(category) : ''
    if (category && !categories.has(categoryKey)) newCategories.set(categoryKey, category)

    const brand = cell(cells, 'brand') || null
    const brandKey = brand ? normalizeSearchText(brand) : ''
    if (brand && !brands.has(brandKey)) newBrands.set(brandKey, brand)

    rows.push({
      row,
      name,
      nameEn: cell(cells, 'nameEn') || null,
      genericName: cell(cells, 'genericName') || null,
      category,
      brand,
      unitId: unitId!,
      barcode: barcode || null,
      sku: sku || null,
      priceMinor,
      costMinor: costMinor!,
    })
  }

  return {
    rows,
    report: {
      totalRows: dataRows.length,
      validRows: rows.length,
      importedRows: 0,
      newCategories: [...newCategories.values()],
      newBrands: [...newBrands.values()],
      issues,
    },
  }
}

async function commit(deps: AppDeps, analysis: Analysis, actorId: string): Promise<ImportReport> {
  const now = deps.clock()
  const { lots, serialNumbers } = await storeSettings(deps.db).features()

  await deps.db.transaction().execute(async (trx) => {
    const repo = catalogRepo(trx)
    const categories = await nameIndex(trx, 'categories')
    const brands = await nameIndex(trx, 'brands')
    const categoriesRepo = referenceRepo(trx, 'categories')
    const brandsRepo = referenceRepo(trx, 'brands')

    const resolve = async (
      name: string | null,
      index: Map<string, string>,
      insert: (name: string) => Promise<string>,
    ): Promise<string | null> => {
      if (!name) return null
      const key = normalizeSearchText(name)
      const existing = index.get(key)
      if (existing) return existing
      const id = await insert(name)
      index.set(key, id)
      return id
    }

    for (const row of analysis.rows) {
      const categoryId = await resolve(row.category, categories, (name) => categoriesRepo.insert({ name }, now))
      const brandId = await resolve(row.brand, brands, (name) => brandsRepo.insert({ name }, now))

      const productId = newId()
      const variantId = newId()
      const sku = row.sku ?? internalSku(await nextSequence(trx, 'sku'))
      const text = buildSearchText([row.name, row.nameEn, row.genericName, row.category, row.brand, sku, row.barcode])

      await repo.insertProduct({
        id: productId,
        name: row.name,
        name_en: row.nameEn,
        generic_name: row.genericName,
        description: null,
        search_text: text,
        category_id: categoryId,
        brand_id: brandId,
        tax_rate_id: null,
        base_unit_id: row.unitId,
        prescription_required: 0,
        track_lots: lots ? 1 : 0,
        track_serials: serialNumbers ? 1 : 0,
        created_at: now,
        updated_at: now,
      })
      await repo.insertVariant({
        id: variantId,
        product_id: productId,
        sku,
        label: null,
        cost_minor: row.costMinor,
        is_default: 1,
        created_at: now,
        updated_at: now,
      })
      if (row.barcode) await repo.replaceBarcodes(variantId, [{ code: row.barcode, unitId: row.unitId }], now)
      if (row.priceMinor !== null) {
        await repo.replacePrices(variantId, [
          { price_list_id: DEFAULT_PRICE_LIST_ID, unit_id: row.unitId, amount_minor: row.priceMinor },
        ])
      }
      await repo.indexNewProduct(productId, text)
    }

    await auditRepo(trx).record({
      actorId,
      action: 'catalog.imported',
      details: { imported: analysis.rows.length, rejected: analysis.report.totalRows - analysis.rows.length },
      occurredAt: now,
    })
  })

  return { ...analysis.report, importedRows: analysis.rows.length }
}

const columnTitles = (locale: Locale) => IMPORT_COLUMN_KEYS.map((key) => IMPORT_COLUMNS[key][locale][0])

function unitLabel(name: string, locale: Locale): string {
  const system = SYSTEM_UNITS[name as keyof typeof SYSTEM_UNITS]
  return system ? system[locale] : name
}

export function catalogFileRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent, requirePermission('catalog.import')]

  const previewRoute = createRoute({
    method: 'post',
    path: '/catalog/import/preview',
    middleware: guard,
    request: { body: jsonBody(catalogFileSchema) },
    responses: { 200: jsonOk(importReportSchema) },
  })

  const importRoute = createRoute({
    method: 'post',
    path: '/catalog/import',
    middleware: guard,
    request: { body: jsonBody(catalogFileSchema) },
    responses: { 200: jsonOk(importReportSchema) },
  })

  const templateRoute = createRoute({
    method: 'post',
    path: '/catalog/import/template',
    middleware: guard,
    request: { body: jsonBody(catalogDestinationSchema) },
    responses: { 200: jsonOk(fileSavedSchema) },
  })

  const issuesRoute = createRoute({
    method: 'post',
    path: '/catalog/import/issues',
    middleware: guard,
    request: { body: jsonBody(importIssuesExportSchema) },
    responses: { 200: jsonOk(fileSavedSchema) },
  })

  const exportRoute = createRoute({
    method: 'post',
    path: '/catalog/export',
    middleware: guard,
    request: { body: jsonBody(catalogDestinationSchema) },
    responses: { 200: jsonOk(fileSavedSchema) },
  })

  return router()
    .openapi(previewRoute, async (c) => {
      const sheet = await readCatalogFile(c.req.valid('json').path)
      return c.json((await analyse(deps.db, sheet)).report, 200)
    })
    .openapi(importRoute, async (c) => {
      const sheet = await readCatalogFile(c.req.valid('json').path)
      const analysis = await analyse(deps.db, sheet)
      return c.json(await commit(deps, analysis, c.get('actor').id), 200)
    })
    .openapi(templateRoute, async (c) => {
      const { destination, locale } = c.req.valid('json')
      await writeSheet([columnTitles(locale)], destination)
      return c.json({ rows: 0 }, 200)
    })
    .openapi(issuesRoute, async (c) => {
      const { destination, rows } = c.req.valid('json')
      await writeSheet(rows, destination)
      return c.json({ rows: rows.length - 1 }, 200)
    })
    .openapi(exportRoute, async (c) => {
      const { destination, locale } = c.req.valid('json')
      const rows = await catalogRepo(deps.db).exportRows(EXPORT_LIMIT)
      await writeSheet(
        [
          columnTitles(locale),
          ...rows.map((row) => [
            row.name,
            row.name_en,
            row.generic_name,
            row.category_name,
            row.brand_name,
            unitLabel(row.unit_name, locale),
            row.barcode,
            row.sku,
            row.price_minor === null ? null : moneyToText(Number(row.price_minor)),
            moneyToText(Number(row.cost_minor)),
          ]),
        ],
        destination,
      )
      await auditRepo(deps.db).record({
        actorId: c.get('actor').id,
        action: 'catalog.exported',
        details: { rows: rows.length },
        occurredAt: deps.clock(),
      })
      return c.json({ rows: rows.length }, 200)
    })
}

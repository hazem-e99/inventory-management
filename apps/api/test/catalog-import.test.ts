import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSheet } from 'read-excel-file/node'
import type { ImportReport, ProductPage, Reference } from '@inv/contracts'
import { gs1CheckDigit } from '@inv/domain'
import { afterAll, describe, expect, it } from 'vitest'
import { parseCsv, writeSheet } from '../src/modules/catalog-files'
import { onboarded } from './harness'

const dir = mkdtempSync(join(tmpdir(), 'inv-import-'))
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

let fileNumber = 0
const HEADER = ['اسم الصنف', 'الباركود', 'سعر البيع', 'سعر الشراء', 'الوحدة', 'التصنيف', 'الماركة', 'كود الصنف']

async function workbook(rows: Array<Array<string | number | null>>): Promise<string> {
  const path = join(dir, `file-${fileNumber++}.xlsx`)
  await writeSheet(rows, path)
  return path
}

const ean = (index: number) => {
  const body = `622${String(index).padStart(9, '0')}`
  return body + String(gs1CheckDigit(body))
}

describe('parseCsv', () => {
  it('handles quotes, embedded commas and new lines', () => {
    expect(parseCsv('name,price\r\n"شاي, أخضر",12.5\n"سطر\nثاني",3')).toEqual([
      ['name', 'price'],
      ['شاي, أخضر', '12.5'],
      ['سطر\nثاني', '3'],
    ])
  })

  it('detects the semicolons Excel writes on Arabic Windows', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"قال ""نعم"""')).toEqual([['a'], ['قال "نعم"']])
  })
})

describe('import preview', () => {
  it('reports every bad row with its row number, column and reason, and writes nothing', async () => {
    const { harness, owner } = await onboarded()
    const path = await workbook([
      HEADER,
      ['بنادول', ean(1), '45.5', '30', 'شريط', 'مسكنات', 'جلاكسو', null],
      [null, ean(2), '10', null, null, null, null, null],
      ['باركود غلط', '6221000000018', '10', null, null, null, null, null],
      ['باركود مكرر', ean(1), '10', null, null, null, null, null],
      ['سعر غلط', ean(3), 'عشرة', null, null, null, null, null],
      ['وحدة مجهولة', ean(4), '10', null, 'دستة', null, null, null],
      [null, null, null, null, null, null, null, null],
    ])

    const report = await harness.json<ImportReport>('POST', '/catalog/import/preview', {
      session: owner.token,
      body: { path },
    })

    expect(report).toMatchObject({ totalRows: 6, validRows: 1, importedRows: 0, newCategories: ['مسكنات'], newBrands: ['جلاكسو'] })
    expect(report.issues.map(({ row, column, code }) => [row, column, code])).toEqual([
      [3, 'name', 'REQUIRED'],
      [4, 'barcode', 'BARCODE_INVALID'],
      [5, 'barcode', 'BARCODE_DUPLICATED'],
      [6, 'price', 'PRICE_INVALID'],
      [7, 'unit', 'UNIT_NOT_FOUND'],
    ])

    const page = await harness.json<ProductPage>('GET', '/products', { session: owner.token })
    expect(page.total).toBe(0)
  })

  it('names a missing required column', async () => {
    const { harness, owner } = await onboarded()
    const path = await workbook([['الباركود'], [ean(1)]])
    const failure = await harness.failure('POST', '/catalog/import/preview', { session: owner.token, body: { path } })
    expect(failure.code).toBe('IMPORT_COLUMNS_MISSING')
    expect(failure.params).toEqual({ columns: 'اسم الصنف' })
  })

  it('accepts English headers in any order', async () => {
    const { harness, owner } = await onboarded()
    const path = await workbook([['Price', 'Barcode', 'Item name'], ['12', ean(1), 'Tea']])
    const report = await harness.json<ImportReport>('POST', '/catalog/import/preview', {
      session: owner.token,
      body: { path },
    })
    expect(report.validRows).toBe(1)
  })

  it('says a file is empty or unreadable rather than crashing', async () => {
    const { harness, owner } = await onboarded()
    const empty = await workbook([HEADER])
    const corrupt = join(dir, 'corrupt.xlsx')
    writeFileSync(corrupt, 'this is not a workbook')

    const preview = (path: string) =>
      harness.failure('POST', '/catalog/import/preview', { session: owner.token, body: { path } })
    expect((await preview(empty)).code).toBe('IMPORT_EMPTY')
    expect((await preview(corrupt)).code).toBe('IMPORT_FILE_UNREADABLE')
  })

  it('refuses other file types before opening them', async () => {
    const { harness, owner } = await onboarded()
    const failure = await harness.failure('POST', '/catalog/import/preview', {
      session: owner.token,
      body: { path: 'C:\\secrets\\passwords.txt' },
    })
    expect(failure.fields).toEqual({ path: ['IMPORT_FILE_INVALID'] })
  })

  it('reads Arabic CSV saved as Windows-1256', async () => {
    const { harness, owner } = await onboarded()
    const path = join(dir, 'legacy.csv')
    // "اسم الصنف" then "شاي" in Windows-1256.
    const bytes = [0xc7, 0xd3, 0xe3, 0x20, 0xc7, 0xe1, 0xd5, 0xe4, 0xdd, 0x0a, 0xd4, 0xc7, 0xed, 0x0a]
    writeFileSync(path, Buffer.from(bytes))

    const report = await harness.json<ImportReport>('POST', '/catalog/import', { session: owner.token, body: { path } })
    expect(report.importedRows).toBe(1)
    const page = await harness.json<ProductPage>('GET', '/products', { session: owner.token })
    expect(page.items[0]?.name).toBe('شاي')
  })
})

describe('import', () => {
  it('imports the valid rows, creates categories once, and skips the bad ones', async () => {
    const { harness, owner } = await onboarded()
    const path = await workbook([
      HEADER,
      ['بنادول', ean(1), '45.5', '30', 'شريط', 'مسكنات', 'جلاكسو', 'P-1'],
      ['بروفين', ean(2), '20', '15', 'شريط', 'مُسكّنات', 'جلاكسو', null],
      ['سعر غلط', ean(3), 'عشرة', null, null, null, null, null],
    ])

    const report = await harness.json<ImportReport>('POST', '/catalog/import', { session: owner.token, body: { path } })
    expect(report).toMatchObject({ importedRows: 2, validRows: 2, totalRows: 3 })

    const session = owner.token
    const page = await harness.json<ProductPage>('GET', '/products', { session })
    expect(page.total).toBe(2)
    expect(page.items.find((item) => item.name === 'بنادول')).toMatchObject({
      sku: 'P-1',
      barcode: ean(1),
      priceMinor: 4550,
      categoryName: 'مسكنات',
      brandName: 'جلاكسو',
    })

    const categories = await harness.json<{ items: Reference[] }>('GET', '/catalog/categories', { session })
    expect(categories.items).toHaveLength(1)
  })

  it('refuses a second import of the same barcodes', async () => {
    const { harness, owner } = await onboarded()
    const path = await workbook([HEADER, ['بنادول', ean(1), null, null, null, null, null, null]])
    const session = owner.token
    await harness.json('POST', '/catalog/import', { session, body: { path } })
    const again = await harness.json<ImportReport>('POST', '/catalog/import', { session, body: { path } })
    expect(again.importedRows).toBe(0)
    expect(again.issues[0]).toMatchObject({ column: 'barcode', code: 'BARCODE_TAKEN' })
  })

  it('imports ten thousand rows, with errors pinpointed, and search works straight after', { timeout: 60_000 }, async () => {
    const { harness, owner } = await onboarded()
    const session = owner.token
    const rows: Array<Array<string | number | null>> = [HEADER]
    for (let index = 1; index <= 10_000; index++) {
      const broken = index % 1000 === 0
      rows.push([
        `صنف رقم ${index}`,
        broken ? 'bad code!' : ean(index),
        12.5,
        8,
        'قطعة',
        `قسم ${index % 25}`,
        `شركة ${index % 40}`,
        null,
      ])
    }
    const path = await workbook(rows)

    const startedAt = performance.now()
    const report = await harness.json<ImportReport>('POST', '/catalog/import', { session, body: { path } })
    const elapsed = performance.now() - startedAt
    console.log(`Imported ${report.importedRows} rows in ${Math.round(elapsed)}ms`)

    expect(report).toMatchObject({ totalRows: 10_000, validRows: 9_990, importedRows: 9_990 })
    expect(report.issues).toHaveLength(10)
    expect(report.issues[0]).toMatchObject({ row: 1001, column: 'barcode', code: 'BARCODE_INVALID', value: 'bad code!' })

    const search = await harness.json<ProductPage>('GET', `/products?search=${encodeURIComponent('صنف رقم 7777')}`, { session })
    expect(search.items.map((item) => item.name)).toContain('صنف رقم 7777')
    expect((await harness.json<ProductPage>('GET', '/products?limit=1', { session })).total).toBe(9_990)
  })
})

describe('export', () => {
  it('writes a file that imports back without changes', async () => {
    const source = await onboarded()
    const session = source.owner.token
    const path = await workbook([
      HEADER,
      ['بنادول', ean(1), '45.5', '30', 'شريط', 'مسكنات', 'جلاكسو', 'P-1'],
    ])
    await source.harness.json('POST', '/catalog/import', { session, body: { path } })

    const destination = join(dir, 'export.xlsx')
    await source.harness.json('POST', '/catalog/export', { session, body: { destination, locale: 'ar' } })

    const rows = await readSheet(destination)
    expect(rows[1]).toEqual(expect.arrayContaining(['بنادول', 'مسكنات', 'جلاكسو', 'شريط', 'P-1']))

    const target = await onboarded()
    const report = await target.harness.json<ImportReport>('POST', '/catalog/import', {
      session: target.owner.token,
      body: { path: destination },
    })
    expect(report.importedRows).toBe(1)
    const page = await target.harness.json<ProductPage>('GET', '/products', { session: target.owner.token })
    expect(page.items[0]).toMatchObject({ name: 'بنادول', barcode: ean(1), priceMinor: 4550 })
  })

  it('writes a template that the importer recognises', async () => {
    const { harness, owner } = await onboarded()
    const destination = join(dir, 'template.xlsx')
    await harness.json('POST', '/catalog/import/template', {
      session: owner.token,
      body: { destination, locale: 'en' },
    })
    const rows = await readSheet(destination)
    expect(rows[0]).toEqual(expect.arrayContaining(['Item name', 'Barcode', 'Sale price']))
  })

  it('reports an unwritable destination', async () => {
    const { harness, owner } = await onboarded()
    const failure = await harness.failure('POST', '/catalog/export', {
      session: owner.token,
      body: { destination: join(dir, 'no', 'such', 'folder.xlsx'), locale: 'ar' },
    })
    expect(failure.code).toBe('EXPORT_FAILED')
  })
})

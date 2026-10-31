import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { readSheet } from 'read-excel-file/node'
import writeXlsxFile from 'write-excel-file/node'
import { AppError } from '../http/errors'

const MAX_FILE_BYTES = 30 * 1024 * 1024
const DELIMITERS = [',', ';', '\t']

export type SheetRows = string[][]

/** Excel saves Arabic CSV as Windows-1256 unless told otherwise, so UTF-8 can't be assumed. */
function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1256').decode(bytes)
  }
}

function detectDelimiter(firstLine: string): string {
  const counts = DELIMITERS.map((delimiter) => [delimiter, firstLine.split(delimiter).length] as const)
  return counts.reduce((best, next) => (next[1] > best[1] ? next : best))[0]
}

export function parseCsv(text: string): SheetRows {
  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? '')
  const rows: SheetRows = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char !== '"') cell += char
      else if (text[index + 1] === '"') {
        cell += '"'
        index++
      } else quoted = false
    } else if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }

  if (cell !== '' || row.length > 0) rows.push([...row, cell.replace(/\r$/, '')])
  return rows
}

const cellText = (value: unknown): string =>
  value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value).trim()

export async function readCatalogFile(path: string): Promise<SheetRows> {
  try {
    const { size } = await stat(path)
    if (size > MAX_FILE_BYTES) throw new AppError('IMPORT_TOO_MANY_ROWS', { params: { limit: '30 MB' } })

    if (extname(path).toLowerCase() === '.csv') {
      return parseCsv(decodeCsv(await readFile(path))).map((row) => row.map(cellText))
    }
    const rows = (await readSheet(path)) as unknown[][]
    return rows.map((row) => row.map(cellText))
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('IMPORT_FILE_UNREADABLE')
  }
}

export async function writeSheet(rows: ReadonlyArray<ReadonlyArray<string | number | null>>, destination: string): Promise<void> {
  try {
    const sheet = rows.map((row, index) =>
      row.map((value) => ({ value, ...(index === 0 ? { fontWeight: 'bold' as const } : {}) })),
    )
    await writeXlsxFile(sheet as never).toFile(destination)
  } catch {
    throw new AppError('EXPORT_FAILED')
  }
}

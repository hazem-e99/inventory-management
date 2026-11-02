import type { InvoiceLine, InvoiceReading } from '@inv/license-core'

const FIELDS = ['quantity', 'unitPrice', 'lineTotal', 'batch', 'expiry'] as const

const agreeing = (expected: InvoiceLine, actual: InvoiceLine) => FIELDS.filter((field) => expected[field] !== null && expected[field] === actual[field]).length

/** Pairs each true line with the reading that agrees with it most, so one missed line can't shift the rest. */
function pairLines(expected: InvoiceLine[], actual: InvoiceLine[]) {
  const unused = new Set(actual)
  return expected.map((line) => {
    let best: InvoiceLine | null = null
    let bestScore = 0
    for (const candidate of unused) {
      const score = agreeing(line, candidate)
      if (score > bestScore) [best, bestScore] = [candidate, score]
    }
    if (best) unused.delete(best)
    return { line, match: best }
  })
}

export interface ReadingScore {
  lines: number
  linesFound: number
  /** Numbers that decide stock and money. Everything else can be fixed at a glance. */
  numbers: number
  numbersRight: number
  extraLines: number
  totalRight: boolean
}

export function scoreReading(expected: InvoiceReading, actual: InvoiceReading): ReadingScore {
  const pairs = pairLines(expected.lines, actual.lines)
  let numbers = 0
  let numbersRight = 0
  for (const { line, match } of pairs) {
    for (const field of ['quantity', 'unitPrice'] as const) {
      if (line[field] === null) continue
      numbers += 1
      if (match?.[field] === line[field]) numbersRight += 1
    }
  }
  const linesFound = pairs.filter(({ match }) => match).length
  return { lines: expected.lines.length, linesFound, numbers, numbersRight, extraLines: actual.lines.length - linesFound, totalRight: expected.total === actual.total }
}

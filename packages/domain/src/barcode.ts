const CHECKED_LENGTHS = new Set([8, 12, 13, 14])
const CODE_PATTERN = /^[0-9A-Za-z._-]{3,32}$/

/** GS1 check digit: digits weigh 3 and 1 alternately, counting from the right. */
export function gs1CheckDigit(digits: string): number {
  let sum = 0
  for (let index = 0; index < digits.length; index++) {
    const fromRight = digits.length - 1 - index
    sum += Number(digits[index]) * (fromRight % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

/** Numeric EAN and UPC lengths must carry a valid check digit, which catches most typos. */
export function isValidBarcode(code: string): boolean {
  if (!CODE_PATTERN.test(code)) return false
  if (!/^\d+$/.test(code) || !CHECKED_LENGTHS.has(code.length)) return true
  return gs1CheckDigit(code.slice(0, -1)) === Number(code.at(-1))
}

// GS1 reserves prefixes 200-299 for use inside a single store, so these can't collide with
// a manufacturer's barcode.
const INTERNAL_PREFIX = '200'
const INTERNAL_SEQUENCE_DIGITS = 9

export function internalBarcode(sequence: number): string {
  const body = INTERNAL_PREFIX + String(sequence).padStart(INTERNAL_SEQUENCE_DIGITS, '0')
  return body + String(gs1CheckDigit(body))
}

export function internalSku(sequence: number): string {
  return `SKU-${String(sequence).padStart(6, '0')}`
}

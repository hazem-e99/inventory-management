import { toLatinDigits } from './text'

const MINOR_DIGITS = 2
const MILLI_DIGITS = 3

function parseFixed(text: string, fractionDigits: number): number | null {
  const cleaned = toLatinDigits(text.trim()).replace(/٫/g, '.').replace(/[٬,]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null

  const [whole = '0', fraction = ''] = cleaned.split('.')
  if (fraction.replace(/0+$/, '').length > fractionDigits) return null

  const scaled = Number(whole + fraction.padEnd(fractionDigits, '0').slice(0, fractionDigits))
  return Number.isSafeInteger(scaled) ? scaled : null
}

/** Amounts stay integers in minor units, parsed from text so no float ever touches money. */
export const parseMoney = (text: string): number | null => parseFixed(text, MINOR_DIGITS)

export const parseQuantity = (text: string): number | null => parseFixed(text, MILLI_DIGITS)

function formatFixed(value: number, fractionDigits: number): string {
  const text = String(value).padStart(fractionDigits + 1, '0')
  const whole = text.slice(0, -fractionDigits)
  const fraction = text.slice(-fractionDigits).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export const moneyToText = (minor: number): string => formatFixed(minor, MINOR_DIGITS)

export const quantityToText = (milli: number): string => formatFixed(milli, MILLI_DIGITS)

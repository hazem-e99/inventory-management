import { describe, expect, it } from 'vitest'
import {
  buildSearchText,
  gs1CheckDigit,
  internalBarcode,
  isValidBarcode,
  moneyToText,
  normalizeSearchText,
  parseMoney,
  parseQuantity,
  quantityToText,
  searchTerms,
} from '../src'

describe('normalizeSearchText', () => {
  it.each([
    ['أموكسيسيلين', 'اموكسيسيلين'],
    ['إيبوبروفين', 'ايبوبروفين'],
    ['آيس كريم', 'ايس كريم'],
    ['مكتبة', 'مكتبه'],
    ['مستشفى', 'مستشفي'],
    ['مُحَمَّد', 'محمد'],
    ['مؤسسة', 'موسسه'],
    ['بيئة', 'بييه'],
    ['ســـكر', 'سكر'],
    ['دواء ٥٠٠ مجم', 'دواء 500 مجم'],
    ['Paracetamol-500', 'paracetamol 500'],
  ])('folds %s', (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected)
  })

  it('splits into terms and ignores punctuation-only input', () => {
    expect(searchTerms('  بنادول   اكسترا ')).toEqual(['بنادول', 'اكسترا'])
    expect(searchTerms('"*"')).toEqual([])
  })

  it('skips missing parts when building the index text', () => {
    expect(buildSearchText(['بنادول', null, undefined, 'SKU-1'])).toBe('بنادول sku 1')
  })
})

describe('barcodes', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('400638133393')).toBe(1)
  })

  it.each(['4006381333931', '96385074', '036000291452'])('accepts %s', (code) => {
    expect(isValidBarcode(code)).toBe(true)
  })

  it.each(['4006381333932', '96385075', '12', 'has space'])('rejects %s', (code) => {
    expect(isValidBarcode(code)).toBe(false)
  })

  it('accepts other code formats without a check digit', () => {
    expect(isValidBarcode('ABC-123')).toBe(true)
    expect(isValidBarcode('12345')).toBe(true)
  })

  it('generates valid internal barcodes in the in-store range', () => {
    const code = internalBarcode(7)
    expect(code).toMatch(/^200000000007\d$/)
    expect(isValidBarcode(code)).toBe(true)
  })
})

describe('amounts', () => {
  it.each([
    ['12.50', 1250],
    ['12.5', 1250],
    ['12', 1200],
    ['0.05', 5],
    ['1,250.75', 125075],
    ['١٢٫٥', 1250],
    ['19.99', 1999],
  ])('parses money %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected)
  })

  it.each(['abc', '', '-5', '1.234', '1.2.3'])('refuses money %s', (input) => {
    expect(parseMoney(input)).toBeNull()
  })

  it('never picks up float error', () => {
    expect(parseMoney('1.15')).toBe(115)
    expect(parseMoney('4.35')).toBe(435)
    expect(parseMoney('19.99')).toBe(1999)
  })

  it('parses quantities to thousandths', () => {
    expect(parseQuantity('1.25')).toBe(1250)
    expect(parseQuantity('12')).toBe(12000)
    expect(parseQuantity('0.125')).toBe(125)
    expect(parseQuantity('0.1255')).toBeNull()
  })

  it('formats without trailing zeros', () => {
    expect(moneyToText(1250)).toBe('12.5')
    expect(moneyToText(1200)).toBe('12')
    expect(moneyToText(5)).toBe('0.05')
    expect(quantityToText(1250)).toBe('1.25')
    expect(quantityToText(125)).toBe('0.125')
  })
})

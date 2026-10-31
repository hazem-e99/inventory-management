const DIACRITICS = /[ً-ٰٟـ]/g
const ARABIC_DIGITS = /[٠-٩]/g
const PERSIAN_DIGITS = /[۰-۹]/g

export function toLatinDigits(text: string): string {
  return text
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
}

/**
 * Folds the spellings people use interchangeably when typing Arabic, so that searching
 * "اموكسيسيلين" finds "أموكسيسيلين" and "مكتبه" finds "مكتبة".
 */
export function normalizeSearchText(text: string): string {
  return toLatinDigits(text.normalize('NFKC'))
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function searchTerms(text: string): string[] {
  const normalized = normalizeSearchText(text)
  return normalized ? normalized.split(' ') : []
}

export function buildSearchText(parts: ReadonlyArray<string | null | undefined>): string {
  return normalizeSearchText(parts.filter(Boolean).join(' '))
}

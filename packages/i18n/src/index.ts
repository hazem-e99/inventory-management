import type { Locale } from '@inv/contracts'
import ar from './ar.json'
import en from './en.json'

export const resources = {
  ar: { translation: ar },
  en: { translation: en },
} as const

export type Translations = typeof ar

export const directionOf = (locale: Locale): 'rtl' | 'ltr' => (locale === 'ar' ? 'rtl' : 'ltr')

export { ar, en }

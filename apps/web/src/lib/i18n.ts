import { resources, type Translations } from '@inv/i18n'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    contextSeparator: '~'
    pluralSeparator: '~'
    resources: { translation: Translations }
  }
}

void i18next.use(initReactI18next).init({
  resources,
  lng: 'ar',
  fallbackLng: 'ar',
  // Error codes contain underscores, which would otherwise read as plural and context suffixes.
  contextSeparator: '~',
  pluralSeparator: '~',
  interpolation: { escapeValue: false },
  returnNull: false,
})

export { i18next }

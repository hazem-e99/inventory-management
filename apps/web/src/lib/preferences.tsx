import { preferencesSchema, type Preferences } from '@inv/contracts'
import { directionOf } from '@inv/i18n'
import { Direction } from 'radix-ui'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from './api'
import { i18next } from './i18n'

interface PreferencesContextValue {
  preferences: Preferences
  update(changes: Partial<Preferences>): void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

function applyTheme(theme: Preferences['theme']): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const dark = theme === 'dark' || (theme === 'system' && media.matches)
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light'
  }
  apply()
  media.addEventListener('change', apply)
  return () => media.removeEventListener('change', apply)
}

export function PreferencesProvider({
  initial,
  children,
}: {
  initial: Preferences
  children: ReactNode
}) {
  const [preferences, setPreferences] = useState(initial)
  const direction = directionOf(preferences.locale)

  useEffect(() => {
    document.documentElement.lang = preferences.locale
    document.documentElement.dir = direction
    void i18next.changeLanguage(preferences.locale)
  }, [direction, preferences.locale])

  useEffect(() => applyTheme(preferences.theme), [preferences.theme])

  const update = useCallback(
    (changes: Partial<Preferences>) => {
      const next = { ...preferences, ...changes }
      setPreferences(next)
      void api(preferencesSchema, 'PUT', '/settings/preferences', { body: next }).catch(() => {})
    },
    [preferences],
  )

  const value = useMemo(() => ({ preferences, update }), [preferences, update])

  return (
    <PreferencesContext.Provider value={value}>
      <Direction.Provider dir={direction}>{children}</Direction.Provider>
    </PreferencesContext.Provider>
  )
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences needs PreferencesProvider')
  return value
}

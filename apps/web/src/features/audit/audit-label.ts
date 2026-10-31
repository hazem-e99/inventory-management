import { useTranslation } from 'react-i18next'

export function useAuditLabel() {
  const { t, i18n } = useTranslation()
  return (action: string): string => {
    const key = `audit.actions.${action}`
    return i18n.exists(key) ? (t as (key: string) => string)(key) : action
  }
}

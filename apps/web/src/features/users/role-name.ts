import { SYSTEM_ROLES, type Role, type SystemRole } from '@inv/contracts'
import { useTranslation } from 'react-i18next'

const isSystemRole = (id: string): id is SystemRole => (SYSTEM_ROLES as readonly string[]).includes(id)

export function useRoleName() {
  const { t } = useTranslation()
  return (role: Pick<Role, 'id' | 'name'>): string =>
    isSystemRole(role.id) ? t(`roles.names.${role.id}`) : role.name
}

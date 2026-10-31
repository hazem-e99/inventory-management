import { PERMISSIONS, type Permission, type SystemRole } from '@inv/contracts'

export const OWNER_ROLE_ID: SystemRole = 'owner'

/** The owner always holds every permission, so new ones never need a data migration. */
export const SYSTEM_ROLE_DEFAULTS: Record<SystemRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: ['users.view', 'audit.view', 'backups.manage', 'catalog.view', 'catalog.manage', 'catalog.import'],
  storekeeper: ['catalog.view', 'catalog.manage', 'catalog.import'],
  cashier: ['catalog.view'],
}

export function effectivePermissions(roleId: string, stored: readonly Permission[]): Permission[] {
  return roleId === OWNER_ROLE_ID ? [...PERMISSIONS] : [...stored]
}

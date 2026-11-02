import { PERMISSIONS, type Permission, type SystemRole } from '@inv/contracts'

export const OWNER_ROLE_ID: SystemRole = 'owner'

/** The owner always holds every permission, so new ones never need a data migration. */
export const SYSTEM_ROLE_DEFAULTS: Record<SystemRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    'users.view',
    'audit.view',
    'backups.manage',
    'catalog.view',
    'catalog.manage',
    'catalog.import',
    'stock.view',
    'stock.manage',
    'stock.void',
    'purchases.view',
    'purchases.manage',
    'purchases.void',
    'suppliers.manage',
    'suppliers.pay',
    'sales.view',
    'sales.sell',
    'sales.discount',
    'sales.price',
    'sales.return',
    'sales.void',
    'customers.manage',
    'customers.collect',
    'shifts.manage',
    'reports.view',
    'reports.profit',
    'ai.invoices',
    'ai.assistant',
  ],
  storekeeper: [
    'catalog.view',
    'catalog.manage',
    'catalog.import',
    'stock.view',
    'stock.manage',
    'purchases.view',
    'purchases.manage',
    'reports.view',
    'ai.invoices',
  ],
  cashier: ['catalog.view', 'stock.view', 'sales.view', 'sales.sell', 'sales.return', 'customers.collect'],
}

export function effectivePermissions(roleId: string, stored: readonly Permission[]): Permission[] {
  return roleId === OWNER_ROLE_ID ? [...PERMISSIONS] : [...stored]
}

export const PERMISSIONS = [
  'users.view',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'audit.view',
  'backups.manage',
  'catalog.view',
  'catalog.manage',
  'catalog.import',
  'stock.view',
  'stock.manage',
  'stock.void',
  'stock.negative',
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
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const SYSTEM_ROLES = ['owner', 'manager', 'storekeeper', 'cashier'] as const

export type SystemRole = (typeof SYSTEM_ROLES)[number]

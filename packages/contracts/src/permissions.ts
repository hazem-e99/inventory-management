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
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const SYSTEM_ROLES = ['owner', 'manager', 'storekeeper', 'cashier'] as const

export type SystemRole = (typeof SYSTEM_ROLES)[number]

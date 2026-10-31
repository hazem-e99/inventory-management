import type { Generated } from 'kysely'

// Booleans are 0/1 integers and timestamps are epoch ms, which read the same on both dialects.
export interface SettingsTable {
  key: string
  value: string
  updated_at: number
}

export interface RolesTable {
  id: string
  name: string
  is_system: number
  created_at: number
}

export interface RolePermissionsTable {
  role_id: string
  permission: string
}

export interface UsersTable {
  id: string
  username: string
  full_name: string
  password_hash: string
  pin_hash: string | null
  role_id: string
  is_active: Generated<number>
  must_change_password: Generated<number>
  failed_attempts: Generated<number>
  locked_until: number | null
  created_at: number
  updated_at: number
}

export interface SessionsTable {
  token_hash: string
  user_id: string
  created_at: number
  expires_at: number
}

export interface AuditLogTable {
  id: string
  actor_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  details: string | null
  occurred_at: number
}

export interface Database {
  settings: SettingsTable
  roles: RolesTable
  role_permissions: RolePermissionsTable
  users: UsersTable
  sessions: SessionsTable
  audit_log: AuditLogTable
}

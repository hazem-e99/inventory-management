import type { Insertable, Kysely, Selectable, Updateable } from 'kysely'
import type { Database, RolesTable, UsersTable } from './schema'

export type UserRow = Selectable<UsersTable>
export type RoleRow = Selectable<RolesTable>

export function usersRepo(db: Kysely<Database>) {
  return {
    insert(user: Insertable<UsersTable>) {
      return db.insertInto('users').values(user).execute()
    },

    update(id: string, changes: Updateable<UsersTable>) {
      return db.updateTable('users').set(changes).where('id', '=', id).execute()
    },

    findById(id: string): Promise<UserRow | undefined> {
      return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
    },

    findByUsername(username: string): Promise<UserRow | undefined> {
      return db.selectFrom('users').selectAll().where('username', '=', username).executeTakeFirst()
    },

    list(): Promise<UserRow[]> {
      return db.selectFrom('users').selectAll().orderBy('full_name').execute()
    },

    async countActiveInRole(roleId: string): Promise<number> {
      const row = await db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('role_id', '=', roleId)
        .where('is_active', '=', 1)
        .executeTakeFirstOrThrow()
      return Number(row.count)
    },
  }
}

export function rolesRepo(db: Kysely<Database>) {
  return {
    insert(role: Insertable<RolesTable>) {
      return db.insertInto('roles').values(role).execute()
    },

    rename(id: string, name: string) {
      return db.updateTable('roles').set({ name }).where('id', '=', id).execute()
    },

    delete(id: string) {
      return db.deleteFrom('roles').where('id', '=', id).execute()
    },

    findById(id: string): Promise<RoleRow | undefined> {
      return db.selectFrom('roles').selectAll().where('id', '=', id).executeTakeFirst()
    },

    list(): Promise<RoleRow[]> {
      return db.selectFrom('roles').selectAll().orderBy('created_at').orderBy('id').execute()
    },

    async permissionsOf(roleId: string): Promise<string[]> {
      const rows = await db
        .selectFrom('role_permissions')
        .select('permission')
        .where('role_id', '=', roleId)
        .execute()
      return rows.map((row) => row.permission)
    },

    async allPermissions(): Promise<Map<string, string[]>> {
      const rows = await db.selectFrom('role_permissions').selectAll().execute()
      const byRole = new Map<string, string[]>()
      for (const row of rows) {
        byRole.set(row.role_id, [...(byRole.get(row.role_id) ?? []), row.permission])
      }
      return byRole
    },

    async userCounts(): Promise<Map<string, number>> {
      const rows = await db
        .selectFrom('users')
        .select(['role_id', (eb) => eb.fn.countAll().as('count')])
        .groupBy('role_id')
        .execute()
      return new Map(rows.map((row) => [row.role_id, Number(row.count)]))
    },

    async setPermissions(roleId: string, permissions: readonly string[]): Promise<void> {
      await db.deleteFrom('role_permissions').where('role_id', '=', roleId).execute()
      if (permissions.length === 0) return
      await db
        .insertInto('role_permissions')
        .values(permissions.map((permission) => ({ role_id: roleId, permission })))
        .execute()
    },
  }
}

export function sessionsRepo(db: Kysely<Database>) {
  return {
    insert(tokenHash: string, userId: string, now: number, expiresAt: number) {
      return db
        .insertInto('sessions')
        .values({ token_hash: tokenHash, user_id: userId, created_at: now, expires_at: expiresAt })
        .execute()
    },

    async find(tokenHash: string) {
      const row = await db
        .selectFrom('sessions')
        .select(['user_id', 'expires_at'])
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst()
      return row && { userId: row.user_id, expiresAt: Number(row.expires_at) }
    },

    delete(tokenHash: string) {
      return db.deleteFrom('sessions').where('token_hash', '=', tokenHash).execute()
    },

    deleteForUser(userId: string) {
      return db.deleteFrom('sessions').where('user_id', '=', userId).execute()
    },

    deleteExpired(now: number) {
      return db.deleteFrom('sessions').where('expires_at', '<=', now).execute()
    },
  }
}

import type { Kysely } from 'kysely'

const ROLE_GRANTS: Array<[string, string]> = [
  ['manager', 'ai.invoices'],
  ['manager', 'ai.assistant'],
  ['storekeeper', 'ai.invoices'],
]

export async function up(db: Kysely<any>): Promise<void> {
  const roles = await db.selectFrom('roles').select('id').execute()
  const present = new Set(roles.map((role: { id: string }) => role.id))
  const grants = ROLE_GRANTS.filter(([roleId]) => present.has(roleId))
  if (grants.length > 0) {
    await db
      .insertInto('role_permissions')
      .values(grants.map(([role_id, permission]) => ({ role_id, permission })))
      .execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom('role_permissions').where('permission', 'in', ['ai.invoices', 'ai.assistant']).execute()
}

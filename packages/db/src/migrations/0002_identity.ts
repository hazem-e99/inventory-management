import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('roles')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('is_system', 'integer', (col) => col.notNull().check(sql`is_system in (0, 1)`))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('permission', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('role_permissions_pk', ['role_id', 'permission'])
    .execute()

  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('username', 'text', (col) => col.notNull().unique())
    .addColumn('full_name', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('pin_hash', 'text')
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('restrict'))
    .addColumn('is_active', 'integer', (col) =>
      col.notNull().defaultTo(1).check(sql`is_active in (0, 1)`),
    )
    .addColumn('must_change_password', 'integer', (col) =>
      col.notNull().defaultTo(0).check(sql`must_change_password in (0, 1)`),
    )
    .addColumn('failed_attempts', 'integer', (col) =>
      col.notNull().defaultTo(0).check(sql`failed_attempts >= 0`),
    )
    .addColumn('locked_until', 'bigint')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('users_role_id_idx').on('users').column('role_id').execute()

  await db.schema
    .createTable('sessions')
    .addColumn('token_hash', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('expires_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('sessions_user_id_idx').on('sessions').column('user_id').execute()

  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('actor_id', 'text', (col) => col.references('users.id').onDelete('restrict'))
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('entity_type', 'text')
    .addColumn('entity_id', 'text')
    .addColumn('details', 'text')
    .addColumn('occurred_at', 'bigint', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('audit_log_occurred_at_idx')
    .on('audit_log')
    .columns(['occurred_at', 'id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('audit_log').execute()
  await db.schema.dropTable('sessions').execute()
  await db.schema.dropTable('users').execute()
  await db.schema.dropTable('role_permissions').execute()
  await db.schema.dropTable('roles').execute()
}

import { sql, type Kysely } from 'kysely'
import { isSqlite } from '../dialect'

/** A ledger's promise, kept by the database itself: history is never rewritten. */
export async function makeAppendOnly(db: Kysely<any>, table: string): Promise<void> {
  if (isSqlite(db)) {
    for (const action of ['update', 'delete']) {
      await sql
        .raw(
          `create trigger ${table}_no_${action} before ${action} on ${table}
           begin select raise(abort, '${table} is append-only'); end`,
        )
        .execute(db)
    }
    return
  }

  await sql
    .raw(
      `create function ${table}_append_only() returns trigger as $$
       begin raise exception '${table} is append-only'; end;
       $$ language plpgsql`,
    )
    .execute(db)
  await sql
    .raw(
      `create trigger ${table}_no_change before update or delete on ${table}
       for each row execute function ${table}_append_only()`,
    )
    .execute(db)
}

export async function dropAppendOnly(db: Kysely<any>, table: string): Promise<void> {
  if (!isSqlite(db)) await sql.raw(`drop function ${table}_append_only cascade`).execute(db)
}

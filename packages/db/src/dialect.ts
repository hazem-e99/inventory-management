import { SqliteAdapter, type Kysely } from 'kysely'

/** The only dialect check in the project: every use is a documented SQLite-only feature. */
export function isSqlite(db: Kysely<any>): boolean {
  return db.getExecutor().adapter instanceof SqliteAdapter
}

import { sql, type Kysely } from 'kysely'
import type { Database } from './schema'

/** Takes the next number inside the caller's transaction, so a rollback leaves no gap. */
export async function nextSequence(db: Kysely<Database>, key: string): Promise<number> {
  const row = await db
    .insertInto('document_sequences')
    .values({ key, last_value: 1 })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({ last_value: sql`document_sequences.last_value + 1` }),
    )
    .returning('last_value')
    .executeTakeFirstOrThrow()
  return Number(row.last_value)
}

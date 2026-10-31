import type { Kysely } from 'kysely'
import type { Database } from './schema'

export function settingsRepo(db: Kysely<Database>) {
  return {
    async get(key: string): Promise<string | null> {
      const row = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', key)
        .executeTakeFirst()
      return row?.value ?? null
    },

    async set(key: string, value: string, now: number): Promise<void> {
      await db
        .insertInto('settings')
        .values({ key, value, updated_at: now })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: now }))
        .execute()
    },

    async getJson<T>(key: string): Promise<T | null> {
      const value = await this.get(key)
      return value === null ? null : (JSON.parse(value) as T)
    },

    async setJson(key: string, value: unknown, now: number): Promise<void> {
      await this.set(key, JSON.stringify(value), now)
    },
  }
}

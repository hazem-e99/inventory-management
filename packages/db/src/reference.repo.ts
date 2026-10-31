import type { Kysely } from 'kysely'
import { newId } from './ids'
import type { Database } from './schema'

export type ReferenceTable = 'categories' | 'brands' | 'units' | 'tax_rates' | 'price_lists'

export interface ReferenceRow {
  id: string
  name: string
  isSystem: boolean
  archived: boolean
  usageCount: number
  parentId?: string | null
  allowsFraction?: boolean
  rateBp?: number
}

export interface ReferenceChanges {
  name?: string
  parentId?: string | null
  allowsFraction?: boolean
  rateBp?: number
  archived?: boolean
}

/** How many products lean on each row, so a blocked delete can say exactly how many. */
async function usageCounts(db: Kysely<Database>, table: ReferenceTable): Promise<Map<string, number>> {
  if (table === 'price_lists') {
    const rows = await db
      .selectFrom('variant_prices')
      .select(['price_list_id as id', (eb) => eb.fn.count('variant_id').distinct().as('count')])
      .groupBy('price_list_id')
      .execute()
    return new Map(rows.map((row) => [row.id, Number(row.count)]))
  }

  const column = { categories: 'category_id', brands: 'brand_id', units: 'base_unit_id', tax_rates: 'tax_rate_id' } as const
  const rows = await db
    .selectFrom('products')
    .select([`${column[table]} as id`, (eb) => eb.fn.countAll().as('count')])
    .where(column[table], 'is not', null)
    .groupBy(column[table])
    .execute()
  return new Map(rows.map((row) => [row.id as string, Number(row.count)]))
}

const AS_ANY = (db: Kysely<Database>) => db as unknown as Kysely<any>

export function referenceRepo(db: Kysely<Database>, table: ReferenceTable) {
  const anyDb = AS_ANY(db)

  return {
    async list(): Promise<ReferenceRow[]> {
      const [rows, usage] = await Promise.all([
        anyDb.selectFrom(table).selectAll().orderBy('created_at').orderBy('name').execute(),
        usageCounts(db, table),
      ])

      return rows.map((row: Record<string, unknown>): ReferenceRow => ({
        id: row['id'] as string,
        name: row['name'] as string,
        isSystem: row['is_system'] === 1,
        archived: row['archived_at'] !== null,
        usageCount: usage.get(row['id'] as string) ?? 0,
        ...(table === 'categories' ? { parentId: row['parent_id'] as string | null } : {}),
        ...(table === 'units' ? { allowsFraction: row['allows_fraction'] === 1 } : {}),
        ...(table === 'tax_rates' ? { rateBp: Number(row['rate_bp']) } : {}),
      }))
    },

    async find(id: string): Promise<ReferenceRow | undefined> {
      return (await this.list()).find((row) => row.id === id)
    },

    async insert(values: ReferenceChanges & { name: string }, now: number): Promise<string> {
      const id = newId()
      await anyDb
        .insertInto(table)
        .values({
          id,
          name: values.name,
          created_at: now,
          ...(table === 'categories' ? { parent_id: values.parentId ?? null } : {}),
          ...(table === 'units' ? { allows_fraction: values.allowsFraction ? 1 : 0 } : {}),
          ...(table === 'tax_rates' ? { rate_bp: values.rateBp ?? 0 } : {}),
        })
        .execute()
      return id
    },

    async update(id: string, changes: ReferenceChanges, now: number): Promise<void> {
      await anyDb
        .updateTable(table)
        .set({
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(table === 'categories' && changes.parentId !== undefined ? { parent_id: changes.parentId } : {}),
          ...(table === 'units' && changes.allowsFraction !== undefined
            ? { allows_fraction: changes.allowsFraction ? 1 : 0 }
            : {}),
          ...(table === 'tax_rates' && changes.rateBp !== undefined ? { rate_bp: changes.rateBp } : {}),
          ...(changes.archived === undefined ? {} : { archived_at: changes.archived ? now : null }),
        })
        .where('id', '=', id)
        .execute()
    },

    delete(id: string) {
      return anyDb.deleteFrom(table).where('id', '=', id).execute()
    },
  }
}

export function attributesRepo(db: Kysely<Database>) {
  return {
    async list() {
      const [attributes, values] = await Promise.all([
        db.selectFrom('attributes').selectAll().orderBy('created_at').orderBy('name').execute(),
        db.selectFrom('attribute_values').selectAll().orderBy('created_at').orderBy('value').execute(),
      ])
      return attributes.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        isSystem: attribute.is_system === 1,
        values: values
          .filter((value) => value.attribute_id === attribute.id)
          .map(({ id, attribute_id, value }) => ({ id, attributeId: attribute_id, value })),
      }))
    },

    async addValue(attributeId: string, value: string, now: number): Promise<string> {
      const id = newId()
      await db
        .insertInto('attribute_values')
        .values({ id, attribute_id: attributeId, value, created_at: now })
        .execute()
      return id
    },
  }
}

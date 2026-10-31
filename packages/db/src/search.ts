import { sql, type Expression, type ExpressionBuilder, type Kysely, type SqlBool } from 'kysely'
import { isSqlite } from './dialect'
import type { Database } from './schema'

/**
 * Product text search, behind one small seam. On SQLite an FTS5 index holds active products
 * only, and it leads the query: paging and counting never touch the products table, so a word
 * matching 10,000 items costs the same as one matching 10. Archived products, and Postgres
 * until it gets a trigram index, fall back to `search_text`.
 * Callers pass terms already folded by `normalizeSearchText`.
 */
function ftsQuery(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ')
}

export function usesSearchIndex(db: Kysely<Database>, archived: boolean): boolean {
  return !archived && isSqlite(db)
}

export async function searchIndexPage(
  db: Kysely<Database>,
  terms: readonly string[],
  afterHit: number,
  limit: number,
): Promise<Array<{ productId: string; hit: number }>> {
  const { rows } = await sql<{ product_id: string; hit: number }>`
    select product_id, rowid as hit from product_search
    where product_search match ${ftsQuery(terms)} and rowid > ${afterHit}
    order by rowid
    limit ${limit}
  `.execute(db)
  return rows.map(({ product_id, hit }) => ({ productId: product_id, hit }))
}

export async function searchIndexCount(db: Kysely<Database>, terms: readonly string[]): Promise<number> {
  const { rows } = await sql<{ count: number }>`
    select count(*) as count from product_search where product_search match ${ftsQuery(terms)}
  `.execute(db)
  return Number(rows[0]?.count ?? 0)
}

export function productSearchFilter(
  db: Kysely<Database>,
  terms: readonly string[],
  archived: boolean,
): (eb: ExpressionBuilder<Database, 'products'>) => Expression<SqlBool> {
  if (usesSearchIndex(db, archived)) {
    const query = ftsQuery(terms)
    return () =>
      sql<SqlBool>`products.id in (select product_id from product_search where product_search match ${query})`
  }

  return (eb) => eb.and(terms.map((term) => eb('products.search_text', 'like', `%${term}%`)))
}

export async function indexNewProduct(db: Kysely<Database>, productId: string, text: string): Promise<void> {
  if (!isSqlite(db)) return
  await sql`insert into product_search (product_id, text) values (${productId}, ${text})`.execute(db)
}

/** Scans the index, since `product_id` is unindexed there: fine for one edit, not for a bulk import. */
export async function removeFromSearch(db: Kysely<Database>, productId: string): Promise<void> {
  if (!isSqlite(db)) return
  await sql`delete from product_search where product_id = ${productId}`.execute(db)
}

export async function reindexProduct(db: Kysely<Database>, productId: string, text: string): Promise<void> {
  await removeFromSearch(db, productId)
  await indexNewProduct(db, productId, text)
}

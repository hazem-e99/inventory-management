import type { Kysely } from 'kysely'
import { newId } from './ids'
import type { Database } from './schema'

export interface AuditRecord {
  actorId: string | null
  action: string
  entityType?: string
  entityId?: string
  details?: Record<string, unknown>
  occurredAt: number
}

export interface AuditRow {
  id: string
  action: string
  entityType: string | null
  entityId: string | null
  actorName: string | null
  details: Record<string, unknown> | null
  occurredAt: number
}

const CURSOR_SEPARATOR = '_'

export function auditRepo(db: Kysely<Database>) {
  return {
    record(entry: AuditRecord) {
      return db
        .insertInto('audit_log')
        .values({
          id: newId(),
          actor_id: entry.actorId,
          action: entry.action,
          entity_type: entry.entityType ?? null,
          entity_id: entry.entityId ?? null,
          details: entry.details ? JSON.stringify(entry.details) : null,
          occurred_at: entry.occurredAt,
        })
        .execute()
    },

    /** Keyset pagination: page depth has no cost, unlike OFFSET on a table that only grows. */
    async page(limit: number, cursor?: string) {
      let query = db
        .selectFrom('audit_log')
        .leftJoin('users', 'users.id', 'audit_log.actor_id')
        .select([
          'audit_log.id',
          'audit_log.action',
          'audit_log.entity_type',
          'audit_log.entity_id',
          'audit_log.details',
          'audit_log.occurred_at',
          'users.full_name',
        ])
        .orderBy('audit_log.occurred_at', 'desc')
        .orderBy('audit_log.id', 'desc')
        .limit(limit + 1)

      if (cursor) {
        const [occurredAt, id] = cursor.split(CURSOR_SEPARATOR)
        if (occurredAt && id) {
          const at = Number(occurredAt)
          query = query.where((eb) =>
            eb.or([
              eb('audit_log.occurred_at', '<', at),
              eb.and([eb('audit_log.occurred_at', '=', at), eb('audit_log.id', '<', id)]),
            ]),
          )
        }
      }

      const rows = await query.execute()
      const pageRows = rows.slice(0, limit)
      const last = pageRows.at(-1)
      const items: AuditRow[] = pageRows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actorName: row.full_name,
        details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
        occurredAt: Number(row.occurred_at),
      }))

      return {
        items,
        nextCursor:
          rows.length > limit && last ? `${last.occurred_at}${CURSOR_SEPARATOR}${last.id}` : null,
      }
    },
  }
}

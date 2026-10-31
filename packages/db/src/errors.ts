export type ConstraintKind = 'unique' | 'foreign_key' | 'check' | 'not_null'

export interface ConstraintViolation {
  kind: ConstraintKind
  /** `table.column` when the database reports it, e.g. `users.username`. */
  target: string | null
}

const SQLITE_KINDS: Record<string, ConstraintKind> = {
  SQLITE_CONSTRAINT_UNIQUE: 'unique',
  SQLITE_CONSTRAINT_PRIMARYKEY: 'unique',
  SQLITE_CONSTRAINT_FOREIGNKEY: 'foreign_key',
  // ON DELETE RESTRICT reports as a trigger on SQLite and as 23001 on Postgres.
  SQLITE_CONSTRAINT_TRIGGER: 'foreign_key',
  SQLITE_CONSTRAINT_CHECK: 'check',
  SQLITE_CONSTRAINT_NOTNULL: 'not_null',
}

const POSTGRES_KINDS: Record<string, ConstraintKind> = {
  '23505': 'unique',
  '23503': 'foreign_key',
  '23001': 'foreign_key',
  '23514': 'check',
  '23502': 'not_null',
}

interface DriverError {
  code?: unknown
  message?: unknown
  table?: unknown
  column?: unknown
  detail?: unknown
}

function sqliteTarget(message: string): string | null {
  return /failed: ([\w.]+)/.exec(message)?.[1] ?? null
}

function postgresTarget({ table, column, detail }: DriverError): string | null {
  if (typeof table !== 'string') return null
  const key = typeof detail === 'string' ? /^Key \(([^)]+)\)/.exec(detail)?.[1] : undefined
  const name = key ?? (typeof column === 'string' ? column : undefined)
  return name ? `${table}.${name}` : null
}

/** The one place that knows each dialect's error shape; everything above sees this result. */
export function classifyConstraintError(error: unknown): ConstraintViolation | null {
  if (typeof error !== 'object' || error === null) return null
  const driverError = error as DriverError
  if (typeof driverError.code !== 'string') return null

  const sqliteKind = SQLITE_KINDS[driverError.code]
  if (sqliteKind) {
    const message = typeof driverError.message === 'string' ? driverError.message : ''
    return { kind: sqliteKind, target: sqliteTarget(message) }
  }

  const postgresKind = POSTGRES_KINDS[driverError.code]
  if (postgresKind) return { kind: postgresKind, target: postgresTarget(driverError) }

  return null
}

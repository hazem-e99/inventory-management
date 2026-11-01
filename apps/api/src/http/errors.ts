import { issuesToFields, type ApiError, type ErrorCode, type RequestCode } from '@inv/contracts'
import { classifyConstraintError } from '@inv/db'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodError } from 'zod'
import type { AppDeps, AppEnv } from './context'

const STATUS: Partial<Record<RequestCode, ContentfulStatusCode>> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  CURRENT_PASSWORD_WRONG: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  FORBIDDEN: 403,
  FORBIDDEN_ORIGIN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  INTERNAL: 500,
  BACKUP_FAILED: 500,
  LICENSE_READ_ONLY: 403,
  LICENSE_SERVER_UNREACHABLE: 503,
}

export interface AppErrorOptions {
  params?: NonNullable<ApiError['params']>
  fields?: Partial<Record<string, ErrorCode[]>>
}

export class AppError extends Error {
  constructor(
    readonly code: RequestCode,
    readonly options: AppErrorOptions = {},
  ) {
    super(code)
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code] ?? 409
  }
}

export function fieldError(field: string, code: ErrorCode): AppError {
  return new AppError('VALIDATION_FAILED', { fields: { [field]: [code] } })
}

export function validationError(error: ZodError): AppError {
  return new AppError('VALIDATION_FAILED', { fields: issuesToFields(error.issues) })
}

/** Maps a constraint violation to a field error when the column has a meaning for users. */
const CONSTRAINT_FIELDS: Record<string, [string, ErrorCode]> = {
  'users.username': ['username', 'USERNAME_TAKEN'],
  'roles.name': ['name', 'ROLE_NAME_TAKEN'],
  'product_variants.sku': ['sku', 'SKU_TAKEN'],
  'barcodes.code': ['barcode', 'BARCODE_TAKEN'],
  'suppliers.name': ['name', 'SUPPLIER_NAME_TAKEN'],
}

function fromConstraint(error: unknown): AppError | null {
  const violation = classifyConstraintError(error)
  if (!violation) return null
  const field = violation.target ? CONSTRAINT_FIELDS[violation.target] : undefined
  return field ? fieldError(field[0], field[1]) : new AppError('CONFLICT')
}

export function handleError(deps: AppDeps) {
  return (error: Error, c: Context<AppEnv>) => {
    const traceId = c.get('traceId')
    const known =
      error instanceof AppError
        ? error
        : error instanceof HTTPException && error.status === 400
          ? new AppError('VALIDATION_FAILED')
          : fromConstraint(error)

    if (known) {
      const body: ApiError = {
        code: known.code,
        status: known.status,
        ...(known.options.params ? { params: known.options.params } : {}),
        ...(known.options.fields ? { fields: known.options.fields as ApiError['fields'] & {} } : {}),
        traceId,
      }
      return c.json(body, known.status)
    }

    deps.logError('Unhandled API error', { traceId, path: c.req.path, message: error.message })
    const body: ApiError = { code: 'INTERNAL', status: 500, traceId }
    return c.json(body, 500)
  }
}

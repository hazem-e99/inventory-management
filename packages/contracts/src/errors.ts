import { z } from 'zod'

/** Field-level codes, reported under `fields` and rendered beneath the input. */
export const VALIDATION_CODES = [
  'REQUIRED',
  'INVALID_VALUE',
  'NAME_TOO_SHORT',
  'TEXT_TOO_LONG',
  'USERNAME_INVALID',
  'USERNAME_TAKEN',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORDS_DO_NOT_MATCH',
  'PIN_INVALID',
  'PHONE_INVALID',
  'TAX_NUMBER_INVALID',
  'ROLE_NAME_TAKEN',
  'RECOVERY_CODE_INVALID',
  'BACKUP_PATH_INVALID',
  'NAME_TAKEN',
  'SKU_TAKEN',
  'BARCODE_INVALID',
  'BARCODE_TAKEN',
  'BARCODE_DUPLICATED',
  'PRICE_INVALID',
  'FACTOR_INVALID',
  'UNIT_DUPLICATED',
  'UNIT_NOT_FOUND',
  'VARIANT_REQUIRED',
  'VARIANT_LABEL_REQUIRED',
  'CATEGORY_CYCLE',
] as const

/** Request-level codes, each with a translated message in `@inv/i18n`. */
export const REQUEST_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'FORBIDDEN_ORIGIN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL',
  'NETWORK',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DISABLED',
  'PIN_NOT_SET',
  'ALREADY_ONBOARDED',
  'NOT_ONBOARDED',
  'CURRENT_PASSWORD_WRONG',
  'PASSWORD_CHANGE_REQUIRED',
  'CANNOT_DISABLE_SELF',
  'LAST_OWNER',
  'ROLE_IS_SYSTEM',
  'ROLE_IN_USE',
  'BACKUP_FAILED',
  'BACKUP_INVALID',
  'BACKUP_TOO_NEW',
  'RESTORE_FAILED',
  'REFERENCE_IN_USE',
  'REFERENCE_IS_SYSTEM',
  'IMPORT_FILE_INVALID',
  'IMPORT_FILE_UNREADABLE',
  'IMPORT_COLUMNS_MISSING',
  'IMPORT_TOO_MANY_ROWS',
  'IMPORT_EMPTY',
  'EXPORT_FAILED',
] as const

export const ERROR_CODES = [...VALIDATION_CODES, ...REQUEST_CODES] as const

export type ValidationCode = (typeof VALIDATION_CODES)[number]
export type RequestCode = (typeof REQUEST_CODES)[number]
export type ErrorCode = (typeof ERROR_CODES)[number]

const errorCodes = new Set<string>(ERROR_CODES)

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && errorCodes.has(value)
}

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  status: z.number().int(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  fields: z.record(z.string(), z.array(z.enum(ERROR_CODES))).optional(),
  traceId: z.string().optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>

/**
 * Turns Zod issues into `{ "owner.password": ["PASSWORD_TOO_SHORT"] }`. Schemas here use
 * error codes as messages, so anything else is an unmapped rule and reads as INVALID_VALUE.
 */
export function issuesToFields(issues: readonly z.core.$ZodIssue[]): Record<string, ErrorCode[]> {
  const fields: Record<string, ErrorCode[]> = {}
  for (const issue of issues) {
    const path = issue.path.join('.')
    const code = isErrorCode(issue.message) ? issue.message : 'INVALID_VALUE'
    const existing = fields[path] ?? []
    if (!existing.includes(code)) existing.push(code)
    fields[path] = existing
  }
  return fields
}

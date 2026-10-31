import { isErrorCode, type ApiError, type ErrorCode } from '@inv/contracts'
import { useCallback } from 'react'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiRequestError } from './api'

export function errorDetails(error: unknown): ApiError {
  return error instanceof ApiRequestError ? error.error : { code: 'INTERNAL', status: 0 }
}

export function useErrorText() {
  const { t } = useTranslation()
  return useCallback(
    (code: string | undefined, params?: ApiError['params']): string => {
      const known: ErrorCode = isErrorCode(code) ? code : 'INVALID_VALUE'
      return (t as (key: string, options?: object) => string)(`errors.${known}`, params)
    },
    [t],
  )
}

/**
 * Field errors land under their inputs and the first one takes focus. Anything without a
 * field becomes a toast, so a failed save always tells the user what happened.
 */
export function useReportError<T extends FieldValues>(
  form?: UseFormReturn<T, unknown, any>,
  mapField: (path: string) => string | null = (path) => path,
) {
  const errorText = useErrorText()

  return useCallback(
    (error: unknown) => {
      const { code, params, fields } = errorDetails(error)
      const entries = Object.entries(fields ?? {})

      let shown = false
      if (form) {
        for (const [field, codes] of entries) {
          const target = mapField(field)
          if (!target) continue
          form.setError(
            target as Path<T>,
            { type: 'server', message: codes[0] ?? 'INVALID_VALUE' },
            { shouldFocus: !shown },
          )
          shown = true
        }
      }
      if (shown) return

      // A problem with no input to sit under still has to reach the user, with its reason.
      toast.error(errorText(entries[0]?.[1][0] ?? code, params))
    },
    [errorText, form, mapField],
  )
}

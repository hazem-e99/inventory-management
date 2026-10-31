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
export function useReportError<T extends FieldValues>(form?: UseFormReturn<T>) {
  const errorText = useErrorText()

  return useCallback(
    (error: unknown) => {
      const { code, params, fields } = errorDetails(error)
      const entries = Object.entries(fields ?? {})

      if (form && entries.length > 0) {
        entries.forEach(([field, codes], index) => {
          form.setError(
            field as Path<T>,
            { type: 'server', message: codes[0] ?? 'INVALID_VALUE' },
            { shouldFocus: index === 0 },
          )
        })
        return
      }
      toast.error(errorText(code, params))
    },
    [errorText, form],
  )
}

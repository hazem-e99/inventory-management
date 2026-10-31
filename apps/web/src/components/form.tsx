import { Button, Dialog, Field, Input, Select, type ButtonProps } from '@inv/ui'
import { useBlocker } from '@tanstack/react-router'
import { useId, type ComponentProps, type ReactNode } from 'react'
import {
  get,
  useFormState,
  type FieldError,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useErrorText } from '../lib/errors'

interface FieldBaseProps<T extends FieldValues> {
  form: UseFormReturn<T, unknown, any>
  name: Path<T>
  label: ReactNode
  hint?: ReactNode
  className?: string
}

function useFieldError<T extends FieldValues>(form: UseFormReturn<T, unknown, any>, name: Path<T>) {
  const errorText = useErrorText()
  const { errors } = useFormState({ control: form.control, name })
  // `get` follows dotted paths such as `store.name`.
  const error = get(errors, name) as FieldError | undefined
  return error ? errorText(error.message) : undefined
}

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  ...input
}: FieldBaseProps<T> & Omit<ComponentProps<'input'>, 'form' | 'name'>) {
  const id = useId()
  const error = useFieldError(form, name)
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...input}
        {...form.register(name)}
      />
    </Field>
  )
}

export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  children,
}: FieldBaseProps<T> & { children: ReactNode }) {
  const id = useId()
  const error = useFieldError(form, name)
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <Select id={id} aria-invalid={error ? true : undefined} {...form.register(name)}>
        {children}
      </Select>
    </Field>
  )
}

export function SubmitButton({
  form,
  children,
  ...props
}: { form: UseFormReturn<any, any, any> } & Omit<ButtonProps, 'form'>) {
  const { isSubmitting } = useFormState({ control: form.control })
  return (
    <Button type="submit" loading={isSubmitting} {...props}>
      {children}
    </Button>
  )
}

/** Holds navigation while a form has edits, so nothing is lost to a stray click. */
export function UnsavedGuard({ when }: { when: boolean }) {
  const { t } = useTranslation()
  // beforeunload stays off: in Electron it silently stops the window from closing at all.
  const blocker = useBlocker({ shouldBlockFn: () => when, withResolver: true, enableBeforeUnload: false })

  return (
    <Dialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.()
      }}
      title={t('common.unsavedTitle')}
      description={t('common.unsavedBody')}
      closeLabel={t('common.close')}
    >
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => blocker.reset?.()}>
          {t('common.stay')}
        </Button>
        <Button variant="danger" onClick={() => blocker.proceed?.()}>
          {t('common.leave')}
        </Button>
      </div>
    </Dialog>
  )
}

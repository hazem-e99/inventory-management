import { CircleAlert } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../utils'

const controlStyles =
  'h-10 w-full rounded-md border border-rule-strong bg-surface px-3 text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-ink-faint disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-faint aria-invalid:border-danger'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlStyles, className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlStyles, className)} {...props} />
}

export interface FieldProps {
  id: string
  label: ReactNode
  hint?: ReactNode | undefined
  error?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
}

export function Field({ id, label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

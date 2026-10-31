import type { ComponentProps } from 'react'
import { cn } from '../utils'

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
      <table className={cn('w-full border-collapse text-start', className)} {...props} />
    </div>
  )
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-rule bg-sunken px-4 py-2.5 text-start text-sm font-medium whitespace-nowrap text-ink-soft',
        className,
      )}
      {...props}
    />
  )
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('border-b border-rule px-4 py-3 align-middle', className)} {...props} />
}

export function Tr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('[&:last-child>td]:border-b-0 hover:bg-ground', className)} {...props} />
}

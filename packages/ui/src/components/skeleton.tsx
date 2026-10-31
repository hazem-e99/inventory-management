import type { ComponentProps } from 'react'
import { cn } from '../utils'

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('animate-shimmer rounded-sm bg-sunken', className)} {...props} />
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-busy className="overflow-hidden rounded-lg border border-rule bg-surface">
      <div className="flex gap-6 border-b border-rule bg-sunken px-4 py-3">
        {Array.from({ length: columns }, (_, column) => (
          <Skeleton key={column} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-6 border-b border-rule px-4 py-3.5 last:border-b-0">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div role="status" aria-busy className="flex max-w-xl flex-col gap-5">
      {Array.from({ length: fields }, (_, field) => (
        <div key={field} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}

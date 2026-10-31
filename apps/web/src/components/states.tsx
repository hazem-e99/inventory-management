import { Button } from '@inv/ui'
import type { UseQueryResult } from '@tanstack/react-query'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { Copy, TriangleAlert } from 'lucide-react'
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { errorDetails, useErrorText } from '../lib/errors'

const SKELETON_DELAY_MS = 150

/** Stops a skeleton flashing for a fetch that finishes almost instantly. */
function Delayed({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return visible ? children : null
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-rule-strong bg-surface px-6 py-10">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {body && <p className="max-w-prose text-ink-soft">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

function SupportCopy({ traceId }: { traceId: string }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(traceId).then(() => toast.success(t('common.copied')))
      }}
    >
      <Copy aria-hidden className="size-4" />
      {t('common.copySupport')}
    </Button>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  const errorText = useErrorText()
  const { code, params, traceId } = errorDetails(error)

  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-rule bg-danger-soft px-6 py-6">
      <div className="flex items-center gap-2 font-semibold text-danger">
        <TriangleAlert aria-hidden className="size-5" />
        {t('state.errorTitle')}
      </div>
      <p className="max-w-prose text-ink">{errorText(code, params)}</p>
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
        {code === 'INTERNAL' && traceId && <SupportCopy traceId={traceId} />}
      </div>
    </div>
  )
}

export interface QueryBoundaryProps<T> {
  query: UseQueryResult<T>
  skeleton: ReactNode
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  children: (data: T) => ReactNode
}

/** Every data view has the same four states, so none of them is forgotten on a new screen. */
export function QueryBoundary<T>({ query, skeleton, isEmpty, empty, children }: QueryBoundaryProps<T>) {
  if (query.isPending) return <Delayed>{skeleton}</Delayed>
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (isEmpty?.(query.data)) return empty
  return children(query.data)
}

/** Background activity: stays out of the way, and existing data stays on screen. */
export function TopProgress() {
  const fetching = useIsFetching()
  const mutating = useIsMutating()
  if (fetching + mutating === 0) return null

  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden [animation-delay:150ms]">
      <div className="animate-progress h-full origin-[inline-start] bg-route ltr:origin-left rtl:origin-right" />
    </div>
  )
}

interface BoundaryState {
  error: unknown
}

function CrashScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex max-w-xl flex-col items-start gap-3 p-8">
      <h1 className="text-xl font-semibold text-ink">{t('state.crashTitle')}</h1>
      <p className="text-ink-soft">{t('state.crashBody')}</p>
      <Button onClick={onRetry}>{t('common.retry')}</Button>
    </div>
  )
}

export class CrashBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render failure', error, info.componentStack)
  }

  override render() {
    if (this.state.error) return <CrashScreen onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}

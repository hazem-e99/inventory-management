import { auditPageSchema, type AuditEntry } from '@inv/contracts'
import { Button, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'
import { useAuditLabel } from './audit-label'

const ROW_HEIGHT = 48
const PAGE_SIZE = 50

const COLUMNS = 'grid grid-cols-[13rem_14rem_1fr] items-center gap-4 px-4'

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation()
  const format = useFormat()
  const label = useAuditLabel()
  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <span role="cell" className="tabular text-ink-soft">
        {format.dateTime(entry.occurredAt)}
      </span>
      <span role="cell" className="truncate">
        {entry.actorName ?? t('audit.system')}
      </span>
      <span role="cell" className="truncate">
        {label(entry.action)}
      </span>
    </div>
  )
}

export function AuditPage() {
  const { t } = useTranslation()

  const query = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return api(auditPageSchema, 'GET', `/audit?limit=${PAGE_SIZE}${cursor}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  })

  const entries = query.data?.pages.flatMap((page) => page.items) ?? []

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex h-full flex-col gap-6">
      <Sign title={t('nav.audit.label')} secondary={t('nav.audit.other')} />

      {query.isPending ? (
        <TableSkeleton columns={3} rows={10} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState title={t('audit.emptyTitle')} body={t('audit.emptyBody')} />
      ) : (
        <VirtualRows
          items={entries}
          rowHeight={ROW_HEIGHT}
          onNearEnd={loadMore}
          header={
            <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
              <span role="columnheader">{t('audit.time')}</span>
              <span role="columnheader">{t('audit.actor')}</span>
              <span role="columnheader">{t('audit.action')}</span>
            </div>
          }
          renderRow={(entry) => <AuditRow entry={entry} />}
        />
      )}
      {query.isFetchNextPageError && (
        <Button variant="secondary" onClick={() => void query.fetchNextPage()}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}

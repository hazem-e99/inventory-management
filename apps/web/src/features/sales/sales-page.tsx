import {
  SALE_KINDS,
  SALE_STATUSES,
  salePageSchema,
  type SaleKind,
  type SaleRow,
  type SaleStatus,
} from '@inv/contracts'
import { Badge, Input, Select, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'
import { SALE_STATUS_TONE } from './queries'

const ROW_HEIGHT = 52
const PAGE_SIZE = 50
const SEARCH_DELAY_MS = 150
const COLUMNS = 'grid grid-cols-[9rem_8rem_6rem_minmax(8rem,1fr)_8rem_11rem] items-center gap-3 px-4'

function SaleRowView({ sale }: { sale: SaleRow }) {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <div role="cell" className="truncate">
        <Link to="/sales/$id" params={{ id: sale.id }} className="font-medium text-ink hover:text-route">
          <bdi dir="ltr">{sale.number}</bdi>
        </Link>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {t(`sales.kinds.${sale.kind}`)}
      </div>
      <div role="cell">
        <Badge tone={SALE_STATUS_TONE[sale.status]}>{t(`sales.statuses.${sale.status}`)}</Badge>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {sale.customerName ?? t('sales.walkIn')}
      </div>
      <div role="cell" className="tabular text-end font-medium text-ink">
        {format.money(sale.totalMinor)}
      </div>
      <div role="cell" className="tabular truncate text-sm text-ink-soft">
        {format.dateTime(sale.createdAt)}
      </div>
    </div>
  )
}

export function SalesPage() {
  const { t } = useTranslation()
  const [kind, setKind] = useState<SaleKind | ''>('')
  const [status, setStatus] = useState<SaleStatus | ''>('')
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const query = useInfiniteQuery({
    queryKey: ['sales', 'list', { kind, status, search }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (pageParam) params.set('cursor', pageParam)
      if (kind) params.set('kind', kind)
      if (status) params.set('status', status)
      if (search) params.set('search', search)
      return api(salePageSchema, 'GET', `/sales?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  })

  const sales = query.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex h-full flex-col gap-4">
      <Sign title={t('nav.sales.label')} secondary={t('nav.sales.other')} />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search aria-hidden className="absolute start-3 top-3 size-4 text-ink-faint" />
          <Input
            type="search"
            aria-label={t('sales.search')}
            placeholder={t('sales.search')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="ps-9"
          />
        </div>
        <Select aria-label={t('sales.kind')} value={kind} onChange={(event) => setKind(event.target.value as SaleKind | '')} className="w-44">
          <option value="">{t('sales.allKinds')}</option>
          {SALE_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`sales.kinds.${value}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('sales.status')} value={status} onChange={(event) => setStatus(event.target.value as SaleStatus | '')} className="w-44">
          <option value="">{t('sales.allStatuses')}</option>
          {SALE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`sales.statuses.${value}`)}
            </option>
          ))}
        </Select>
      </div>

      {query.isPending ? (
        <TableSkeleton columns={6} rows={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : sales.length === 0 ? (
        <EmptyState title={t('sales.emptyTitle')} body={t('sales.emptyBody')} />
      ) : (
        <VirtualRows
          items={sales}
          rowHeight={ROW_HEIGHT}
          onNearEnd={loadMore}
          header={
            <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
              <span role="columnheader">{t('sales.number')}</span>
              <span role="columnheader">{t('sales.kind')}</span>
              <span role="columnheader">{t('sales.status')}</span>
              <span role="columnheader">{t('sales.customer')}</span>
              <span role="columnheader" className="text-end">
                {t('sales.total')}
              </span>
              <span role="columnheader">{t('sales.date')}</span>
            </div>
          }
          renderRow={(sale) => <SaleRowView sale={sale} />}
        />
      )}
    </div>
  )
}

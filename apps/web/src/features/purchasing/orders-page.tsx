import { ORDER_STATUSES, orderPageSchema, type OrderRow, type OrderStatus } from '@inv/contracts'
import { Badge, Button, Select, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { ORDER_STATUS_TONE } from './queries'

const ROW_HEIGHT = 52
const PAGE_SIZE = 50
const COLUMNS = 'grid grid-cols-[8rem_8rem_minmax(8rem,1fr)_8rem_5rem_11rem] items-center gap-3 px-4'

function OrderRowView({ order }: { order: OrderRow }) {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <div role="cell" className="truncate">
        <Link to="/orders/$id" params={{ id: order.id }} className="font-medium text-ink hover:text-route">
          <bdi dir="ltr">{order.number ?? t('orders.statuses.draft')}</bdi>
        </Link>
      </div>
      <div role="cell">
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{t(`orders.statuses.${order.status}`)}</Badge>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {order.supplierName}
      </div>
      <div role="cell" className="tabular text-end font-medium text-ink">
        {format.money(order.totalMinor)}
      </div>
      <div role="cell" className="tabular text-ink-soft">
        {format.number(order.lineCount)}
      </div>
      <div role="cell" className="tabular truncate text-sm text-ink-soft">
        {format.dateTime(order.createdAt)}
      </div>
    </div>
  )
}

export function OrdersPage() {
  const { t } = useTranslation()
  const canManage = useCan('purchases.manage')
  const [status, setStatus] = useState<OrderStatus | ''>('')

  const query = useInfiniteQuery({
    queryKey: ['purchases', 'orders', { status }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (pageParam) params.set('cursor', pageParam)
      if (status) params.set('status', status)
      return api(orderPageSchema, 'GET', `/purchase-orders?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  })

  const orders = query.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex h-full flex-col gap-4">
      <Sign
        title={t('nav.orders.label')}
        secondary={t('nav.orders.other')}
        actions={
          canManage && (
            <Link to="/orders/new">
              <Button tabIndex={-1}>
                <Plus aria-hidden className="size-4" />
                {t('orders.add')}
              </Button>
            </Link>
          )
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select
          aria-label={t('orders.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value as OrderStatus | '')}
          className="w-48"
        >
          <option value="">{t('orders.allStatuses')}</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`orders.statuses.${value}`)}
            </option>
          ))}
        </Select>
      </div>

      {query.isPending ? (
        <TableSkeleton columns={6} rows={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState title={t('orders.emptyTitle')} body={t('orders.emptyBody')} />
      ) : (
        <VirtualRows
          items={orders}
          rowHeight={ROW_HEIGHT}
          onNearEnd={loadMore}
          header={
            <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
              <span role="columnheader">{t('orders.number')}</span>
              <span role="columnheader">{t('orders.status')}</span>
              <span role="columnheader">{t('orders.supplier')}</span>
              <span role="columnheader" className="text-end">
                {t('orders.total')}
              </span>
              <span role="columnheader">{t('orders.lines')}</span>
              <span role="columnheader">{t('orders.date')}</span>
            </div>
          }
          renderRow={(order) => <OrderRowView order={order} />}
        />
      )}
    </div>
  )
}

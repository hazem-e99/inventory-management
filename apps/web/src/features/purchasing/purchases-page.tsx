import {
  PURCHASE_KINDS,
  PURCHASE_STATUSES,
  purchasePageSchema,
  type PurchaseKind,
  type PurchaseRow,
  type PurchaseStatus,
} from '@inv/contracts'
import { Badge, Button, Select, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, Undo2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { PURCHASE_STATUS_TONE } from './queries'

const ROW_HEIGHT = 52
const PAGE_SIZE = 50
const COLUMNS = 'grid grid-cols-[9rem_8rem_6rem_minmax(8rem,1fr)_8rem_11rem] items-center gap-3 px-4'

function PurchaseRowView({ purchase }: { purchase: PurchaseRow }) {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <div role="cell" className="truncate">
        <Link to="/purchases/$id" params={{ id: purchase.id }} className="font-medium text-ink hover:text-route">
          <bdi dir="ltr">{purchase.number ?? t('purchases.statuses.draft')}</bdi>
        </Link>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {t(`purchases.kinds.${purchase.kind}`)}
      </div>
      <div role="cell">
        <Badge tone={PURCHASE_STATUS_TONE[purchase.status]}>{t(`purchases.statuses.${purchase.status}`)}</Badge>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {purchase.supplierName}
      </div>
      <div role="cell" className="tabular text-end font-medium text-ink">
        {format.money(purchase.totalMinor)}
      </div>
      <div role="cell" className="tabular truncate text-sm text-ink-soft">
        {format.dateTime(purchase.createdAt)}
      </div>
    </div>
  )
}

export function PurchasesPage() {
  const { t } = useTranslation()
  const canManage = useCan('purchases.manage')
  const [kind, setKind] = useState<PurchaseKind | ''>('')
  const [status, setStatus] = useState<PurchaseStatus | ''>('')

  const query = useInfiniteQuery({
    queryKey: ['purchases', 'list', { kind, status }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (pageParam) params.set('cursor', pageParam)
      if (kind) params.set('kind', kind)
      if (status) params.set('status', status)
      return api(purchasePageSchema, 'GET', `/purchases?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  })

  const purchases = query.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex h-full flex-col gap-4">
      <Sign
        title={t('nav.purchases.label')}
        secondary={t('nav.purchases.other')}
        actions={
          canManage && (
            <>
              <Link to="/purchases/new/$kind" params={{ kind: 'return' }}>
                <Button variant="secondary" tabIndex={-1}>
                  <Undo2 aria-hidden className="size-4" />
                  {t('purchases.newReturn')}
                </Button>
              </Link>
              <Link to="/purchases/new/$kind" params={{ kind: 'invoice' }}>
                <Button tabIndex={-1}>
                  <Plus aria-hidden className="size-4" />
                  {t('purchases.newInvoice')}
                </Button>
              </Link>
            </>
          )
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select
          aria-label={t('purchases.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value as PurchaseKind | '')}
          className="w-48"
        >
          <option value="">{t('purchases.allKinds')}</option>
          {PURCHASE_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`purchases.kinds.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('purchases.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value as PurchaseStatus | '')}
          className="w-48"
        >
          <option value="">{t('purchases.allStatuses')}</option>
          {PURCHASE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`purchases.statuses.${value}`)}
            </option>
          ))}
        </Select>
      </div>

      {query.isPending ? (
        <TableSkeleton columns={6} rows={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : purchases.length === 0 ? (
        <EmptyState title={t('purchases.emptyTitle')} body={t('purchases.emptyBody')} />
      ) : (
        <VirtualRows
          items={purchases}
          rowHeight={ROW_HEIGHT}
          onNearEnd={loadMore}
          header={
            <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
              <span role="columnheader">{t('purchases.number')}</span>
              <span role="columnheader">{t('purchases.kind')}</span>
              <span role="columnheader">{t('purchases.status')}</span>
              <span role="columnheader">{t('purchases.supplier')}</span>
              <span role="columnheader" className="text-end">
                {t('purchases.total')}
              </span>
              <span role="columnheader">{t('purchases.date')}</span>
            </div>
          }
          renderRow={(purchase) => <PurchaseRowView purchase={purchase} />}
        />
      )}
    </div>
  )
}

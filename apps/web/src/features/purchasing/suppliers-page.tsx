import { supplierPageSchema, type Supplier } from '@inv/contracts'
import { Badge, Button, Input, Select, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { SupplierDialog } from './supplier-dialog'

const ROW_HEIGHT = 52
const PAGE_SIZE = 50
const SEARCH_DELAY_MS = 150
const COLUMNS = 'grid grid-cols-[minmax(10rem,1fr)_10rem_13rem_11rem] items-center gap-3 px-4'

export function useBalanceLabel() {
  const { t } = useTranslation()
  return (balanceMinor: number): string =>
    t(balanceMinor > 0 ? 'suppliers.youOwe' : balanceMinor < 0 ? 'suppliers.theyOwe' : 'suppliers.settled')
}

function SupplierRow({ supplier }: { supplier: Supplier }) {
  const { t } = useTranslation()
  const format = useFormat()
  const balanceLabel = useBalanceLabel()

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <div role="cell" className="flex min-w-0 items-center gap-2">
        <Link to="/suppliers/$id" params={{ id: supplier.id }} className="truncate font-medium text-ink hover:text-route">
          {supplier.name}
        </Link>
        {supplier.archived && <Badge>{t('suppliers.archivedBadge')}</Badge>}
      </div>
      <div role="cell" className="tabular truncate text-ink-soft">
        <bdi dir="ltr">{supplier.phone}</bdi>
      </div>
      <div role="cell" className="truncate text-sm text-ink-soft">
        {balanceLabel(supplier.balanceMinor)}
      </div>
      <div role="cell" className="tabular text-end font-medium text-ink">
        {format.money(Math.abs(supplier.balanceMinor))}
      </div>
    </div>
  )
}

export function SuppliersPage() {
  const { t } = useTranslation()
  const canManage = useCan('suppliers.manage')
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState<'false' | 'true'>('false')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const query = useInfiniteQuery({
    queryKey: ['suppliers', 'list', { search, archived }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), archived })
      if (pageParam) params.set('cursor', pageParam)
      if (search) params.set('search', search)
      return api(supplierPageSchema, 'GET', `/suppliers?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  })

  const suppliers = query.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const addButton = canManage && (
    <Button onClick={() => setAdding(true)}>
      <Plus aria-hidden className="size-4" />
      {t('suppliers.add')}
    </Button>
  )

  return (
    <div className="flex h-full flex-col gap-4">
      <Sign title={t('nav.suppliers.label')} secondary={t('nav.suppliers.other')} actions={addButton} />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search aria-hidden className="absolute start-3 top-3 size-4 text-ink-faint" />
          <Input
            type="search"
            aria-label={t('suppliers.search')}
            placeholder={t('suppliers.search')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="ps-9"
          />
        </div>
        <Select
          aria-label={t('suppliers.archivedList')}
          value={archived}
          onChange={(event) => setArchived(event.target.value as 'false' | 'true')}
          className="w-48"
        >
          <option value="false">{t('suppliers.active')}</option>
          <option value="true">{t('suppliers.archivedList')}</option>
        </Select>
      </div>

      {query.isPending ? (
        <TableSkeleton columns={4} rows={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : suppliers.length === 0 ? (
        <EmptyState title={t('suppliers.emptyTitle')} body={t('suppliers.emptyBody')} />
      ) : (
        <VirtualRows
          items={suppliers}
          rowHeight={ROW_HEIGHT}
          onNearEnd={loadMore}
          header={
            <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
              <span role="columnheader">{t('suppliers.name')}</span>
              <span role="columnheader">{t('suppliers.phone')}</span>
              <span role="columnheader">{t('suppliers.balance')}</span>
              <span role="columnheader" className="text-end">
                {t('suppliers.amount')}
              </span>
            </div>
          }
          renderRow={(supplier) => <SupplierRow supplier={supplier} />}
        />
      )}

      {adding && <SupplierDialog supplier={null} onClose={() => setAdding(false)} />}
    </div>
  )
}

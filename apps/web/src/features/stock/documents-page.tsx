import {
  STOCK_DOCUMENT_KINDS,
  STOCK_DOCUMENT_STATUSES,
  stockDocumentPageSchema,
  stockDocumentSchema,
  type StockDocumentKind,
  type StockDocumentRow,
  type StockDocumentStatus,
} from '@inv/contracts'
import { Badge, Button, Dialog, Field, Select, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight, ClipboardCheck, SlidersHorizontal } from 'lucide-react'
import { useCallback, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { referenceQuery, useReferenceName } from '../catalog/queries'

const ROW_HEIGHT = 52
const PAGE_SIZE = 50
const COLUMNS = 'grid grid-cols-[9rem_7rem_7rem_minmax(8rem,1fr)_5rem_11rem] items-center gap-3 px-4'

export const STATUS_TONE: Record<StockDocumentStatus, ComponentProps<typeof Badge>['tone']> = {
  draft: 'warn',
  posted: 'ok',
  voided: 'neutral',
}

function DocumentRow({ document, warehouseName }: { document: StockDocumentRow; warehouseName: (id: string) => string }) {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <div role="cell" className="truncate">
        <Link to="/stock/$id" params={{ id: document.id }} className="font-medium text-ink hover:text-route">
          <bdi dir="ltr">{document.number ?? t('stock.statuses.draft')}</bdi>
        </Link>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {t(`stock.kinds.${document.kind}`)}
      </div>
      <div role="cell">
        <Badge tone={STATUS_TONE[document.status]}>{t(`stock.statuses.${document.status}`)}</Badge>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {warehouseName(document.warehouseId)}
      </div>
      <div role="cell" className="tabular text-ink-soft">
        {format.number(document.lineCount)}
      </div>
      <div role="cell" className="tabular truncate text-sm text-ink-soft">
        {format.dateTime(document.postedAt ?? document.createdAt)}
      </div>
    </div>
  )
}

function NewCountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const report = useReportError()
  const warehouseLabel = useReferenceName('warehouses')
  const warehouses = useQuery(referenceQuery('warehouses'))
  const categories = useQuery(referenceQuery('categories'))
  const [warehouseId, setWarehouseId] = useState('main')
  const [categoryId, setCategoryId] = useState('')

  const start = useMutation({
    mutationFn: () =>
      api(stockDocumentSchema, 'POST', '/stock/documents/count-sheet', {
        body: { warehouseId, categoryId: categoryId || null },
      }),
    onSuccess: (document) => navigate({ to: '/stock/$id', params: { id: document.id } }),
    onError: report,
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('stock.countTitle')}
      description={t('stock.countBody')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <Field id="count-warehouse" label={t('stock.warehouse')}>
          <Select id="count-warehouse" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            {warehouses.data?.items
              .filter((row) => !row.archived)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {warehouseLabel(row)}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="count-category" label={t('stock.countCategory')}>
          <Select id="count-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">{t('stock.countAll')}</option>
            {categories.data?.items.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={start.isPending} onClick={() => start.mutate()}>
            {t('stock.countStart')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DocumentsPage() {
  const { t } = useTranslation()
  const canManage = useCan('stock.manage')
  const warehouseLabel = useReferenceName('warehouses')
  const warehouses = useQuery(referenceQuery('warehouses'))
  const [kind, setKind] = useState<StockDocumentKind | ''>('')
  const [status, setStatus] = useState<StockDocumentStatus | ''>('')
  const [counting, setCounting] = useState(false)

  const query = useInfiniteQuery({
    queryKey: ['stock', 'documents', { kind, status }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (pageParam) params.set('cursor', pageParam)
      if (kind) params.set('kind', kind)
      if (status) params.set('status', status)
      return api(stockDocumentPageSchema, 'GET', `/stock/documents?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  })

  const documents = query.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const warehouseName = (id: string) => {
    const row = warehouses.data?.items.find((item) => item.id === id)
    return row ? warehouseLabel(row) : ''
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <Sign
        title={t('nav.stock.label')}
        secondary={t('nav.stock.other')}
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={() => setCounting(true)}>
                <ClipboardCheck aria-hidden className="size-4" />
                {t('stock.newCount')}
              </Button>
              <Link to="/stock/new/$kind" params={{ kind: 'transfer' }}>
                <Button variant="secondary" tabIndex={-1}>
                  <ArrowLeftRight aria-hidden className="size-4" />
                  {t('stock.newTransfer')}
                </Button>
              </Link>
              <Link to="/stock/new/$kind" params={{ kind: 'adjustment' }}>
                <Button tabIndex={-1}>
                  <SlidersHorizontal aria-hidden className="size-4" />
                  {t('stock.newAdjustment')}
                </Button>
              </Link>
            </>
          )
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select
          aria-label={t('stock.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value as StockDocumentKind | '')}
          className="w-48"
        >
          <option value="">{t('stock.allKinds')}</option>
          {STOCK_DOCUMENT_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`stock.kinds.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('stock.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value as StockDocumentStatus | '')}
          className="w-48"
        >
          <option value="">{t('stock.allStatuses')}</option>
          {STOCK_DOCUMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`stock.statuses.${value}`)}
            </option>
          ))}
        </Select>
      </div>

      {query.isPending ? (
        <TableSkeleton columns={6} rows={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : documents.length === 0 ? (
        <EmptyState title={t('stock.emptyTitle')} body={t('stock.emptyBody')} />
      ) : (
        <VirtualRows
          items={documents}
          rowHeight={ROW_HEIGHT}
          onNearEnd={loadMore}
          header={
            <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
              <span role="columnheader">{t('stock.number')}</span>
              <span role="columnheader">{t('stock.kind')}</span>
              <span role="columnheader">{t('stock.status')}</span>
              <span role="columnheader">{t('stock.warehouse')}</span>
              <span role="columnheader">{t('stock.lines')}</span>
              <span role="columnheader">{t('stock.date')}</span>
            </div>
          }
          renderRow={(document) => <DocumentRow document={document} warehouseName={warehouseName} />}
        />
      )}

      {counting && <NewCountDialog onClose={() => setCounting(false)} />}
    </div>
  )
}

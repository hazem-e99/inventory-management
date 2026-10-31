import { fileSavedSchema, okSchema, productPageSchema, type ProductRow } from '@inv/contracts'
import { Badge, Button, Input, Menu, MenuItem, Select, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Ellipsis, FileDown, FileUp, History, Pencil, Plus, Search, Tag } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EmptyState, ErrorState } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { desktop } from '../../lib/desktop'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { usePreferences } from '../../lib/preferences'
import { useCan } from '../../lib/session'
import { ImportDialog } from './import-dialog'
import { LabelsDialog } from './labels-dialog'
import { referenceQuery } from './queries'

const ROW_HEIGHT = 56
const PAGE_SIZE = 50
const SEARCH_DELAY_MS = 180
const COLUMNS = 'grid grid-cols-[minmax(13rem,2fr)_8rem_9rem_minmax(7rem,1fr)_6rem_6rem_3rem] items-center gap-3 px-4'

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [delay, value])
  return settled
}

function ProductActions({
  product,
  onLabels,
}: {
  product: ProductRow
  onLabels: (product: ProductRow) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const report = useReportError()
  const canManage = useCan('catalog.manage')
  const canViewStock = useCan('stock.view')

  const setArchived = useMutation({
    mutationFn: () => api(okSchema, 'POST', `/products/${product.id}/${product.archived ? 'restore' : 'archive'}`),
    onSuccess: () => {
      toast.success(product.archived ? t('products.restored') : t('products.archived'))
      return queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: report,
  })

  return (
    <Menu
      trigger={
        <Button variant="ghost" size="icon" aria-label={t('products.actions', { name: product.name })}>
          <Ellipsis aria-hidden className="size-4" />
        </Button>
      }
    >
      {canManage && (
        <MenuItem onSelect={() => void navigate({ to: '/products/$id', params: { id: product.id } })}>
          <Pencil aria-hidden />
          {t('common.edit')}
        </MenuItem>
      )}
      {canViewStock && (
        <MenuItem onSelect={() => void navigate({ to: '/products/$id/stock', params: { id: product.id } })}>
          <History aria-hidden />
          {t('products.stock')}
        </MenuItem>
      )}
      <MenuItem onSelect={() => onLabels(product)}>
        <Tag aria-hidden />
        {t('products.labels')}
      </MenuItem>
      {canManage && (
        <MenuItem onSelect={() => setArchived.mutate()}>
          {product.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {product.archived ? t('products.restore') : t('products.archive')}
        </MenuItem>
      )}
    </Menu>
  )
}

function ProductRowView({
  product,
  onLabels,
}: {
  product: ProductRow
  onLabels: (product: ProductRow) => void
}) {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <div role="cell" className="min-w-0">
        <Link to="/products/$id" params={{ id: product.id }} className="block truncate font-medium text-ink hover:text-route">
          {product.name}
        </Link>
        <p className="truncate text-sm text-ink-faint">
          {product.genericName ?? (product.variantCount > 1 ? t('products.variants', { count: product.variantCount }) : '')}
        </p>
      </div>
      <div role="cell" className="truncate text-sm text-ink-soft">
        <bdi dir="ltr">{product.sku}</bdi>
      </div>
      <div role="cell" className="tabular truncate text-sm text-ink-soft">
        <bdi dir="ltr">{product.barcode}</bdi>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {product.categoryName}
      </div>
      <div role="cell" className="tabular text-end">
        {format.quantity(product.onHandMilli)}
      </div>
      <div role="cell" className="tabular text-end font-medium">
        {product.priceMinor === null ? '' : format.money(product.priceMinor)}
      </div>
      <div role="cell">
        <ProductActions product={product} onLabels={onLabels} />
      </div>
    </div>
  )
}

export function ProductsPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const report = useReportError()
  const { preferences } = usePreferences()
  const canManage = useCan('catalog.manage')
  const canImport = useCan('catalog.import')

  const [searchText, setSearchText] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [archived, setArchived] = useState(false)
  const [importing, setImporting] = useState(false)
  const [labelsFor, setLabelsFor] = useState<ProductRow | null>(null)
  const search = useDebounced(searchText.trim(), SEARCH_DELAY_MS)

  const categories = useQuery(referenceQuery('categories'))

  const query = useInfiniteQuery({
    queryKey: ['products', { search, categoryId, archived }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (pageParam) params.set('cursor', pageParam)
      if (search) params.set('search', search)
      if (categoryId) params.set('categoryId', categoryId)
      if (archived) params.set('archived', 'true')
      return api(productPageSchema, 'GET', `/products?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    // The old results stay visible while a new search runs, so the table never flashes.
    placeholderData: keepPreviousData,
  })

  const products = query.data?.pages.flatMap((page) => page.items) ?? []
  const total = query.data?.pages[0]?.total ?? 0

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const exportFile = useMutation({
    mutationFn: async () => {
      const stamp = new Date().toISOString().slice(0, 10)
      const destination = await desktop().chooseSpreadsheetDestination(`items-${stamp}.xlsx`)
      if (!destination) return null
      return api(fileSavedSchema, 'POST', '/catalog/export', {
        body: { destination, locale: preferences.locale },
      })
    },
    onSuccess: (saved) => {
      if (saved) toast.success(t('products.exported', { count: saved.rows }))
    },
    onError: report,
  })

  const filtered = Boolean(search || categoryId || archived)

  return (
    <div className="flex h-full flex-col gap-4">
      <Sign
        title={t('nav.products.label')}
        secondary={t('nav.products.other')}
        actions={
          <>
            {canImport && (
              <Menu
                trigger={
                  <Button variant="secondary" loading={exportFile.isPending}>
                    <FileUp aria-hidden className="size-4" />
                    {t('products.file')}
                  </Button>
                }
              >
                <MenuItem onSelect={() => setImporting(true)}>
                  <FileUp aria-hidden />
                  {t('products.import')}
                </MenuItem>
                <MenuItem onSelect={() => exportFile.mutate()}>
                  <FileDown aria-hidden />
                  {t('products.export')}
                </MenuItem>
              </Menu>
            )}
            {canManage && (
              <Link to="/products/new">
                <Button tabIndex={-1}>
                  <Plus aria-hidden className="size-4" />
                  {t('products.add')}
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-72 flex-1">
          <Search aria-hidden className="absolute start-3 top-3 size-4 text-ink-faint" />
          <Input
            type="search"
            aria-label={t('products.search')}
            placeholder={t('products.search')}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="ps-9"
            autoFocus
          />
        </div>
        <Select
          aria-label={t('products.category')}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="w-56"
        >
          <option value="">{t('products.allCategories')}</option>
          {categories.data?.items.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <label className="flex cursor-pointer items-center gap-2 text-ink-soft">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
            className="size-4 accent-route"
          />
          {t('products.showArchived')}
        </label>
        {query.data && (
          <Badge className="ms-auto">{t('products.total', { value: format.number(total) })}</Badge>
        )}
      </div>

      {query.isPending ? (
        <TableSkeleton columns={6} rows={10} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : products.length === 0 ? (
        filtered ? (
          <EmptyState title={t('products.noMatchTitle')} body={t('products.noMatchBody')} />
        ) : (
          <EmptyState
            title={t('products.emptyTitle')}
            body={t('products.emptyBody')}
            action={
              canImport && (
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  <FileUp aria-hidden className="size-4" />
                  {t('products.import')}
                </Button>
              )
            }
          />
        )
      ) : (
        <VirtualRows
          items={products}
          rowHeight={ROW_HEIGHT}
          onNearEnd={loadMore}
          header={
            <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
              <span role="columnheader">{t('products.name')}</span>
              <span role="columnheader">{t('products.sku')}</span>
              <span role="columnheader">{t('products.barcode')}</span>
              <span role="columnheader">{t('products.category')}</span>
              <span role="columnheader" className="text-end">
                {t('products.onHand')}
              </span>
              <span role="columnheader" className="text-end">
                {t('products.price')}
              </span>
              <span role="columnheader" className="sr-only">
                {t('common.edit')}
              </span>
            </div>
          }
          renderRow={(product) => <ProductRowView product={product} onLabels={setLabelsFor} />}
        />
      )}

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {labelsFor && <LabelsDialog product={labelsFor} onClose={() => setLabelsFor(null)} />}
    </div>
  )
}

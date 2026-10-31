import { productStockSchema, stockMovementPageSchema, type StockMovement } from '@inv/contracts'
import { Badge, Sign, Skeleton, Table, TableSkeleton, Td, Th, Tr } from '@inv/ui'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, QueryBoundary } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'

const ROW_HEIGHT = 48
const PAGE_SIZE = 50
const COLUMNS = 'grid grid-cols-[11rem_minmax(8rem,1fr)_8rem_7rem_8rem_8rem] items-center gap-3 px-4'

function MovementRow({ movement }: { movement: StockMovement }) {
  const { t } = useTranslation()
  const format = useFormat()
  const incoming = movement.qtyMilli > 0

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule text-sm hover:bg-ground`}>
      <div role="cell" className="tabular truncate text-ink-soft">
        {format.dateTime(movement.occurredAt)}
      </div>
      <div role="cell" className="truncate">
        <Link to="/stock/$id" params={{ id: movement.documentId }} className="text-ink hover:text-route">
          {t(`stock.kinds.${movement.documentKind}`)} <bdi dir="ltr">{movement.documentNumber}</bdi>
        </Link>
        {movement.reversal && (
          <Badge tone="warn" className="ms-2">
            {t('stock.reversal')}
          </Badge>
        )}
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {movement.warehouseName === 'main' ? t('reference.warehouses.main') : movement.warehouseName}
      </div>
      <div role="cell" className="truncate text-ink-soft">
        <bdi dir="ltr">{movement.lotNo}</bdi>
      </div>
      <div role="cell" className={`tabular text-end font-medium ${incoming ? 'text-ok' : 'text-danger'}`}>
        <bdi dir="ltr">
          {incoming ? '+' : ''}
          {format.quantity(movement.qtyMilli)}
        </bdi>
      </div>
      <div role="cell" className="tabular text-end text-ink-soft">
        <bdi dir="ltr">{format.money(movement.valueMinor)}</bdi>
      </div>
    </div>
  )
}

export function ProductStockPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const { id } = useParams({ strict: false })

  const stock = useQuery({
    queryKey: ['stock', 'product', id],
    queryFn: () => api(productStockSchema, 'GET', `/products/${id}/stock`),
  })

  const movements = useInfiniteQuery({
    queryKey: ['stock', 'movements', id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return api(stockMovementPageSchema, 'GET', `/products/${id}/movements?limit=${PAGE_SIZE}${cursor}`)
    },
    getNextPageParam: (page) => page.nextCursor,
  })

  const rows = movements.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = movements
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex h-full flex-col gap-6">
      <Sign title={stock.data?.productName ?? <Skeleton className="h-7 w-52" />} secondary={t('products.stock')} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('stock.balancesTitle')}</h2>
        <QueryBoundary query={stock} skeleton={<TableSkeleton columns={4} rows={2} />}>
          {(data) => {
            const balances = data.variants.flatMap((variant) =>
              variant.balances.map((balance) => ({ variant, balance })),
            )
            if (balances.length === 0) return <p className="text-ink-soft">{t('stock.noStock')}</p>
            const multiple = data.variants.length > 1

            return (
              <>
                <Table>
                  <thead>
                    <tr>
                      {multiple && <Th>{t('stock.item')}</Th>}
                      <Th>{t('stock.warehouse')}</Th>
                      <Th>{t('stock.lot')}</Th>
                      <Th>{t('stock.expiry')}</Th>
                      <Th className="text-end">{t('stock.quantity')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map(({ variant, balance }) => (
                      <Tr key={`${variant.variantId}-${balance.warehouseId}-${balance.lotId ?? ''}`}>
                        {multiple && <Td>{variant.label}</Td>}
                        <Td>{balance.warehouseName === 'main' ? t('reference.warehouses.main') : balance.warehouseName}</Td>
                        <Td>
                          {balance.lotNo ? <bdi dir="ltr">{balance.lotNo}</bdi> : <span className="text-ink-faint">{t('stock.noLot')}</span>}
                        </Td>
                        <Td className="tabular">{balance.expiryDate}</Td>
                        <Td className="tabular text-end font-medium">{format.quantity(balance.qtyMilli)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <dl className="flex flex-wrap gap-x-8 gap-y-1 pt-1">
                  {data.variants.map((variant) => (
                    <div key={variant.variantId} className="flex gap-2 text-sm">
                      {multiple && <dt className="font-medium text-ink">{variant.label}</dt>}
                      <dd className="text-ink-soft">
                        {t('stock.value')}: <span className="tabular text-ink">{format.money(variant.valueMinor)}</span>
                      </dd>
                      <dd className="text-ink-soft">
                        {t('stock.averageCost')}: <span className="tabular text-ink">{format.money(variant.averageCostMinor)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )
          }}
        </QueryBoundary>
      </section>

      <section className="flex min-h-64 flex-1 flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('stock.movementsTitle')}</h2>
        {movements.isPending ? (
          <TableSkeleton columns={5} rows={5} />
        ) : movements.isError ? (
          <ErrorState error={movements.error} onRetry={() => void movements.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('stock.noMovements')} />
        ) : (
          <VirtualRows
            items={rows}
            rowHeight={ROW_HEIGHT}
            onNearEnd={loadMore}
            header={
              <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
                <span role="columnheader">{t('stock.time')}</span>
                <span role="columnheader">{t('stock.document')}</span>
                <span role="columnheader">{t('stock.warehouse')}</span>
                <span role="columnheader">{t('stock.lot')}</span>
                <span role="columnheader" className="text-end">
                  {t('stock.quantity')}
                </span>
                <span role="columnheader" className="text-end">
                  {t('stock.value')}
                </span>
              </div>
            }
            renderRow={(movement) => <MovementRow movement={movement} />}
          />
        )}
      </section>
    </div>
  )
}

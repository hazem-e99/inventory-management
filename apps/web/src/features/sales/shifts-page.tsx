import { shiftPageSchema, type ShiftRow, type ShiftSummary } from '@inv/contracts'
import { Badge, Button, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Banknote, DoorClosed } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, QueryBoundary } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'
import { useActor, useCan } from '../../lib/session'
import { currentShiftQuery } from './queries'
import { CashDialog, CloseShiftDialog, OpenShiftForm } from './shift-panels'

const ROW_HEIGHT = 52
const PAGE_SIZE = 50
const COLUMNS = 'grid grid-cols-[8rem_minmax(8rem,1fr)_11rem_7rem_7rem_7rem] items-center gap-3 px-4'

function ShiftRowView({ shift }: { shift: ShiftRow }) {
  const { t } = useTranslation()
  const format = useFormat()
  const difference = shift.differenceMinor

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule hover:bg-ground`}>
      <div role="cell" className="truncate">
        <Link to="/shifts/$id" params={{ id: shift.id }} className="font-medium text-ink hover:text-route">
          <bdi dir="ltr">{shift.number}</bdi>
        </Link>
      </div>
      <div role="cell" className="truncate text-ink-soft">
        {shift.userName}
      </div>
      <div role="cell" className="tabular truncate text-sm text-ink-soft">
        {format.dateTime(shift.openedAt)}
      </div>
      <div role="cell">
        <Badge tone={shift.status === 'open' ? 'ok' : 'neutral'}>{t(`shifts.statuses.${shift.status}`)}</Badge>
      </div>
      <div role="cell" className="tabular text-end text-ink">
        {shift.countedCashMinor === null ? '-' : format.money(shift.countedCashMinor)}
      </div>
      <div role="cell" className={`tabular text-end font-medium ${difference ? 'text-danger' : 'text-ink-soft'}`}>
        {difference === null ? '-' : <bdi dir="ltr">{format.money(difference)}</bdi>}
      </div>
    </div>
  )
}

function CurrentShift({ shift }: { shift: ShiftSummary }) {
  const { t } = useTranslation()
  const format = useFormat()
  const navigate = useNavigate()
  const actor = useActor()
  const canManage = useCan('shifts.manage')
  const [panel, setPanel] = useState<'cash' | 'close' | null>(null)
  const mine = shift.userId === actor.id

  const fact = (label: string, value: string) => (
    <div>
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="tabular text-lg font-semibold text-ink">{value}</dd>
    </div>
  )

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-rule bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">
          {t('shifts.current')}{' '}
          <Link to="/shifts/$id" params={{ id: shift.id }} className="text-route hover:underline">
            <bdi dir="ltr">{shift.number}</bdi>
          </Link>
          <span className="ms-3 text-base font-normal text-ink-soft">{shift.userName}</span>
        </h2>
        <div className="flex gap-2">
          {mine && (
            <Button variant="secondary" onClick={() => setPanel('cash')}>
              <Banknote aria-hidden className="size-4" />
              {t('shifts.cashTitle')}
            </Button>
          )}
          {(mine || canManage) && (
            <Button variant="danger" onClick={() => setPanel('close')}>
              <DoorClosed aria-hidden className="size-4" />
              {t('shifts.close')}
            </Button>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-4 gap-4">
        {fact(t('shifts.salesCount'), format.number(shift.salesCount))}
        {fact(t('shifts.salesTotal'), format.money(shift.salesMinor))}
        {fact(t('shifts.returnsTotal'), format.money(shift.returnsMinor))}
        {fact(t('shifts.openingCash'), format.money(shift.openingCashMinor))}
      </dl>

      {panel === 'cash' && <CashDialog onClose={() => setPanel(null)} />}
      {panel === 'close' && (
        <CloseShiftDialog
          shift={shift}
          onClose={() => setPanel(null)}
          onClosed={(closed) => void navigate({ to: '/shifts/$id', params: { id: closed.id } })}
        />
      )}
    </section>
  )
}

export function ShiftsPage() {
  const { t } = useTranslation()
  const canSell = useCan('sales.sell')
  const current = useQuery(currentShiftQuery)

  const query = useInfiniteQuery({
    queryKey: ['shifts', 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return api(shiftPageSchema, 'GET', `/shifts?limit=${PAGE_SIZE}${cursor}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  })

  const shifts = query.data?.pages.flatMap((page) => page.items).filter(({ status }) => status === 'closed') ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex h-full flex-col gap-5">
      <Sign title={t('nav.shifts.label')} secondary={t('nav.shifts.other')} />

      <QueryBoundary query={current} skeleton={<TableSkeleton columns={4} rows={2} />}>
        {({ shift }) =>
          shift ? (
            <CurrentShift shift={shift} />
          ) : canSell ? (
            <OpenShiftForm />
          ) : (
            <EmptyState title={t('shifts.noneOpen')} body={t('shifts.noneOpenBody')} />
          )
        }
      </QueryBoundary>

      <section className="flex min-h-64 flex-1 flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('shifts.history')}</h2>
        {query.isPending ? (
          <TableSkeleton columns={6} rows={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : shifts.length === 0 ? (
          <EmptyState title={t('shifts.emptyTitle')} />
        ) : (
          <VirtualRows
            items={shifts}
            rowHeight={ROW_HEIGHT}
            onNearEnd={loadMore}
            header={
              <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
                <span role="columnheader">{t('shifts.number')}</span>
                <span role="columnheader">{t('shifts.cashier')}</span>
                <span role="columnheader">{t('shifts.openedAt')}</span>
                <span role="columnheader">{t('shifts.status')}</span>
                <span role="columnheader" className="text-end">
                  {t('shifts.counted')}
                </span>
                <span role="columnheader" className="text-end">
                  {t('shifts.difference')}
                </span>
              </div>
            }
            renderRow={(shift) => <ShiftRowView shift={shift} />}
          />
        )}
      </section>
    </div>
  )
}

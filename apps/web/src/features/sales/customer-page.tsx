import {
  RECEIPT_METHODS,
  customerStatementSchema,
  okSchema,
  receiptInputSchema,
  receiptSchema,
  type Customer,
  type CustomerEntry,
} from '@inv/contracts'
import { parseMoney } from '@inv/domain'
import { Badge, Button, Dialog, Sign, Skeleton, TableSkeleton } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Banknote, Pencil } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SelectField, TextField } from '../../components/form'
import { EmptyState, ErrorState, QueryBoundary } from '../../components/states'
import { VirtualRows } from '../../components/virtual-rows'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { CustomerDialog } from './customer-dialog'
import { customerQuery, useCustomerBalanceLabel } from './queries'

const ROW_HEIGHT = 48
const PAGE_SIZE = 50
const COLUMNS = 'grid grid-cols-[11rem_minmax(10rem,1fr)_8rem_8rem_8rem] items-center gap-3 px-4'

const collectFormSchema = z.object({
  amount: z.string().refine((value) => (parseMoney(value) ?? 0) > 0, 'PRICE_INVALID'),
  method: z.enum(RECEIPT_METHODS),
  reference: z.string(),
})

type CollectValues = z.infer<typeof collectFormSchema>

function CollectDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<CollectValues>({
    resolver: zodResolver(collectFormSchema),
    defaultValues: { amount: '', method: 'cash', reference: '' },
  })
  const report = useReportError(form, (path) => (path === 'amountMinor' ? 'amount' : path))

  const collect = useMutation({
    mutationFn: ({ amount, ...values }: CollectValues) =>
      api(receiptSchema, 'POST', `/customers/${customer.id}/receipts`, {
        body: receiptInputSchema.parse({ ...values, amountMinor: parseMoney(amount) }),
      }),
    onSuccess: async (receipt) => {
      toast.success(t('customers.collected', { number: receipt.number }))
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      await queryClient.invalidateQueries({ queryKey: ['shifts'] })
      onClose()
    },
    onError: report,
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('customers.collect')}
      description={t('customers.collectBody')}
      closeLabel={t('common.close')}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit((values) => collect.mutate(values))(event)
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <TextField form={form} name="amount" label={t('customers.collectAmount')} dir="ltr" inputMode="decimal" autoFocus />
          <SelectField form={form} name="method" label={t('customers.collectMethod')}>
            {RECEIPT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`pos.methods.${method}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField form={form} name="reference" label={`${t('customers.collectReference')} (${t('common.optional')})`} dir="ltr" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={collect.isPending}>
            {t('customers.collect')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function EntryRow({ entry, onVoid }: { entry: CustomerEntry; onVoid: (() => void) | null }) {
  const { t } = useTranslation()
  const format = useFormat()
  const label = (
    <>
      {t(`customers.sources.${entry.source}`)} <bdi dir="ltr">{entry.documentNumber}</bdi>
    </>
  )

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule text-sm hover:bg-ground`}>
      <div role="cell" className="tabular truncate text-ink-soft">
        {format.dateTime(entry.occurredAt)}
      </div>
      <div role="cell" className="flex min-w-0 items-center gap-2 truncate">
        {entry.source === 'sale' || entry.source === 'sale_return' ? (
          <Link to="/sales/$id" params={{ id: entry.documentId }} className="text-ink hover:text-route">
            {label}
          </Link>
        ) : (
          <span className="text-ink">{label}</span>
        )}
        {entry.reversal && <Badge tone="warn">{t('customers.reversal')}</Badge>}
      </div>
      <div role="cell" className="tabular text-end font-medium text-ink">
        <bdi dir="ltr">
          {entry.amountMinor > 0 ? '+' : ''}
          {format.money(entry.amountMinor)}
        </bdi>
      </div>
      <div role="cell" className="tabular text-end text-ink-soft">
        <bdi dir="ltr">{format.money(entry.balanceMinor)}</bdi>
      </div>
      <div role="cell" className="text-end">
        {onVoid && (
          <Button variant="ghost" size="sm" onClick={onVoid}>
            {t('customers.voidReceipt')}
          </Button>
        )}
      </div>
    </div>
  )
}

function CustomerHeader({ customer, onCollect, onEdit }: { customer: Customer; onCollect: () => void; onEdit: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const balanceLabel = useCustomerBalanceLabel()
  const canManage = useCan('customers.manage')
  const canCollect = useCan('customers.collect')

  const archive = useMutation({
    mutationFn: () => api(okSchema, 'POST', `/customers/${customer.id}/${customer.archived ? 'restore' : 'archive'}`),
    onSuccess: async () => {
      toast.success(t(customer.archived ? 'customers.restored' : 'customers.archived'))
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: report,
  })

  return (
    <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-rule bg-surface px-5 py-4">
      <div>
        <p className="text-sm text-ink-soft">{balanceLabel(customer.balanceMinor)}</p>
        <p className="tabular text-3xl font-semibold text-ink">{format.money(Math.abs(customer.balanceMinor))}</p>
        <p className="mt-1 flex gap-4 text-sm text-ink-soft">
          {customer.phone && <bdi dir="ltr">{customer.phone}</bdi>}
          {customer.creditLimitMinor !== null && (
            <span>
              {t('customers.creditLimit')}: <span className="tabular">{format.money(customer.creditLimitMinor)}</span>
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <>
            <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate()}>
              {customer.archived ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
              {t(customer.archived ? 'customers.restore' : 'customers.archive')}
            </Button>
            <Button variant="secondary" onClick={onEdit}>
              <Pencil aria-hidden className="size-4" />
              {t('customers.edit')}
            </Button>
          </>
        )}
        {canCollect && !customer.archived && (
          <Button onClick={onCollect}>
            <Banknote aria-hidden className="size-4" />
            {t('customers.collect')}
          </Button>
        )}
      </div>
    </section>
  )
}

export function CustomerPage() {
  const { t } = useTranslation()
  const { id } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const report = useReportError()
  const canCollect = useCan('customers.collect')
  const [panel, setPanel] = useState<'collect' | 'edit' | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)

  const customer = useQuery(customerQuery(id!))

  const statement = useInfiniteQuery({
    queryKey: ['customers', id, 'statement'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return api(customerStatementSchema, 'GET', `/customers/${id}/statement?limit=${PAGE_SIZE}${cursor}`)
    },
    getNextPageParam: (page) => page.nextCursor,
  })

  const entries = statement.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = statement
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const reversed = new Set(entries.filter((entry) => entry.reversal).map((entry) => entry.documentId))

  const voidReceipt = useMutation({
    mutationFn: (receiptId: string) => api(okSchema, 'POST', `/customer-receipts/${receiptId}/void`),
    onSuccess: async () => {
      toast.success(t('customers.receiptVoided'))
      setVoiding(null)
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      await queryClient.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (error) => {
      setVoiding(null)
      report(error)
    },
  })

  return (
    <div className="flex h-full flex-col gap-5">
      <Sign title={customer.data?.name ?? <Skeleton className="h-7 w-52" />} secondary={t('nav.customers.label')} />

      <QueryBoundary query={customer} skeleton={<TableSkeleton columns={2} rows={2} />}>
        {(data) => (
          <>
            <CustomerHeader customer={data} onCollect={() => setPanel('collect')} onEdit={() => setPanel('edit')} />
            {panel === 'collect' && <CollectDialog customer={data} onClose={() => setPanel(null)} />}
            {panel === 'edit' && <CustomerDialog customer={data} onClose={() => setPanel(null)} />}
          </>
        )}
      </QueryBoundary>

      <section className="flex min-h-64 flex-1 flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('customers.statement')}</h2>
        {statement.isPending ? (
          <TableSkeleton columns={5} rows={5} />
        ) : statement.isError ? (
          <ErrorState error={statement.error} onRetry={() => void statement.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState title={t('customers.statementEmpty')} />
        ) : (
          <VirtualRows
            items={entries}
            rowHeight={ROW_HEIGHT}
            onNearEnd={loadMore}
            header={
              <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
                <span role="columnheader">{t('customers.time')}</span>
                <span role="columnheader">{t('customers.document')}</span>
                <span role="columnheader" className="text-end">
                  {t('customers.amount')}
                </span>
                <span role="columnheader" className="text-end">
                  {t('customers.runningBalance')}
                </span>
                <span role="columnheader" aria-label={t('customers.voidReceipt')} />
              </div>
            }
            renderRow={(entry) => (
              <EntryRow
                entry={entry}
                onVoid={
                  canCollect && entry.source === 'receipt' && !entry.reversal && !reversed.has(entry.documentId)
                    ? () => setVoiding(entry.documentId)
                    : null
                }
              />
            )}
          />
        )}
      </section>

      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null)
        }}
        title={t('customers.voidReceiptTitle')}
        description={t('customers.voidReceiptBody')}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setVoiding(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={voidReceipt.isPending} onClick={() => voidReceipt.mutate(voiding!)}>
            {t('customers.voidReceipt')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

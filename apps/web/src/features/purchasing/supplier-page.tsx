import {
  PAYMENT_METHODS,
  okSchema,
  paymentInputSchema,
  paymentSchema,
  statementPageSchema,
  type StatementEntry,
  type Supplier,
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
import { supplierQuery } from './queries'
import { SupplierDialog } from './supplier-dialog'
import { useBalanceLabel } from './suppliers-page'

const ROW_HEIGHT = 48
const PAGE_SIZE = 50
const COLUMNS = 'grid grid-cols-[11rem_minmax(10rem,1fr)_8rem_8rem_8rem] items-center gap-3 px-4'

const paymentFormSchema = z.object({
  amount: z.string().refine((value) => (parseMoney(value) ?? 0) > 0, 'PRICE_INVALID'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string(),
  notes: z.string(),
})

type PaymentValues = z.infer<typeof paymentFormSchema>

function PayDialog({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<PaymentValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: { amount: '', method: 'cash', reference: '', notes: '' },
  })
  const report = useReportError(form, (path) => (path === 'amountMinor' ? 'amount' : path))

  const pay = useMutation({
    mutationFn: ({ amount, ...values }: PaymentValues) =>
      api(paymentSchema, 'POST', `/suppliers/${supplier.id}/payments`, {
        body: paymentInputSchema.parse({ ...values, amountMinor: parseMoney(amount) }),
      }),
    onSuccess: async (payment) => {
      toast.success(t('suppliers.paid', { number: payment.number }))
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] })
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
      title={t('suppliers.pay')}
      description={t('suppliers.payBody')}
      closeLabel={t('common.close')}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit((values) => pay.mutate(values))(event)
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <TextField form={form} name="amount" label={t('suppliers.payAmount')} dir="ltr" inputMode="decimal" autoFocus />
          <SelectField form={form} name="method" label={t('suppliers.payMethod')}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`suppliers.methods.${method}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField
          form={form}
          name="reference"
          label={`${t('suppliers.payReference')} (${t('common.optional')})`}
          hint={t('suppliers.payReferenceHint')}
          dir="ltr"
        />
        <TextField form={form} name="notes" label={`${t('suppliers.notes')} (${t('common.optional')})`} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={pay.isPending}>
            {t('suppliers.pay')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function EntryLabel({ entry }: { entry: StatementEntry }) {
  const { t } = useTranslation()
  const label = (
    <>
      {t(`suppliers.sources.${entry.source}`)} <bdi dir="ltr">{entry.documentNumber}</bdi>
    </>
  )

  const purchaseId = entry.source === 'payment' ? entry.purchaseId : entry.source === 'opening' ? null : entry.documentId
  if (!purchaseId) return <span className="text-ink">{label}</span>
  return (
    <Link to="/purchases/$id" params={{ id: purchaseId }} className="text-ink hover:text-route">
      {label}
    </Link>
  )
}

function StatementRow({ entry, onVoid }: { entry: StatementEntry; onVoid: (() => void) | null }) {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div role="row" className={`${COLUMNS} h-full border-b border-rule text-sm hover:bg-ground`}>
      <div role="cell" className="tabular truncate text-ink-soft">
        {format.dateTime(entry.occurredAt)}
      </div>
      <div role="cell" className="flex min-w-0 items-center gap-2 truncate">
        <EntryLabel entry={entry} />
        {entry.reversal && <Badge tone="warn">{t('suppliers.reversal')}</Badge>}
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
            {t('suppliers.voidPayment')}
          </Button>
        )}
      </div>
    </div>
  )
}

function SupplierHeader({ supplier, onPay, onEdit }: { supplier: Supplier; onPay: () => void; onEdit: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const balanceLabel = useBalanceLabel()
  const canManage = useCan('suppliers.manage')
  const canPay = useCan('suppliers.pay')

  const archive = useMutation({
    mutationFn: () => api(okSchema, 'POST', `/suppliers/${supplier.id}/${supplier.archived ? 'restore' : 'archive'}`),
    onSuccess: async () => {
      toast.success(t(supplier.archived ? 'suppliers.restored' : 'suppliers.archived'))
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] })
    },
    onError: report,
  })

  return (
    <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-rule bg-surface px-5 py-4">
      <div>
        <p className="text-sm text-ink-soft">{balanceLabel(supplier.balanceMinor)}</p>
        <p className="tabular text-3xl font-semibold text-ink">{format.money(Math.abs(supplier.balanceMinor))}</p>
        {supplier.phone && (
          <p className="mt-1 text-sm text-ink-soft">
            <bdi dir="ltr">{supplier.phone}</bdi>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <>
            <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate()}>
              {supplier.archived ? <ArchiveRestore aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
              {t(supplier.archived ? 'suppliers.restore' : 'suppliers.archive')}
            </Button>
            <Button variant="secondary" onClick={onEdit}>
              <Pencil aria-hidden className="size-4" />
              {t('suppliers.edit')}
            </Button>
          </>
        )}
        {canPay && !supplier.archived && (
          <Button onClick={onPay}>
            <Banknote aria-hidden className="size-4" />
            {t('suppliers.pay')}
          </Button>
        )}
      </div>
    </section>
  )
}

export function SupplierPage() {
  const { t } = useTranslation()
  const { id } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const report = useReportError()
  const canPay = useCan('suppliers.pay')
  const [panel, setPanel] = useState<'pay' | 'edit' | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)

  const supplier = useQuery(supplierQuery(id!))

  const statement = useInfiniteQuery({
    queryKey: ['suppliers', id, 'statement'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return api(statementPageSchema, 'GET', `/suppliers/${id}/statement?limit=${PAGE_SIZE}${cursor}`)
    },
    getNextPageParam: (page) => page.nextCursor,
  })

  const entries = statement.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = statement
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const reversed = new Set(entries.filter((entry) => entry.reversal).map((entry) => entry.documentId))

  const voidPayment = useMutation({
    mutationFn: (paymentId: string) => api(okSchema, 'POST', `/supplier-payments/${paymentId}/void`),
    onSuccess: async () => {
      toast.success(t('suppliers.paymentVoided'))
      setVoiding(null)
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] })
    },
    onError: (error) => {
      setVoiding(null)
      report(error)
    },
  })

  return (
    <div className="flex h-full flex-col gap-5">
      <Sign title={supplier.data?.name ?? <Skeleton className="h-7 w-52" />} secondary={t('nav.suppliers.label')} />

      <QueryBoundary query={supplier} skeleton={<TableSkeleton columns={2} rows={2} />}>
        {(data) => (
          <>
            <SupplierHeader supplier={data} onPay={() => setPanel('pay')} onEdit={() => setPanel('edit')} />
            {panel === 'pay' && <PayDialog supplier={data} onClose={() => setPanel(null)} />}
            {panel === 'edit' && <SupplierDialog supplier={data} onClose={() => setPanel(null)} />}
          </>
        )}
      </QueryBoundary>

      <section className="flex min-h-64 flex-1 flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('suppliers.statement')}</h2>
        {statement.isPending ? (
          <TableSkeleton columns={5} rows={5} />
        ) : statement.isError ? (
          <ErrorState error={statement.error} onRetry={() => void statement.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState title={t('suppliers.statementEmpty')} />
        ) : (
          <VirtualRows
            items={entries}
            rowHeight={ROW_HEIGHT}
            onNearEnd={loadMore}
            header={
              <div role="row" className={`${COLUMNS} border-b border-rule bg-sunken py-2.5 text-sm font-medium text-ink-soft`}>
                <span role="columnheader">{t('suppliers.time')}</span>
                <span role="columnheader">{t('suppliers.document')}</span>
                <span role="columnheader" className="text-end">
                  {t('suppliers.amount')}
                </span>
                <span role="columnheader" className="text-end">
                  {t('suppliers.runningBalance')}
                </span>
                <span role="columnheader" aria-label={t('suppliers.voidPayment')} />
              </div>
            }
            renderRow={(entry) => (
              <StatementRow
                entry={entry}
                onVoid={
                  canPay && entry.source === 'payment' && !entry.purchaseId && !entry.reversal && !reversed.has(entry.documentId)
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
        title={t('suppliers.voidPaymentTitle')}
        description={t('suppliers.voidPaymentBody')}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setVoiding(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={voidPayment.isPending} onClick={() => voidPayment.mutate(voiding!)}>
            {t('suppliers.voidPayment')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

import { TENDER_METHODS, returnInputSchema, saleSchema, type Sale, type TenderMethod } from '@inv/contracts'
import { parseQuantity, returnShare } from '@inv/domain'
import { Button, Dialog, Field, FormSkeleton, Input, Select, Sign, Table, Td, Th, Tr } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { usePrinter } from './receipt'

interface LineDraft {
  qty: string
  serials: string
}

const splitSerials = (text: string) =>
  text
    .split(/[\n,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean)

function ReturnForm({ sale }: { sale: Sale }) {
  const { t } = useTranslation()
  const format = useFormat()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const report = useReportError()
  const printer = usePrinter()
  const methodId = useId()
  const reasonId = useId()
  const requestId = useRef(crypto.randomUUID())
  const onAccount = sale.payments.some(({ method }) => method === 'credit')
  const [method, setMethod] = useState<TenderMethod>(onAccount ? 'credit' : 'cash')
  const [reason, setReason] = useState('')
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [confirming, setConfirming] = useState(false)

  const open = sale.lines.filter((line) => line.returnedBaseMilli < line.baseQtyMilli)

  const chosen = open.flatMap((line) => {
    const qtyMilli = parseQuantity(drafts[line.id]?.qty ?? '') ?? 0
    if (qtyMilli <= 0) return []
    const baseQty = Math.round((qtyMilli * line.baseQtyMilli) / line.qtyMilli)
    const within = line.returnedBaseMilli + baseQty <= line.baseQtyMilli
    const refund = within ? returnShare(line.totalMinor, line.refundedMinor, line.baseQtyMilli, line.returnedBaseMilli, baseQty) : 0
    return [{ line, qtyMilli, refund, serials: splitSerials(drafts[line.id]?.serials ?? '') }]
  })
  const refund = chosen.reduce((sum, { refund: amount }) => sum + amount, 0)

  const post = useMutation({
    mutationFn: () =>
      api(saleSchema, 'POST', `/sales/${sale.id}/return`, {
        body: returnInputSchema.parse({
          requestId: requestId.current,
          method,
          reason,
          lines: chosen.map(({ line, qtyMilli, serials }) => ({ saleLineId: line.id, qtyMilli, serials })),
        }),
      }),
    onSuccess: async (returned) => {
      toast.success(t('sales.returnDone', { number: returned.number }))
      await Promise.all(['sales', 'shifts', 'stock', 'products', 'customers'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
      if (printer.autoPrint) await printer.printSale(returned)
      await navigate({ to: '/sales/$id', params: { id: returned.id } })
    },
    onError: (error) => {
      setConfirming(false)
      report(error)
    },
  })

  if (open.length === 0) return <p className="text-ink-soft">{t('sales.allReturned')}</p>

  const setDraft = (id: string, changes: Partial<LineDraft>) =>
    setDrafts((current) => ({ ...current, [id]: { qty: '', serials: '', ...current[id], ...changes } }))

  return (
    <div className="flex flex-col gap-5">
      <Table>
        <thead>
          <tr>
            <Th>{t('sales.item')}</Th>
            <Th>{t('sales.sold')}</Th>
            <Th>{t('sales.alreadyReturned')}</Th>
            <Th>{t('sales.returnQty')}</Th>
          </tr>
        </thead>
        <tbody>
          {open.map((line) => (
            <Tr key={line.id}>
              <Td>
                <p className="font-medium text-ink">
                  {line.itemName}
                  {line.variantLabel ? ` - ${line.variantLabel}` : ''}
                </p>
                {line.serials.length > 0 && (
                  <label className="mt-1 flex flex-col gap-1 text-sm text-ink-soft">
                    {t('sales.returnSerials')}
                    <textarea
                      dir="ltr"
                      rows={2}
                      className="w-full rounded-md border border-rule-strong bg-surface px-3 py-1.5 text-ink"
                      value={drafts[line.id]?.serials ?? ''}
                      onChange={(event) => setDraft(line.id, { serials: event.target.value })}
                    />
                  </label>
                )}
              </Td>
              <Td className="tabular">{format.quantity(line.qtyMilli)}</Td>
              <Td className="tabular">{format.quantity(line.returnedBaseMilli)}</Td>
              <Td className="w-32">
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  aria-label={`${t('sales.returnQty')} ${line.itemName}`}
                  value={drafts[line.id]?.qty ?? ''}
                  onChange={(event) => setDraft(line.id, { qty: event.target.value })}
                />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <Field id={methodId} label={t('sales.refundMethod')}>
          <Select id={methodId} value={method} onChange={(event) => setMethod(event.target.value as TenderMethod)}>
            {TENDER_METHODS.filter((value) => value !== 'credit' || sale.customerId).map((value) => (
              <option key={value} value={value}>
                {t(`pos.methods.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={reasonId} label={`${t('sales.reason')} (${t('common.optional')})`}>
          <Input id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-rule pt-4">
        <p className="text-lg text-ink-soft">
          {t('sales.refund')}: <span className="tabular font-semibold text-ink">{format.money(refund)}</span>
        </p>
        <Button size="lg" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
          {t('sales.postReturn')}
        </Button>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('sales.returnConfirmTitle')}
        description={t('sales.returnConfirmBody')}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
          <Button loading={post.isPending} onClick={() => post.mutate()}>
            {t('sales.postReturn')}
          </Button>
        </div>
      </Dialog>

      {printer.sheet}
    </div>
  )
}

export function ReturnPage() {
  const { t } = useTranslation()
  const { id } = useParams({ strict: false })

  const sale = useQuery({
    queryKey: ['sales', id],
    queryFn: () => api(saleSchema, 'GET', `/sales/${id}`),
  })

  return (
    <div className="flex flex-col gap-5">
      <Sign title={sale.data ? t('sales.returnTitle', { number: sale.data.number }) : t('sales.newReturn')} secondary={t('nav.sales.label')} />
      <QueryBoundary query={sale} skeleton={<FormSkeleton fields={3} />}>
        {(data) => <ReturnForm sale={data} />}
      </QueryBoundary>
    </div>
  )
}

import { saleSchema, type Sale } from '@inv/contracts'
import { Badge, Button, Dialog, FormSkeleton, Sign, Table, Td, Th, Tr } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { FileText, Printer, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { SALE_STATUS_TONE } from './queries'
import { usePrinter } from './receipt'

function SaleDetails({ sale }: { sale: Sale }) {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const printer = usePrinter()
  const canReturn = useCan('sales.return')
  const canVoid = useCan('sales.void')
  const [voiding, setVoiding] = useState(false)

  const voidSale = useMutation({
    mutationFn: () => api(saleSchema, 'POST', `/sales/${sale.id}/void`),
    onSuccess: async () => {
      toast.success(t('sales.voided'))
      setVoiding(false)
      await Promise.all(['sales', 'shifts', 'stock', 'products', 'customers'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    },
    onError: (error) => {
      setVoiding(false)
      report(error)
    },
  })

  const posted = sale.status === 'posted'
  const returnable = posted && sale.kind === 'sale' && sale.lines.some((line) => line.returnedBaseMilli < line.baseQtyMilli)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-ink-soft">
          <Badge tone={SALE_STATUS_TONE[sale.status]}>{t(`sales.statuses.${sale.status}`)}</Badge>
          <span>
            {t('sales.date')}: <span className="tabular text-ink">{format.dateTime(sale.createdAt)}</span>
          </span>
          <span>
            {t('sales.customer')}:{' '}
            {sale.customerId ? (
              <Link to="/customers/$id" params={{ id: sale.customerId }} className="text-route hover:underline">
                {sale.customerName}
              </Link>
            ) : (
              <span className="text-ink">{t('sales.walkIn')}</span>
            )}
          </span>
          {sale.cashierName && (
            <span>
              {t('sales.cashier')}: <span className="text-ink">{sale.cashierName}</span>
            </span>
          )}
          {sale.returnOfId && (
            <span>
              {t('sales.returnOf')}:{' '}
              <Link to="/sales/$id" params={{ id: sale.returnOfId }} className="text-route hover:underline">
                <bdi dir="ltr">{sale.returnOfNumber}</bdi>
              </Link>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {posted && canVoid && (
            <Button variant="danger" onClick={() => setVoiding(true)}>
              {t('sales.void')}
            </Button>
          )}
          {returnable && canReturn && (
            <Link to="/sales/$id/return" params={{ id: sale.id }}>
              <Button variant="secondary" tabIndex={-1}>
                <Undo2 aria-hidden className="size-4" />
                {t('sales.newReturn')}
              </Button>
            </Link>
          )}
          <Button variant="secondary" onClick={() => void printer.printSale(sale, 'a4')}>
            <FileText aria-hidden className="size-4" />
            {t('sales.printInvoice')}
          </Button>
          <Button onClick={() => void printer.printSale(sale)}>
            <Printer aria-hidden className="size-4" />
            {t('sales.printReceipt')}
          </Button>
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>{t('sales.item')}</Th>
            <Th>{t('sales.quantity')}</Th>
            <Th>{t('sales.price')}</Th>
            <Th>{t('sales.discount')}</Th>
            <Th>{t('sales.batches')}</Th>
            <Th className="text-end">{t('sales.lineTotal')}</Th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <Tr key={line.id}>
              <Td>
                <p className="font-medium text-ink">
                  {line.itemName}
                  {line.variantLabel ? ` - ${line.variantLabel}` : ''}
                </p>
                {line.serials.length > 0 && (
                  <p dir="ltr" className="text-start text-sm text-ink-faint">
                    {line.serials.join(', ')}
                  </p>
                )}
                {line.returnedBaseMilli > 0 && (
                  <p className="text-sm text-warn">
                    {t('sales.returned')}: {format.quantity(line.returnedBaseMilli)}
                  </p>
                )}
              </Td>
              <Td className="tabular">{format.quantity(line.qtyMilli)}</Td>
              <Td className="tabular">{format.money(line.unitPriceMinor)}</Td>
              <Td className="tabular">{format.money(line.discountMinor)}</Td>
              <Td>
                {line.lots
                  .filter(({ lotNo }) => lotNo)
                  .map(({ lotNo, qtyMilli }) => (
                    <p key={lotNo} className="tabular text-sm text-ink-soft">
                      <bdi dir="ltr">{lotNo}</bdi> ({format.quantity(qtyMilli)})
                    </p>
                  ))}
              </Td>
              <Td className="tabular text-end font-medium">{format.money(line.totalMinor)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <div className="grid grid-cols-2 gap-6">
        <section className="flex flex-col gap-1.5 rounded-lg border border-rule bg-surface px-4 py-3">
          <h2 className="font-semibold text-ink">{t('sales.payments')}</h2>
          {sale.payments.map((payment) => (
            <p key={payment.id} className="flex justify-between text-ink-soft">
              <span>
                {t(`pos.methods.${payment.method}`)}
                {payment.reversal && ` (${t('customers.reversal')})`}
              </span>
              <bdi dir="ltr" className="tabular">
                {format.money(payment.amountMinor)}
              </bdi>
            </p>
          ))}
          {sale.changeMinor > 0 && (
            <p className="flex justify-between text-ink-soft">
              <span>{t('sales.change')}</span>
              <span className="tabular">{format.money(sale.changeMinor)}</span>
            </p>
          )}
        </section>
        <dl className="flex flex-col gap-1.5 rounded-lg border border-rule bg-surface px-4 py-3">
          <div className="flex justify-between text-ink-soft">
            <dt>{t('sales.gross')}</dt>
            <dd className="tabular">{format.money(sale.grossMinor)}</dd>
          </div>
          <div className="flex justify-between text-ink-soft">
            <dt>{t('sales.discount')}</dt>
            <dd className="tabular">{format.money(sale.discountMinor)}</dd>
          </div>
          <div className="flex justify-between text-ink-soft">
            <dt>{t('sales.tax')}</dt>
            <dd className="tabular">{format.money(sale.taxMinor)}</dd>
          </div>
          <div className="flex justify-between border-t border-rule pt-2 text-lg font-semibold text-ink">
            <dt>{t('sales.total')}</dt>
            <dd className="tabular">{format.money(sale.totalMinor)}</dd>
          </div>
        </dl>
      </div>

      <Dialog
        open={voiding}
        onOpenChange={setVoiding}
        title={t('sales.voidTitle')}
        description={t('sales.voidBody')}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setVoiding(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={voidSale.isPending} onClick={() => voidSale.mutate()}>
            {t('sales.void')}
          </Button>
        </div>
      </Dialog>

      {printer.sheet}
    </div>
  )
}

export function SalePage() {
  const { t } = useTranslation()
  const { id } = useParams({ strict: false })

  const sale = useQuery({
    queryKey: ['sales', id],
    queryFn: () => api(saleSchema, 'GET', `/sales/${id}`),
  })

  return (
    <div className="flex flex-col gap-5">
      <Sign
        title={sale.data ? `${t(`sales.kinds.${sale.data.kind}`)} ${sale.data.number}` : t('nav.sales.label')}
        secondary={t('nav.sales.label')}
      />
      <QueryBoundary query={sale} skeleton={<FormSkeleton fields={3} />}>
        {(data) => <SaleDetails sale={data} />}
      </QueryBoundary>
    </div>
  )
}

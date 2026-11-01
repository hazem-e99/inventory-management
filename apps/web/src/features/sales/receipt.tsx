import type { ReceiptPaper, Sale, ShiftSummary, Store } from '@inv/contracts'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { desktop } from '../../lib/desktop'
import { useErrorText } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { referenceQuery, useReferenceName } from '../catalog/queries'
import { settingsQuery } from '../settings/queries'

const ROLL_WIDTH_MM: Record<Exclude<ReceiptPaper, 'a4'>, number> = { '80mm': 80, '58mm': 58 }
const MM_PER_PX = 25.4 / 96

type Job = { type: 'sale'; sale: Sale; paper: ReceiptPaper } | { type: 'shift'; shift: ShiftSummary; paper: ReceiptPaper }

function Row({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? 'text-[1.25em] font-bold' : ''}`}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  )
}

function StoreHeader({ store }: { store: Store }) {
  const { t } = useTranslation()
  return (
    <header className="text-center">
      <p className="text-[1.3em] font-bold">{store.name}</p>
      {store.address && <p>{store.address}</p>}
      {store.phone && (
        <p>
          <bdi dir="ltr">{store.phone}</bdi>
        </p>
      )}
      {store.taxNumber && (
        <p>
          {t('receipt.taxNumber')}: <bdi dir="ltr">{store.taxNumber}</bdi>
        </p>
      )}
    </header>
  )
}

function useUnitLabel() {
  const units = useQuery(referenceQuery('units'))
  const unitName = useReferenceName('units')
  return (id: string) => {
    const unit = units.data?.items.find((row) => row.id === id)
    return unit ? unitName(unit) : ''
  }
}

function SaleFacts({ sale }: { sale: Sale }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <div>
      <Row label={t('receipt.number')} value={<bdi dir="ltr">{sale.number}</bdi>} />
      {sale.returnOfNumber && <Row label={t('receipt.returnOf')} value={<bdi dir="ltr">{sale.returnOfNumber}</bdi>} />}
      <Row label={t('receipt.date')} value={format.dateTime(sale.createdAt)} />
      {sale.cashierName && <Row label={t('receipt.cashier')} value={sale.cashierName} />}
      {sale.customerName && <Row label={t('receipt.customer')} value={sale.customerName} />}
    </div>
  )
}

function SaleTotals({ sale }: { sale: Sale }) {
  const { t } = useTranslation()
  const format = useFormat()
  const refund = sale.kind === 'return'
  return (
    <div>
      {!refund && sale.discountMinor > 0 && (
        <>
          <Row label={t('receipt.gross')} value={format.money(sale.grossMinor)} />
          <Row label={t('receipt.discount')} value={format.money(sale.discountMinor)} />
        </>
      )}
      <Row label={t(refund ? 'receipt.refund' : 'receipt.grandTotal')} value={format.money(sale.totalMinor)} strong />
      {sale.taxMinor > 0 && <Row label={t('receipt.tax')} value={format.money(sale.taxMinor)} />}
      {sale.payments
        .filter(({ reversal }) => !reversal)
        .map((payment) => (
          <Row key={payment.id} label={t(`pos.methods.${payment.method}`)} value={format.money(Math.abs(payment.amountMinor))} />
        ))}
      {sale.changeMinor > 0 && <Row label={t('receipt.change')} value={format.money(sale.changeMinor)} />}
    </div>
  )
}

function RollSale({ sale, store }: { sale: Sale; store: Store }) {
  const { t } = useTranslation()
  const format = useFormat()
  const unitLabel = useUnitLabel()

  return (
    <div className="flex flex-col gap-[2mm] p-[2mm] text-[11px] leading-snug">
      <StoreHeader store={store} />
      <p className="border-y border-black py-[1mm] text-center font-bold">
        {t(sale.kind === 'return' ? 'receipt.returnTitle' : 'receipt.title')}
        {sale.status === 'voided' && ` - ${t('receipt.voidedStamp')}`}
      </p>
      <SaleFacts sale={sale} />
      <div className="border-t border-dashed border-black pt-[1mm]">
        {sale.lines.map((line) => (
          <div key={line.id} className="pb-[1mm]">
            <p className="font-medium">
              {line.itemName}
              {line.variantLabel ? ` - ${line.variantLabel}` : ''}
            </p>
            <Row
              label={
                <span className="tabular">
                  {format.quantity(line.qtyMilli)} {unitLabel(line.unitId)} × {format.money(line.unitPriceMinor)}
                </span>
              }
              value={format.money(line.totalMinor)}
            />
            {line.serials.length > 0 && <p dir="ltr">{line.serials.join(', ')}</p>}
          </div>
        ))}
      </div>
      <div className="border-t border-dashed border-black pt-[1mm]">
        <SaleTotals sale={sale} />
      </div>
      <p className="pt-[1mm] text-center">{t('receipt.thanks')}</p>
    </div>
  )
}

function PageSale({ sale, store }: { sale: Sale; store: Store }) {
  const { t } = useTranslation()
  const format = useFormat()
  const unitLabel = useUnitLabel()
  const cell = 'border border-black px-[2mm] py-[1mm]'

  return (
    <div className="flex flex-col gap-[6mm] p-[10mm] text-[12px] leading-relaxed">
      <div className="flex items-start justify-between gap-[10mm]">
        <StoreHeader store={store} />
        <div className="min-w-[60mm]">
          <p className="pb-[1mm] text-[1.3em] font-bold">
            {t(sale.kind === 'return' ? 'receipt.returnTitle' : 'receipt.invoiceTitle')}
            {sale.status === 'voided' && ` - ${t('receipt.voidedStamp')}`}
          </p>
          <SaleFacts sale={sale} />
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${cell} text-start`}>{t('receipt.item')}</th>
            <th className={`${cell} text-start`}>{t('receipt.quantity')}</th>
            <th className={`${cell} text-start`}>{t('receipt.price')}</th>
            <th className={`${cell} text-start`}>{t('receipt.discount')}</th>
            <th className={`${cell} text-start`}>{t('receipt.total')}</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.id}>
              <td className={cell}>
                {line.itemName}
                {line.variantLabel ? ` - ${line.variantLabel}` : ''}
                {line.serials.length > 0 && <span dir="ltr"> ({line.serials.join(', ')})</span>}
              </td>
              <td className={`${cell} tabular`}>
                {format.quantity(line.qtyMilli)} {unitLabel(line.unitId)}
              </td>
              <td className={`${cell} tabular`}>{format.money(line.unitPriceMinor)}</td>
              <td className={`${cell} tabular`}>{format.money(line.discountMinor)}</td>
              <td className={`${cell} tabular`}>{format.money(line.totalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ms-auto w-[70mm]">
        <SaleTotals sale={sale} />
      </div>
    </div>
  )
}

function ShiftReport({ shift, store }: { shift: ShiftSummary; store: Store }) {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div className="flex flex-col gap-[2mm] p-[2mm] text-[11px] leading-snug">
      <StoreHeader store={store} />
      <p className="border-y border-black py-[1mm] text-center font-bold">
        {t('shifts.report')} <bdi dir="ltr">{shift.number}</bdi>
      </p>
      <div>
        <Row label={t('shifts.cashier')} value={shift.userName} />
        <Row label={t('shifts.openedAt')} value={format.dateTime(shift.openedAt)} />
        {shift.closedAt && <Row label={t('shifts.closedAt')} value={format.dateTime(shift.closedAt)} />}
      </div>
      <div className="border-t border-dashed border-black pt-[1mm]">
        <Row label={t('shifts.salesCount')} value={format.number(shift.salesCount)} />
        <Row label={t('shifts.salesTotal')} value={format.money(shift.salesMinor)} />
        <Row label={t('shifts.returnsTotal')} value={format.money(shift.returnsMinor)} />
        <Row label={t('shifts.discount')} value={format.money(shift.discountMinor)} />
        <Row label={t('shifts.tax')} value={format.money(shift.taxMinor)} />
        {shift.byMethod.map(({ method, amountMinor }) => (
          <Row key={method} label={t(`shifts.methods.${method}`)} value={format.money(amountMinor)} />
        ))}
      </div>
      <div className="border-t border-dashed border-black pt-[1mm]">
        <Row label={t('shifts.openingCash')} value={format.money(shift.openingCashMinor)} />
        <Row label={t('shifts.cashIn')} value={format.money(shift.cashInMinor)} />
        <Row label={t('shifts.cashOut')} value={format.money(shift.cashOutMinor)} />
        <Row label={t('shifts.receipts')} value={format.money(shift.receiptsMinor)} />
        <Row label={t('shifts.expected')} value={format.money(shift.expectedCashMinor)} strong />
        {shift.countedCashMinor !== null && <Row label={t('shifts.counted')} value={format.money(shift.countedCashMinor)} />}
        {shift.differenceMinor !== null && <Row label={t('shifts.difference')} value={format.money(shift.differenceMinor)} />}
      </div>
    </div>
  )
}

/**
 * Printing is the window printing itself with everything but this sheet hidden, which is what
 * keeps Arabic shaping right on a thermal printer. The sheet sits off-screen rather than hidden,
 * so its height can be measured and the roll cut to fit.
 */
function PrintSheet({ job, store, sheet }: { job: Job; store: Store; sheet: React.RefObject<HTMLDivElement | null> }) {
  const width = job.paper === 'a4' ? '210mm' : `${ROLL_WIDTH_MM[job.paper]}mm`

  return createPortal(
    <div ref={sheet} data-testid="print-receipt" aria-hidden className="receipt-sheet bg-white text-black" dir={document.documentElement.dir}>
      <style>{`
        .receipt-sheet { position: fixed; top: 0; inset-inline-start: -9999px; width: ${width}; }
        @media print {
          @page { margin: 0; ${job.paper === 'a4' ? 'size: A4;' : ''} }
          html, body { height: auto !important; overflow: visible !important; background: white !important; }
          body > *:not(.receipt-sheet) { display: none !important; }
          .receipt-sheet { position: static; inset-inline-start: auto; }
        }
      `}</style>
      {job.type === 'shift' ? (
        <ShiftReport shift={job.shift} store={store} />
      ) : job.paper === 'a4' ? (
        <PageSale sale={job.sale} store={store} />
      ) : (
        <RollSale sale={job.sale} store={store} />
      )}
    </div>,
    document.body,
  )
}

export function usePrinter() {
  const settings = useQuery(settingsQuery)
  const errorText = useErrorText()
  const sheet = useRef<HTMLDivElement>(null)
  const [job, setJob] = useState<Job | null>(null)

  const paper = settings.data?.pos.receiptPaper ?? '80mm'
  const printerName = settings.data?.pos.printerName ?? null

  // The receipt can't be printed before its fonts and numbers have laid out.
  const run = useCallback(
    async (next: Job) => {
      flushSync(() => setJob(next))
      await document.fonts.ready
      await new Promise(requestAnimationFrame)

      const height = sheet.current ? sheet.current.offsetHeight * MM_PER_PX : 0
      const roll = next.paper === 'a4' ? null : ROLL_WIDTH_MM[next.paper]
      const job = { deviceName: printerName, widthMm: roll, heightMm: roll ? Math.ceil(height) : null }
      // A failed print must never read as a failed sale, which is already recorded by now.
      const result = await desktop()
        .print(job)
        .catch(() => ({ ok: false }))
      if (!result.ok) toast.error(errorText('PRINT_FAILED'))
    },
    [errorText, printerName],
  )

  useEffect(() => () => setJob(null), [])

  return {
    autoPrint: settings.data?.pos.autoPrint ?? false,
    printSale: useCallback((sale: Sale, override?: ReceiptPaper) => run({ type: 'sale', sale, paper: override ?? paper }), [paper, run]),
    printShift: useCallback((shift: ShiftSummary) => run({ type: 'shift', shift, paper: paper === 'a4' ? '80mm' : paper }), [paper, run]),
    sheet: job && settings.data ? <PrintSheet job={job} store={settings.data.store} sheet={sheet} /> : null,
  }
}

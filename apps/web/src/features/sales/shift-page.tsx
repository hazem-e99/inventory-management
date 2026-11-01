import type { ShiftSummary } from '@inv/contracts'
import { Badge, Button, FormSkeleton, Sign, Table, Td, Th, Tr } from '@inv/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { QueryBoundary } from '../../components/states'
import { useFormat } from '../../lib/format'
import { shiftQuery } from './queries'
import { usePrinter } from './receipt'

function Figures({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-rule bg-surface px-4 py-3">
      <h2 className="font-semibold text-ink">{title}</h2>
      <dl className="flex flex-col gap-1">{children}</dl>
    </section>
  )
}

function Figure({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-rule pt-1.5 font-semibold text-ink' : 'text-ink-soft'}`}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  )
}

function ShiftReport({ shift }: { shift: ShiftSummary }) {
  const { t } = useTranslation()
  const format = useFormat()
  const printer = usePrinter()
  const difference = shift.differenceMinor

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-ink-soft">
          <Badge tone={shift.status === 'open' ? 'ok' : 'neutral'}>{t(`shifts.statuses.${shift.status}`)}</Badge>
          <span>
            {t('shifts.cashier')}: <span className="text-ink">{shift.userName}</span>
          </span>
          <span>
            {t('shifts.openedAt')}: <span className="tabular text-ink">{format.dateTime(shift.openedAt)}</span>
          </span>
          {shift.closedAt && (
            <span>
              {t('shifts.closedAt')}: <span className="tabular text-ink">{format.dateTime(shift.closedAt)}</span>
            </span>
          )}
        </div>
        <Button onClick={() => void printer.printShift(shift)}>
          <Printer aria-hidden className="size-4" />
          {t('shifts.printReport')}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Figures title={t('shifts.netSales')}>
          <Figure label={t('shifts.salesCount')} value={format.number(shift.salesCount)} />
          <Figure label={t('shifts.salesTotal')} value={format.money(shift.salesMinor)} />
          <Figure label={t('shifts.returnsCount')} value={format.number(shift.returnsCount)} />
          <Figure label={t('shifts.returnsTotal')} value={format.money(shift.returnsMinor)} />
          <Figure label={t('shifts.discount')} value={format.money(shift.discountMinor)} />
          <Figure label={t('shifts.tax')} value={format.money(shift.taxMinor)} />
          <Figure label={t('shifts.netSales')} value={format.money(shift.salesMinor - shift.returnsMinor)} strong />
        </Figures>
        <Figures title={t('shifts.byMethod')}>
          {shift.byMethod.map(({ method, amountMinor }) => (
            <Figure key={method} label={t(`shifts.methods.${method}`)} value={format.money(amountMinor)} />
          ))}
        </Figures>
        <Figures title={t('shifts.expected')}>
          <Figure label={t('shifts.openingCash')} value={format.money(shift.openingCashMinor)} />
          <Figure label={t('shifts.cashIn')} value={format.money(shift.cashInMinor)} />
          <Figure label={t('shifts.cashOut')} value={format.money(shift.cashOutMinor)} />
          <Figure label={t('shifts.receipts')} value={format.money(shift.receiptsMinor)} />
          <Figure label={t('shifts.expected')} value={format.money(shift.expectedCashMinor)} strong />
          {shift.countedCashMinor !== null && <Figure label={t('shifts.counted')} value={format.money(shift.countedCashMinor)} />}
          {difference !== null && (
            <Figure
              label={difference === 0 ? t('shifts.balanced') : t(difference > 0 ? 'shifts.over' : 'shifts.short')}
              value={format.money(Math.abs(difference))}
              strong
            />
          )}
        </Figures>
      </div>

      {shift.movements.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink">{t('shifts.movements')}</h2>
          <Table>
            <thead>
              <tr>
                <Th>{t('shifts.time')}</Th>
                <Th>{t('shifts.cashKind')}</Th>
                <Th>{t('shifts.reason')}</Th>
                <Th className="text-end">{t('shifts.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {shift.movements.map((movement) => (
                <Tr key={movement.id}>
                  <Td className="tabular">{format.dateTime(movement.occurredAt)}</Td>
                  <Td>{t(`shifts.kinds.${movement.kind}`)}</Td>
                  <Td>{movement.reason}</Td>
                  <Td className="tabular text-end font-medium">
                    <bdi dir="ltr">{format.money(movement.amountMinor)}</bdi>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      {printer.sheet}
    </div>
  )
}

export function ShiftPage() {
  const { t } = useTranslation()
  const { id } = useParams({ strict: false })
  const shift = useQuery(shiftQuery(id!))

  return (
    <div className="flex flex-col gap-5">
      <Sign title={shift.data ? `${t('shifts.report')} ${shift.data.number}` : t('shifts.report')} secondary={t('nav.shifts.label')} />
      <QueryBoundary query={shift} skeleton={<FormSkeleton fields={4} />}>
        {(data) => <ShiftReport shift={data} />}
      </QueryBoundary>
    </div>
  )
}

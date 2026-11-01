import { dashboardSchema, type Dashboard } from '@inv/contracts'
import { Badge, Skeleton } from '@inv/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'

const CHART_HEIGHT = 140
const TICK_COUNT = 3

/** Ticks at round numbers, so the axis reads 0, 2K, 4K rather than 0, 1,837, 3,674. */
function axisTicks(largest: number): number[] {
  const rough = Math.max(largest, 100) / TICK_COUNT
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= rough)! * magnitude
  const top = Math.ceil(Math.max(largest, 100) / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step)
}

function SalesChart({ days }: { days: Dashboard['days'] }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [hovered, setHovered] = useState<number | null>(null)

  const ticks = axisTicks(Math.max(...days.map(({ netMinor }) => netMinor)))
  const top = ticks.at(-1)!
  const active = hovered === null ? null : days[hovered]

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-medium text-ink">{t('reports.dashboard.trend')}</figcaption>

      {/* Time runs left to right in both languages, as it does on a printed chart. */}
      <div aria-hidden dir="ltr" className="flex gap-2">
        <div className="relative w-12 shrink-0 text-xs text-ink-faint" style={{ height: CHART_HEIGHT }}>
          {ticks.map((tick) => (
            <span key={tick} className="tabular absolute inset-x-0 -translate-y-1/2 text-end" style={{ bottom: `calc(${(tick / top) * 100}% - 0.75rem)` }}>
              <bdi>{format.compact(tick)}</bdi>
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="relative border-b border-rule-strong" style={{ height: CHART_HEIGHT }}>
            {ticks.slice(1).map((tick) => (
              <span key={tick} className="absolute inset-x-0 h-px bg-rule" style={{ bottom: `${(tick / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex">
              {days.map((day, index) => (
                <div
                  key={day.date}
                  className="flex h-full flex-1 items-end justify-center px-px"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {day.netMinor > 0 && (
                    <span
                      className={`block w-full max-w-6 rounded-t bg-route transition-opacity duration-150 ${hovered !== null && hovered !== index ? 'opacity-40' : ''}`}
                      style={{ height: `${(day.netMinor / top) * 100}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
            {active && (
              <div
                className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-rule bg-surface px-2.5 py-1.5 text-sm whitespace-nowrap shadow-[0_8px_24px_rgb(16_33_59/0.18)]"
                style={{ left: `clamp(4rem, ${((hovered! + 0.5) / days.length) * 100}%, calc(100% - 4rem))` }}
              >
                <p className="text-ink-soft">{format.dayMonth(active.date)}</p>
                <p className="tabular font-semibold text-ink">{format.money(active.netMinor)}</p>
              </div>
            )}
          </div>
          <div className="flex pt-1 text-xs text-ink-faint">
            {days.map((day, index) => (
              <span key={day.date} className="tabular flex-1 text-center">
                {index % 2 === 1 ? format.dayMonth(day.date) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{t('reports.dashboard.trend')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('reports.dashboard.day')}</th>
            <th scope="col">{t('reports.dashboard.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{day.date}</td>
              <td>{format.money(day.netMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function Alert({ to, count, label, tone }: { to: string; count: number; label: string; tone: ComponentProps<typeof Badge>['tone'] }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-4 border-b border-rule px-4 py-3 last:border-b-0 hover:bg-ground">
        <span className="text-ink">{label}</span>
        <Badge tone={tone}>{count}</Badge>
      </Link>
    </li>
  )
}

function Figures({ data }: { data: Dashboard }) {
  const { t } = useTranslation()
  const format = useFormat()
  const { today, alerts } = data
  const clear = alerts.lowStock + alerts.nearExpiry + alerts.expired === 0

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-6">
      <div className="flex flex-col gap-5 rounded-lg border border-rule bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-ink-soft">{t('reports.dashboard.net')}</p>
            <p data-testid="dashboard-net" className="text-5xl leading-tight font-semibold text-ink">
              {format.money(today.netMinor)}
            </p>
          </div>
          <dl className="flex gap-8">
            <div>
              <dt className="text-sm text-ink-soft">{t('reports.dashboard.invoices')}</dt>
              <dd className="text-lg font-semibold text-ink">{format.number(today.salesCount)}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">{t('reports.dashboard.returns')}</dt>
              <dd className="text-lg font-semibold text-ink">{format.money(today.returnsMinor)}</dd>
            </div>
            {today.profitMinor !== null && (
              <div>
                <dt className="text-sm text-ink-soft">{t('reports.dashboard.profit')}</dt>
                <dd className="text-lg font-semibold text-ink">{format.money(today.profitMinor)}</dd>
              </div>
            )}
          </dl>
        </div>
        <SalesChart days={data.days} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('reports.dashboard.alerts')}</h2>
        {clear ? (
          <p className="rounded-lg border border-rule bg-surface px-4 py-3 text-ink-soft">{t('reports.dashboard.alertsClear')}</p>
        ) : (
          <ul className="rounded-lg border border-rule bg-surface">
            {alerts.expired > 0 && <Alert to="/reports/expiry" count={alerts.expired} label={t('reports.dashboard.expired')} tone="danger" />}
            {alerts.lowStock > 0 && <Alert to="/reports/reorder" count={alerts.lowStock} label={t('reports.dashboard.lowStock')} tone="warn" />}
            {alerts.nearExpiry > 0 && <Alert to="/reports/expiry" count={alerts.nearExpiry} label={t('reports.dashboard.nearExpiry')} tone="warn" />}
          </ul>
        )}
        <Link to="/reports" className="text-sm text-route hover:underline">
          {t('reports.dashboard.allReports')}
        </Link>
      </section>
    </div>
  )
}

export function DashboardPanel() {
  const query = useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: () => api(dashboardSchema, 'GET', '/reports/dashboard'),
    // Figures move with every sale, so a cached one is simply wrong.
    staleTime: 0,
  })

  return (
    <QueryBoundary query={query} skeleton={<Skeleton className="h-80 w-full" />}>
      {(data) => <Figures data={data} />}
    </QueryBoundary>
  )
}

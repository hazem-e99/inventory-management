import {
  REPORT_PAGE_LIMIT,
  REPORT_ROWS,
  fileSavedSchema,
  reportPageSchema,
  type ReportKey,
} from '@inv/contracts'
import { addDays, businessDate } from '@inv/domain'
import { Button, Field, Input, Select, Sign, TableSkeleton } from '@inv/ui'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { FileDown, FileSpreadsheet, ShoppingCart } from 'lucide-react'
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
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
import { setOrderDraft } from '../purchasing/order-draft'
import { settingsQuery } from '../settings/queries'
import { REPORTS, type ReportColumn } from './report-config'

const ROW_HEIGHT = 48
const PAGE_SIZE = 100

type Row = Record<string, unknown>
type Period = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

const PERIOD_DAYS: Record<Exclude<Period, 'custom'>, number> = { today: 1, week: 7, month: 30, quarter: 90, year: 365 }

function useFilters(days: number | undefined) {
  const today = businessDate(Date.now())
  const [period, setPeriod] = useState<Period>('month')
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today })
  const [lookAhead, setLookAhead] = useState(days ?? 0)

  const range = period === 'custom' ? custom : { from: addDays(today, 1 - PERIOD_DAYS[period]), to: today }
  return { period, setPeriod, custom, setCustom, range, lookAhead, setLookAhead }
}

function useCell() {
  const { t, i18n } = useTranslation()
  const format = useFormat()

  return useCallback(
    (column: ReportColumn, value: unknown): string => {
      if (value === null || value === undefined) return '-'
      if (column.values) {
        const key = `${column.values}.${String(value)}`
        return i18n.exists(key) ? (t as (key: string) => string)(key) : String(value)
      }
      if (column.kind === 'money') return format.money(Number(value))
      if (column.kind === 'quantity') return format.quantity(Number(value))
      if (column.kind === 'number') return format.number(Number(value))
      if (column.kind === 'dateTime') return format.dateTime(Number(value))
      return String(value)
    },
    [format, i18n, t],
  )
}

function isCode(column: ReportColumn): boolean {
  return column.key === 'documentNumber' || column.key === 'lotNo' || column.key === 'number'
}

function RowView({ row, columns, grid }: { row: Row; columns: ReportColumn[]; grid: string }) {
  const cell = useCell()

  return (
    <div role="row" className="grid h-full items-center gap-3 border-b border-rule px-4 text-sm hover:bg-ground" style={{ gridTemplateColumns: grid }}>
      {columns.map((column) => {
        const text = cell(column, row[column.key])
        const target = column.link?.(row)
        const numeric = column.kind === 'money' || column.kind === 'quantity' || column.kind === 'number'
        const content: ReactNode = isCode(column) || numeric ? <bdi dir="ltr">{text}</bdi> : text
        return (
          <div key={column.key} role="cell" className={`truncate ${numeric ? 'tabular text-end text-ink' : 'text-ink-soft'}`}>
            {target && row[column.key] ? (
              <Link to={target.to} params={target.params} className="font-medium text-ink hover:text-route">
                {content}
              </Link>
            ) : (
              content
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Laid out for paper and shown only while the window turns into a PDF. */
function ReportSheet({
  title,
  subtitle,
  columns,
  rows,
  totals,
  landscape,
  sheet,
  note,
}: {
  title: string
  subtitle: string
  columns: ReportColumn[]
  rows: Row[]
  totals: Record<string, number | null>
  landscape: boolean
  sheet: React.RefObject<HTMLDivElement | null>
  note: string | null
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const cell = useCell()
  const store = useQuery(settingsQuery)
  const box = 'border border-black px-[1.5mm] py-[0.8mm] text-start'

  return createPortal(
    <div ref={sheet} aria-hidden data-testid="report-sheet" className="report-sheet bg-white text-[10px] leading-snug text-black" dir={document.documentElement.dir}>
      <style>{`
        .report-sheet { display: none; }
        @media print {
          @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
          html, body { height: auto !important; overflow: visible !important; background: white !important; }
          body > *:not(.report-sheet) { display: none !important; }
          .report-sheet { display: block; }
          .report-sheet thead { display: table-header-group; }
          .report-sheet tr { break-inside: avoid; }
        }
      `}</style>
      <p className="text-[14px] font-bold">{store.data?.store.name}</p>
      <p className="text-[13px] font-bold">{title}</p>
      <p className="pb-[3mm]">
        {subtitle} · {t('reports.printedAt', { date: format.dateTime(Date.now()) })}
      </p>
      {note && <p className="pb-[2mm]">{note}</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={box}>
                {(t as (key: string) => string)(`reports.columns.${column.label ?? column.key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.key} className={`${box} tabular`}>
                  {cell(column, row[column.key])}
                </td>
              ))}
            </tr>
          ))}
          {Object.keys(totals).length > 0 && (
            <tr>
              {columns.map((column, index) => (
                <td key={column.key} className={`${box} tabular font-bold`}>
                  {index === 0 ? t('reports.totals') : column.key in totals ? cell(column, totals[column.key]) : ''}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>,
    document.body,
  )
}

export function ReportPage() {
  const { t, i18n } = useTranslation()
  const { key: keyParam } = useParams({ strict: false })
  const key = keyParam as ReportKey
  const definition = REPORTS[key]
  const navigate = useNavigate()
  const report = useReportError()
  const canSeeCost = useCan('reports.profit')
  const { locale } = usePreferences().preferences
  const filters = useFilters(definition.days)
  const fromId = useId()
  const toId = useId()
  const periodId = useId()
  const daysId = useId()
  const sheet = useRef<HTMLDivElement>(null)
  const [paper, setPaper] = useState<{ rows: Row[]; totals: Record<string, number | null>; capped: boolean } | null>(null)

  const columns = useMemo(() => definition.columns.filter((column) => canSeeCost || !column.cost), [canSeeCost, definition.columns])
  const grid = columns.map((column) => column.width).join(' ')

  const filterParams = useMemo(() => {
    const params = new URLSearchParams()
    if (definition.range) {
      params.set('from', filters.range.from)
      params.set('to', filters.range.to)
    }
    if (definition.days) params.set('days', String(filters.lookAhead || definition.days))
    return params
  }, [definition.days, definition.range, filters.lookAhead, filters.range.from, filters.range.to])

  const schema = useMemo(() => reportPageSchema(REPORT_ROWS[key]), [key])

  const query = useInfiniteQuery({
    queryKey: ['reports', key, filterParams.toString()],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(filterParams)
      params.set('limit', String(PAGE_SIZE))
      if (pageParam) params.set('cursor', pageParam)
      return api(schema, 'GET', `/reports/${key}?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
    // Figures move with every sale, so a cached one is simply wrong.
    staleTime: 0,
  })

  const rows = useMemo(() => (query.data?.pages.flatMap((page) => page.items) ?? []) as Row[], [query.data])
  const totals = query.data?.pages[0]?.totals ?? {}
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const stamp = businessDate(Date.now())
  const title = t(`reports.titles.${key}`)

  const toExcel = useMutation({
    mutationFn: async () => {
      const destination = await desktop().chooseSpreadsheetDestination(`${key}-${stamp}.xlsx`)
      if (!destination) return null
      return api(fileSavedSchema, 'POST', `/reports/${key}/export`, {
        body: {
          destination,
          rightToLeft: locale === 'ar',
          ...(definition.range ? filters.range : {}),
          ...(definition.days ? { days: filters.lookAhead || definition.days } : {}),
          columns: columns.map((column) => ({
            key: column.key,
            label: (t as (key: string) => string)(`reports.columns.${column.label ?? column.key}`),
            kind: column.kind,
            ...(column.values ? { values: translations(column.values, i18n, t as (key: string) => string, rows, column.key) } : {}),
          })),
        },
      })
    },
    onSuccess: (saved) => {
      if (saved) toast.success(t('reports.exported', { rows: saved.rows }))
    },
    onError: report,
  })

  const toPdf = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams(filterParams)
      params.set('limit', String(REPORT_PAGE_LIMIT))
      const page = await api(schema, 'GET', `/reports/${key}?${params}`)
      flushSync(() => setPaper({ rows: page.items as Row[], totals: page.totals, capped: page.nextCursor !== null }))
      await document.fonts.ready
      return desktop().savePdf({ defaultName: `${key}-${stamp}.pdf`, landscape: definition.landscape ?? false })
    },
    onSuccess: ({ saved }) => {
      if (saved) toast.success(t('reports.pdfSaved'))
    },
    onError: report,
    onSettled: () => setPaper(null),
  })

  const orderSuggestion = () => {
    setOrderDraft(
      rows.flatMap((row) =>
        Number(row.suggestedMilli) > 0
          ? [
              {
                variantId: String(row.variantId),
                name: String(row.name),
                baseUnitId: String(row.baseUnitId),
                qtyMilli: Number(row.suggestedMilli),
                costMinor: Number(row.costMinor),
              },
            ]
          : [],
      ),
    )
    void navigate({ to: '/orders/new' })
  }

  const subtitle = definition.range ? `${filters.range.from} - ${filters.range.to}` : t(`reports.descriptions.${key}`)
  const showTotals = Object.values(totals).some((value) => value !== null)

  return (
    <div className="flex h-full flex-col gap-4">
      <Sign
        title={title}
        secondary={t('nav.reports.label')}
        actions={
          <>
            {key === 'reorder' && rows.length > 0 && (
              <Button onClick={orderSuggestion}>
                <ShoppingCart aria-hidden className="size-4" />
                {t('reports.createOrder')}
              </Button>
            )}
            <Button variant="secondary" disabled={rows.length === 0} loading={toPdf.isPending} onClick={() => toPdf.mutate()}>
              <FileDown aria-hidden className="size-4" />
              {t('reports.exportPdf')}
            </Button>
            <Button variant="secondary" disabled={rows.length === 0} loading={toExcel.isPending} onClick={() => toExcel.mutate()}>
              <FileSpreadsheet aria-hidden className="size-4" />
              {t('reports.exportExcel')}
            </Button>
          </>
        }
      />

      {(definition.range || definition.days) && (
        <div className="flex flex-wrap items-end gap-3">
          {definition.range && (
            <>
              <Field id={periodId} label={t('reports.period')}>
                <Select id={periodId} className="w-44" value={filters.period} onChange={(event) => filters.setPeriod(event.target.value as Period)}>
                  {(['today', 'week', 'month', 'quarter', 'year', 'custom'] as const).map((period) => (
                    <option key={period} value={period}>
                      {t(`reports.periods.${period}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {filters.period === 'custom' && (
                <>
                  <Field id={fromId} label={t('reports.from')}>
                    <Input
                      id={fromId}
                      type="date"
                      dir="ltr"
                      value={filters.custom.from}
                      onChange={(event) => filters.setCustom({ ...filters.custom, from: event.target.value })}
                    />
                  </Field>
                  <Field id={toId} label={t('reports.to')}>
                    <Input
                      id={toId}
                      type="date"
                      dir="ltr"
                      value={filters.custom.to}
                      onChange={(event) => filters.setCustom({ ...filters.custom, to: event.target.value })}
                    />
                  </Field>
                </>
              )}
            </>
          )}
          {definition.days && (
            <Field id={daysId} label={t('reports.days')}>
              <Input
                id={daysId}
                dir="ltr"
                inputMode="numeric"
                className="w-28"
                value={filters.lookAhead || ''}
                onChange={(event) => filters.setLookAhead(Number(event.target.value.replace(/\D/g, '')))}
              />
            </Field>
          )}
        </div>
      )}

      {query.isPending ? (
        <TableSkeleton columns={Math.min(columns.length, 6)} rows={8} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={definition.range ? t('reports.emptyTitle') : t('reports.emptyPlain')} body={definition.range ? t('reports.emptyBody') : undefined} />
      ) : (
        <>
          <VirtualRows
            items={rows}
            rowHeight={ROW_HEIGHT}
            onNearEnd={loadMore}
            header={
              <div role="row" className="grid items-center gap-3 border-b border-rule bg-sunken px-4 py-2.5 text-sm font-medium text-ink-soft" style={{ gridTemplateColumns: grid }}>
                {columns.map((column) => (
                  <span key={column.key} role="columnheader" className={column.kind === 'money' || column.kind === 'quantity' || column.kind === 'number' ? 'text-end' : ''}>
                    {(t as (key: string) => string)(`reports.columns.${column.label ?? column.key}`)}
                  </span>
                ))}
              </div>
            }
            renderRow={(row) => <RowView row={row} columns={columns} grid={grid} />}
          />
          {showTotals && <TotalsRow columns={columns} totals={totals} grid={grid} />}
        </>
      )}

      {paper && (
        <ReportSheet
          title={title}
          subtitle={subtitle}
          columns={columns}
          rows={paper.rows}
          totals={paper.totals}
          landscape={definition.landscape ?? false}
          sheet={sheet}
          note={paper.capped ? t('reports.pdfLimit', { rows: REPORT_PAGE_LIMIT }) : null}
        />
      )}
    </div>
  )
}

function TotalsRow({ columns, totals, grid }: { columns: ReportColumn[]; totals: Record<string, number | null>; grid: string }) {
  const { t } = useTranslation()
  const cell = useCell()

  return (
    <div data-testid="report-totals" className="grid items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-3 text-sm font-semibold text-ink" style={{ gridTemplateColumns: grid }}>
      {columns.map((column, index) => (
        <span key={column.key} className={`truncate ${column.key in totals ? 'tabular text-end' : ''}`}>
          {index === 0 ? t('reports.totals') : column.key in totals ? cell(column, totals[column.key]) : ''}
        </span>
      ))}
    </div>
  )
}

function translations(prefix: string, i18n: { exists: (key: string) => boolean }, t: (key: string) => string, rows: Row[], key: string): Record<string, string> {
  const codes = new Set(rows.map((row) => String(row[key])))
  return Object.fromEntries([...codes].filter((code) => i18n.exists(`${prefix}.${code}`)).map((code) => [code, t(`${prefix}.${code}`)]))
}

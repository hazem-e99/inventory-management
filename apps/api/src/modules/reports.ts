import { createRoute } from '@hono/zod-openapi'
import {
  anyReportPageSchema,
  dashboardSchema,
  fileSavedSchema,
  reportExportSchema,
  reportParamsSchema,
  reportQuerySchema,
  type Actor,
  type Alerts,
  type ColumnKind,
  type ReportFilter,
  type ReportKey,
  type ReportRow,
} from '@inv/contracts'
import { auditRepo, reportsRepo, type Database, type Kysely } from '@inv/db'
import { abcClasses, addDays, averageCostMinor, businessDate, daysBetween, eachDay, reorderSuggestion } from '@inv/domain'
import writeXlsxFile from 'write-excel-file/node'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'

const DEFAULT_RANGE_DAYS = 30
const NEAR_EXPIRY_DAYS = 90
const DEAD_STOCK_DAYS = 90
const REORDER_LOOKBACK_DAYS = 30
const DASHBOARD_DAYS = 14
const EXPORT_LIMIT = 100_000

interface ReportResult<K extends ReportKey> {
  rows: ReportRow<K>[]
  nextCursor: string | null
  totals: Record<string, number | null>
}

interface ReportContext {
  db: Kysely<Database>
  filter: ReportFilter
  today: string
  /** Whoever can't see cost gets a null, so a hidden figure can never be read as a zero. */
  cost: <T>(value: T) => T | null
}

const sumOf = <T,>(rows: readonly T[], read: (row: T) => number) => rows.reduce((sum, row) => sum + read(row), 0)

const rangeOf = ({ filter, today }: ReportContext) => ({
  from: filter.from ?? addDays(today, 1 - DEFAULT_RANGE_DAYS),
  to: filter.to ?? today,
})

const offsetOf = (filter: ReportFilter) => Number(filter.cursor ?? 0) || 0

const itemName = ({ name, label }: { name: string; label: string | null }) => (label ? `${name} - ${label}` : name)

/** One page of rows already held in memory, for the reports that are never very long. */
function slice<K extends ReportKey>(rows: ReportRow<K>[], filter: ReportFilter, totals: ReportResult<K>['totals']): ReportResult<K> {
  const offset = offsetOf(filter)
  const end = offset + filter.limit
  return { rows: rows.slice(offset, end), nextCursor: end < rows.length ? String(end) : null, totals }
}

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) return null
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { date: string; at: number; id: string }
  } catch {
    return null
  }
}

async function salesReport(context: ReportContext): Promise<ReportResult<'sales'>> {
  const { from, to } = rangeOf(context)
  const records = await reportsRepo(context.db).salesByDay({ from, to })
  const find = (date: string, kind: string) => records.find((row) => row.date === date && row.kind === kind)

  const rows = eachDay(from, to)
    .reverse()
    .flatMap((date): ReportRow<'sales'>[] => {
      const sale = find(date, 'sale')
      const back = find(date, 'return')
      if (!sale && !back) return []

      const net = (sale?.totalMinor ?? 0) - (back?.totalMinor ?? 0)
      const cost = (sale?.costMinor ?? 0) - (back?.costMinor ?? 0)
      return [
        {
          date,
          salesCount: sale?.documents ?? 0,
          returnsCount: back?.documents ?? 0,
          salesMinor: sale?.totalMinor ?? 0,
          returnsMinor: back?.totalMinor ?? 0,
          netMinor: net,
          discountMinor: sale?.discountMinor ?? 0,
          taxMinor: (sale?.taxMinor ?? 0) - (back?.taxMinor ?? 0),
          costMinor: context.cost(cost),
          profitMinor: context.cost(net - cost),
        },
      ]
    })

  const total = (read: (row: ReportRow<'sales'>) => number) => sumOf(rows, read)
  const cost = rows.some(({ costMinor }) => costMinor === null) ? null : total(({ costMinor }) => costMinor ?? 0)
  return slice<'sales'>(rows, context.filter, {
    salesCount: total(({ salesCount }) => salesCount),
    returnsCount: total(({ returnsCount }) => returnsCount),
    salesMinor: total(({ salesMinor }) => salesMinor),
    returnsMinor: total(({ returnsMinor }) => returnsMinor),
    netMinor: total(({ netMinor }) => netMinor),
    discountMinor: total(({ discountMinor }) => discountMinor),
    taxMinor: total(({ taxMinor }) => taxMinor),
    costMinor: cost,
    profitMinor: cost === null ? null : total(({ netMinor }) => netMinor) - cost,
  })
}

async function itemsReport(context: ReportContext): Promise<ReportResult<'items'>> {
  const items = await reportsRepo(context.db).salesByItem(rangeOf(context))
  const classes = abcClasses(items.map(({ salesMinor }) => salesMinor))

  const rows = items.map(({ label: _label, ...item }, index): ReportRow<'items'> => ({
    ...item,
    name: itemName({ name: item.name, label: _label }),
    costMinor: context.cost(item.costMinor),
    profitMinor: context.cost(item.salesMinor - item.costMinor),
    abc: classes[index]!,
  }))

  const sales = sumOf(items, ({ salesMinor }) => salesMinor)
  const cost = sumOf(items, ({ costMinor }) => costMinor)
  return slice<'items'>(rows, context.filter, {
    salesMinor: sales,
    costMinor: context.cost(cost),
    profitMinor: context.cost(sales - cost),
  })
}

async function inventoryReport(context: ReportContext): Promise<ReportResult<'inventory'>> {
  const repo = reportsRepo(context.db)
  const offset = offsetOf(context.filter)
  const [rows, totals] = await Promise.all([repo.inventory({ limit: context.filter.limit, offset }), repo.inventoryTotals()])

  return {
    rows: rows.map((row) => {
      const onHand = Number(row.qty_milli)
      const value = Number(row.value_minor)
      return {
        variantId: row.variant_id,
        productId: row.product_id,
        name: itemName(row),
        sku: row.sku,
        category: row.category,
        onHandMilli: onHand,
        averageCostMinor: context.cost(averageCostMinor(onHand, value)),
        valueMinor: context.cost(value),
      }
    }),
    nextCursor: offset + rows.length < totals.items ? String(offset + rows.length) : null,
    totals: { valueMinor: context.cost(totals.valueMinor) },
  }
}

async function movementsReport(context: ReportContext): Promise<ReportResult<'movements'>> {
  const { rows, next } = await reportsRepo(context.db).movements(rangeOf(context), context.filter.limit, decodeCursor(context.filter.cursor))
  return {
    rows: rows.map((row) => ({
      id: row.id,
      occurredAt: Number(row.occurred_at),
      productId: row.product_id,
      name: itemName(row),
      warehouse: row.warehouse,
      lotNo: row.lot_no,
      kind: row.document_type,
      documentId: row.document_id,
      documentNumber: row.document_number,
      reversal: row.reversal_of !== null,
      qtyMilli: Number(row.qty_milli),
      valueMinor: context.cost(Number(row.value_minor)),
    })),
    nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null,
    totals: {},
  }
}

async function reorderReport(context: ReportContext): Promise<ReportResult<'reorder'>> {
  const repo = reportsRepo(context.db)
  const low = await repo.lowStock()
  const sold = await repo.soldSince(low.map(({ variant_id }) => variant_id), addDays(context.today, -REORDER_LOOKBACK_DAYS))

  const rows = low.map((row): ReportRow<'reorder'> => {
    const onHand = Number(row.qty_milli ?? 0)
    const level = Number(row.reorder_level_milli)
    const soldLastMonth = sold.get(row.variant_id) ?? 0
    return {
      variantId: row.variant_id,
      productId: row.product_id,
      name: itemName(row),
      baseUnitId: row.base_unit_id,
      onHandMilli: onHand,
      levelMilli: level,
      soldLastMonthMilli: soldLastMonth,
      suggestedMilli: reorderSuggestion(onHand, level, soldLastMonth),
      costMinor: Number(row.cost_minor),
      supplier: row.supplier,
    }
  })
  return slice<'reorder'>(rows, context.filter, {})
}

async function expiryReport(context: ReportContext): Promise<ReportResult<'expiry'>> {
  const days = context.filter.days ?? NEAR_EXPIRY_DAYS
  const lots = await reportsRepo(context.db).expiringBy(addDays(context.today, days))

  const rows = lots.map((lot): ReportRow<'expiry'> => ({
    lotId: lot.id,
    productId: lot.product_id,
    name: itemName(lot),
    lotNo: lot.lot_no,
    expiryDate: lot.expiry_date!,
    daysLeft: daysBetween(context.today, lot.expiry_date!),
    warehouse: lot.warehouse,
    qtyMilli: Number(lot.qty_milli),
  }))
  return slice<'expiry'>(rows, context.filter, {})
}

async function deadReport(context: ReportContext): Promise<ReportResult<'dead'>> {
  const days = context.filter.days ?? DEAD_STOCK_DAYS
  const offset = offsetOf(context.filter)
  const rows = await reportsRepo(context.db).deadStock(addDays(context.today, -days), { limit: context.filter.limit, offset })

  return {
    rows: rows.map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      name: itemName(row),
      onHandMilli: Number(row.qty_milli),
      valueMinor: context.cost(Number(row.value_minor)),
      lastSoldOn: (row.last_sold as string | null) ?? null,
    })),
    nextCursor: rows.length === context.filter.limit ? String(offset + rows.length) : null,
    totals: {},
  }
}

async function suppliersReport(context: ReportContext): Promise<ReportResult<'suppliers'>> {
  const parties = await reportsRepo(context.db).suppliers(rangeOf(context))
  const rows = parties.filter((row) => row.purchasesMinor || row.returnsMinor || row.paidMinor || row.balanceMinor)
  return slice<'suppliers'>(rows, context.filter, {
    purchasesMinor: sumOf(rows, ({ purchasesMinor }) => purchasesMinor),
    returnsMinor: sumOf(rows, ({ returnsMinor }) => returnsMinor),
    paidMinor: sumOf(rows, ({ paidMinor }) => paidMinor),
    balanceMinor: sumOf(rows, ({ balanceMinor }) => balanceMinor),
  })
}

async function customersReport(context: ReportContext): Promise<ReportResult<'customers'>> {
  const parties = await reportsRepo(context.db).customers(rangeOf(context))
  const rows = parties.filter((row) => row.salesMinor || row.returnsMinor || row.collectedMinor || row.balanceMinor)
  return slice<'customers'>(rows, context.filter, {
    salesMinor: sumOf(rows, ({ salesMinor }) => salesMinor),
    returnsMinor: sumOf(rows, ({ returnsMinor }) => returnsMinor),
    collectedMinor: sumOf(rows, ({ collectedMinor }) => collectedMinor),
    balanceMinor: sumOf(rows, ({ balanceMinor }) => balanceMinor),
  })
}

async function shiftsReport(context: ReportContext): Promise<ReportResult<'shifts'>> {
  const shifts = await reportsRepo(context.db).shifts(rangeOf(context))

  const rows = shifts.map((shift): ReportRow<'shifts'> => {
    const expected = shift.expected_cash_minor === null ? null : Number(shift.expected_cash_minor)
    const counted = shift.counted_cash_minor === null ? null : Number(shift.counted_cash_minor)
    return {
      id: shift.id,
      number: shift.number,
      cashier: shift.cashier,
      openedAt: Number(shift.opened_at),
      closedAt: shift.closed_at === null ? null : Number(shift.closed_at),
      salesMinor: shift.salesMinor,
      returnsMinor: shift.returnsMinor,
      expectedCashMinor: expected,
      countedCashMinor: counted,
      differenceMinor: expected !== null && counted !== null ? counted - expected : null,
    }
  })
  return slice<'shifts'>(rows, context.filter, {
    salesMinor: sumOf(rows, ({ salesMinor }) => salesMinor),
    returnsMinor: sumOf(rows, ({ returnsMinor }) => returnsMinor),
    differenceMinor: sumOf(rows, ({ differenceMinor }) => differenceMinor ?? 0),
  })
}

const REPORTS: { [K in ReportKey]: (context: ReportContext) => Promise<ReportResult<K>> } = {
  sales: salesReport,
  items: itemsReport,
  inventory: inventoryReport,
  movements: movementsReport,
  reorder: reorderReport,
  expiry: expiryReport,
  dead: deadReport,
  suppliers: suppliersReport,
  customers: customersReport,
  shifts: shiftsReport,
}

async function alertsOf(db: Kysely<Database>, today: string): Promise<Alerts> {
  const repo = reportsRepo(db)
  const [lowStock, expiring] = await Promise.all([repo.countLowStock(), repo.countExpiring(today, addDays(today, NEAR_EXPIRY_DAYS))])
  return { lowStock, ...expiring }
}

const CELL_FORMATS: Partial<Record<ColumnKind, string>> = { money: '#,##0.00', quantity: '#,##0.###', number: '#,##0' }

function exportCell(value: unknown, kind: ColumnKind, values?: Record<string, string>) {
  if (value === null || value === undefined) return null
  if (values) return { value: values[String(value)] ?? String(value), type: String }
  if (kind === 'money') return { value: Number(value) / 100, type: Number, format: CELL_FORMATS.money }
  if (kind === 'quantity') return { value: Number(value) / 1000, type: Number, format: CELL_FORMATS.quantity }
  if (kind === 'number') return { value: Number(value), type: Number, format: CELL_FORMATS.number }
  if (kind === 'dateTime') return { value: new Date(Number(value)), type: Date, format: 'yyyy-mm-dd hh:mm' }
  return { value: String(value), type: String }
}

export function reportRoutes(deps: AppDeps) {
  const canView = [requireAuth(deps), requirePasswordCurrent, requirePermission('reports.view')]

  const dashboardRoute = createRoute({
    method: 'get',
    path: '/reports/dashboard',
    middleware: canView,
    responses: { 200: jsonOk(dashboardSchema) },
  })

  const readRoute = createRoute({
    method: 'get',
    path: '/reports/{key}',
    middleware: canView,
    request: { params: reportParamsSchema, query: reportQuerySchema },
    responses: { 200: jsonOk(anyReportPageSchema) },
  })

  const exportRoute = createRoute({
    method: 'post',
    path: '/reports/{key}/export',
    middleware: canView,
    request: { params: reportParamsSchema, body: jsonBody(reportExportSchema) },
    responses: { 200: jsonOk(fileSavedSchema) },
  })

  const contextFor = (actor: Actor, filter: ReportFilter): ReportContext => {
    const allowed = actor.permissions.includes('reports.profit')
    return {
      db: deps.db,
      filter,
      today: businessDate(deps.clock()),
      cost: <T,>(value: T) => (allowed ? value : null),
    }
  }

  return router()
    .openapi(dashboardRoute, async (c) => {
      const actor = c.get('actor')
      const today = businessDate(deps.clock())
      const from = addDays(today, 1 - DASHBOARD_DAYS)
      const allowed = actor.permissions.includes('reports.profit')

      const records = await reportsRepo(deps.db).salesByDay({ from, to: today })
      const signed = (date: string, read: (row: (typeof records)[number]) => number) =>
        records
          .filter((row) => row.date === date)
          .reduce((sum, row) => sum + (row.kind === 'return' ? -read(row) : read(row)), 0)

      return c.json(
        {
          today: {
            salesCount: records.find((row) => row.date === today && row.kind === 'sale')?.documents ?? 0,
            netMinor: signed(today, (row) => row.totalMinor),
            returnsMinor: records.find((row) => row.date === today && row.kind === 'return')?.totalMinor ?? 0,
            profitMinor: allowed ? signed(today, (row) => row.totalMinor - row.costMinor) : null,
          },
          days: eachDay(from, today).map((date) => ({ date, netMinor: signed(date, (row) => row.totalMinor) })),
          alerts: await alertsOf(deps.db, today),
        },
        200,
      )
    })
    .openapi(readRoute, async (c) => {
      const { key } = c.req.valid('param')
      const context = contextFor(c.get('actor'), c.req.valid('query'))
      const { rows, nextCursor, totals } = await REPORTS[key](context as never)
      return c.json({ items: rows as unknown as Array<Record<string, unknown>>, nextCursor, totals }, 200)
    })
    .openapi(exportRoute, async (c) => {
      const { key } = c.req.valid('param')
      const { destination, columns, rightToLeft, from, to, days } = c.req.valid('json')
      if (!destination.toLowerCase().endsWith('.xlsx')) throw new AppError('EXPORT_FAILED')

      const filter: ReportFilter = { limit: EXPORT_LIMIT, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(days ? { days } : {}) }
      const { rows } = await REPORTS[key](contextFor(c.get('actor'), filter) as never)

      const sheet = [
        columns.map(({ label }) => ({ value: label, type: String, fontWeight: 'bold' as const })),
        ...(rows as unknown as Array<Record<string, unknown>>).map((row) => columns.map(({ key: column, kind, values }) => exportCell(row[column], kind, values))),
      ]

      try {
        await writeXlsxFile(sheet as never, { rightToLeft } as never).toFile(destination)
      } catch {
        throw new AppError('EXPORT_FAILED')
      }

      await auditRepo(deps.db).record({
        actorId: c.get('actor').id,
        action: 'report.exported',
        details: { key, rows: rows.length },
        occurredAt: deps.clock(),
      })
      return c.json({ rows: rows.length }, 200)
    })
}

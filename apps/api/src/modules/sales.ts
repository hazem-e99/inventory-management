import { createRoute, z } from '@hono/zod-openapi'
import {
  checkoutSchema,
  heldInputSchema,
  heldListSchema,
  heldSaleSchema,
  okSchema,
  posLookupQuerySchema,
  posLookupSchema,
  returnInputSchema,
  salePageSchema,
  saleQuerySchema,
  saleSchema,
  type Actor,
  type HeldSale,
  type Sale,
  type SaleKind,
  type SaleRow,
  type SaleStatus,
  type TenderMethod,
} from '@inv/contracts'
import { auditRepo, newId, salesRepo, shiftsRepo, type Database, type Kysely } from '@inv/db'
import { businessDate, priceSale } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { postReturn, postSale, voidSale, type SaleContext } from './sale-posting'
import { withShortageExplained } from './stock-posting'
import { storeSettings } from './store'

const params = z.object({ id: z.string() })

type SaleHeaderRow = NonNullable<Awaited<ReturnType<ReturnType<typeof salesRepo>['findSale']>>>

function saleHeader(sale: SaleHeaderRow) {
  return {
    id: sale.id,
    kind: sale.kind as SaleKind,
    status: sale.status as SaleStatus,
    number: sale.number,
    returnOfId: sale.return_of,
    returnOfNumber: sale.return_of_number,
    customerId: sale.customer_id,
    customerName: sale.customer_name,
    shiftId: sale.shift_id,
    warehouseId: sale.warehouse_id,
    grossMinor: Number(sale.gross_minor),
    discountMinor: Number(sale.discount_minor),
    taxMinor: Number(sale.tax_minor),
    totalMinor: Number(sale.total_minor),
    tenderedMinor: Number(sale.tendered_minor),
    changeMinor: Number(sale.change_minor),
    notes: sale.notes,
    cashierName: sale.cashier_name,
    createdAt: Number(sale.created_at),
    voidedAt: sale.voided_at === null ? null : Number(sale.voided_at),
  }
}

export async function loadSale(db: Kysely<Database>, id: string): Promise<Sale> {
  const repo = salesRepo(db)
  const sale = await repo.findSale(id)
  if (!sale) throw new AppError('NOT_FOUND')

  const [lines, payments] = await Promise.all([repo.linesOf(id), repo.paymentsOf(id)])
  const lots = await repo.lotsOfLines(lines.map((line) => line.id))

  return {
    ...saleHeader(sale),
    lines: lines.map((line) => ({
      id: line.id,
      variantId: line.variant_id,
      itemName: line.item_name,
      variantLabel: line.label,
      sku: line.sku,
      unitId: line.unit_id,
      qtyMilli: Number(line.qty_milli),
      baseQtyMilli: Number(line.base_qty_milli),
      unitPriceMinor: Number(line.unit_price_minor),
      discountMinor: Number(line.discount_minor),
      taxRateBp: line.tax_rate_bp,
      taxMinor: Number(line.tax_minor),
      totalMinor: Number(line.total_minor),
      serials: line.serials ? (JSON.parse(line.serials) as string[]) : [],
      returnedBaseMilli: Number(line.returned_base_milli),
      refundedMinor: Number(line.refunded_minor),
      lots: lots
        .filter((lot) => lot.sale_line_id === line.id)
        .map((lot) => ({ lotNo: lot.lot_no, expiryDate: lot.expiry_date, qtyMilli: Number(lot.qty_milli) })),
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      method: payment.method as TenderMethod,
      amountMinor: Number(payment.amount_minor),
      reversal: payment.reversal_of !== null,
    })),
  }
}

/** Every drawer movement needs the cashier who is accountable for that drawer right now. */
export async function drawerOf(db: Kysely<Database>, actor: Actor): Promise<string> {
  const shift = await shiftsRepo(db).current()
  if (!shift) throw new AppError('SHIFT_NOT_OPEN')
  if (shift.user_id !== actor.id) throw new AppError('SHIFT_OTHER_USER', { params: { name: shift.user_name } })
  return shift.id
}

export function saleRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('sales.view')]
  const canSell = [...guard, requirePermission('sales.sell')]

  const lookupRoute = createRoute({
    method: 'get',
    path: '/pos/lookup',
    middleware: canSell,
    request: { query: posLookupQuerySchema },
    responses: { 200: jsonOk(posLookupSchema) },
  })

  const checkoutRoute = createRoute({
    method: 'post',
    path: '/sales',
    middleware: canSell,
    request: { body: jsonBody(checkoutSchema) },
    responses: { 200: jsonOk(saleSchema) },
  })

  const listRoute = createRoute({
    method: 'get',
    path: '/sales',
    middleware: canView,
    request: { query: saleQuerySchema },
    responses: { 200: jsonOk(salePageSchema) },
  })

  const readRoute = createRoute({
    method: 'get',
    path: '/sales/{id}',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(saleSchema) },
  })

  const returnRoute = createRoute({
    method: 'post',
    path: '/sales/{id}/return',
    middleware: [...guard, requirePermission('sales.return')],
    request: { params, body: jsonBody(returnInputSchema) },
    responses: { 200: jsonOk(saleSchema) },
  })

  const voidRoute = createRoute({
    method: 'post',
    path: '/sales/{id}/void',
    middleware: [...guard, requirePermission('sales.void')],
    request: { params },
    responses: { 200: jsonOk(saleSchema) },
  })

  const heldListRoute = createRoute({
    method: 'get',
    path: '/held-sales',
    middleware: canSell,
    responses: { 200: jsonOk(heldListSchema) },
  })

  const holdRoute = createRoute({
    method: 'post',
    path: '/held-sales',
    middleware: canSell,
    request: { body: jsonBody(heldInputSchema) },
    responses: { 200: jsonOk(heldSaleSchema) },
  })

  const dropHeldRoute = createRoute({
    method: 'delete',
    path: '/held-sales/{id}',
    middleware: canSell,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  async function saleContext(actor: Actor, warehouseId: string): Promise<SaleContext> {
    const settings = storeSettings(deps.db)
    const { allowNegative } = await settings.stockPolicy()
    const now = deps.clock()
    return {
      actor,
      shiftId: await drawerOf(deps.db, actor),
      warehouseId,
      now,
      today: businessDate(now),
      // Both are needed: the shop must allow it, and this person must be trusted with it.
      allowNegative: allowNegative && actor.permissions.includes('stock.negative'),
    }
  }

  return router()
    .openapi(lookupRoute, async (c) => {
      const { warehouseId } = await storeSettings(deps.db).pos()
      return c.json({ items: await salesRepo(deps.db).posLookup(c.req.valid('query').search, warehouseId) }, 200)
    })
    .openapi(checkoutRoute, async (c) => {
      const input = c.req.valid('json')
      const repeated = await salesRepo(deps.db).findByRequest(input.requestId)
      if (repeated) return c.json(await loadSale(deps.db, repeated.id), 200)

      const { warehouseId } = await storeSettings(deps.db).pos()
      const context = await saleContext(c.get('actor'), warehouseId)
      const id = await withShortageExplained(deps.db, () =>
        deps.db.transaction().execute(async (trx) => {
          const saleId = await postSale(trx, input, context)
          const touched = input.lines.some((line) => line.discountMinor > 0) || (input.discountMinor ?? 0) > 0
          if (touched) {
            await auditRepo(trx).record({
              actorId: context.actor.id,
              action: 'sale.discounted',
              entityType: 'sale',
              entityId: saleId,
              occurredAt: context.now,
            })
          }
          return saleId
        }),
      )
      return c.json(await loadSale(deps.db, id), 200)
    })
    .openapi(listRoute, async (c) => {
      const { limit, cursor, kind, status, customerId, shiftId, search } = c.req.valid('query')
      const { rows, lineCounts, nextCursor } = await salesRepo(deps.db).page({ limit, cursor, kind, status, customerId, shiftId, search })
      const items: SaleRow[] = rows.map((row) => ({ ...saleHeader(row), lineCount: lineCounts.get(row.id) ?? 0 }))
      return c.json({ items, nextCursor }, 200)
    })
    .openapi(readRoute, async (c) => c.json(await loadSale(deps.db, c.req.valid('param').id), 200))
    .openapi(returnRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const repo = salesRepo(deps.db)
      const repeated = await repo.findByRequest(input.requestId)
      if (repeated) return c.json(await loadSale(deps.db, repeated.id), 200)

      const sale = await repo.findSale(id)
      if (!sale) throw new AppError('NOT_FOUND')
      const context = await saleContext(c.get('actor'), sale.warehouse_id)

      const returnId = await deps.db.transaction().execute(async (trx) => {
        const created = await postReturn(trx, sale, input, context)
        await auditRepo(trx).record({
          actorId: context.actor.id,
          action: 'sale.returned',
          entityType: 'sale',
          entityId: sale.id,
          details: { returnId: created },
          occurredAt: context.now,
        })
        return created
      })
      return c.json(await loadSale(deps.db, returnId), 200)
    })
    .openapi(voidRoute, async (c) => {
      const { id } = c.req.valid('param')
      const sale = await salesRepo(deps.db).findSale(id)
      if (!sale) throw new AppError('NOT_FOUND')
      const context = await saleContext(c.get('actor'), sale.warehouse_id)

      await withShortageExplained(deps.db, () =>
        deps.db.transaction().execute(async (trx) => {
          await voidSale(trx, sale, context)
          await auditRepo(trx).record({
            actorId: context.actor.id,
            action: 'sale.voided',
            entityType: 'sale',
            entityId: id,
            details: { number: sale.number },
            occurredAt: context.now,
          })
        }),
      )
      return c.json(await loadSale(deps.db, id), 200)
    })
    .openapi(heldListRoute, async (c) => {
      const rows = await salesRepo(deps.db).listHeld()
      const items: HeldSale[] = rows.map((row) => ({
        ...heldInputSchema.parse(JSON.parse(row.cart)),
        id: row.id,
        label: row.label,
        createdAt: Number(row.created_at),
        totalMinor: Number(row.total_minor),
      }))
      return c.json({ items }, 200)
    })
    .openapi(holdRoute, async (c) => {
      const input = c.req.valid('json')
      const now = deps.clock()
      const id = newId()
      const { totals } = priceSale(
        input.lines.map((line) => ({
          qtyMilli: line.qtyMilli,
          unitPriceMinor: line.unitPriceMinor,
          discountMinor: line.discountMinor,
          taxRateBp: line.item.taxRateBp,
        })),
        input.discountMinor,
      )
      await salesRepo(deps.db).insertHeld({
        id,
        label: input.label ?? null,
        cart: JSON.stringify(input),
        total_minor: totals.totalMinor,
        created_by: c.get('actor').id,
        created_at: now,
      })
      return c.json({ ...input, id, label: input.label ?? null, createdAt: now, totalMinor: totals.totalMinor }, 200)
    })
    .openapi(dropHeldRoute, async (c) => {
      await salesRepo(deps.db).deleteHeld(c.req.valid('param').id)
      return c.json({ ok: true as const }, 200)
    })
}

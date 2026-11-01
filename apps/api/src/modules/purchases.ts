import { createRoute, z } from '@hono/zod-openapi'
import {
  okSchema,
  ORDER_PREFIX,
  orderInputSchema,
  orderPageSchema,
  orderQuerySchema,
  orderSchema,
  PURCHASE_PREFIX,
  purchaseInputSchema,
  purchasePageSchema,
  purchaseQuerySchema,
  purchaseSchema,
  type Actor,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type Purchase,
  type PurchaseKind,
  type PurchaseStatus,
} from '@inv/contracts'
import {
  auditRepo,
  newId,
  nextSequence,
  purchasingRepo,
  stockRepo,
  type Database,
  type Kysely,
  type LedgerContext,
} from '@inv/db'
import { businessDate, receiptValue } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { postPurchase, purchaseAmounts, voidPurchase } from './purchase-posting'
import { baseQuantity, lineField, withShortageExplained } from './stock-posting'
import { storeSettings } from './store'

const params = z.object({ id: z.string() })

const documentNumber = (prefix: string, sequence: number) => `${prefix}-${String(sequence).padStart(6, '0')}`

function orderTotal(lines: ReadonlyArray<{ qty_milli: number; unit_cost_minor: number }>): number {
  return lines.reduce((sum, line) => sum + receiptValue(Number(line.qty_milli), Number(line.unit_cost_minor)), 0)
}

async function loadOrder(db: Kysely<Database>, id: string): Promise<Order> {
  const repo = purchasingRepo(db)
  const order = await repo.findOrder(id)
  if (!order) throw new AppError('NOT_FOUND')
  const lines = await repo.orderLines(id)

  return {
    id: order.id,
    number: order.number,
    status: order.status as OrderStatus,
    supplierId: order.supplier_id,
    supplierName: order.supplier_name,
    warehouseId: order.warehouse_id,
    expectedDate: order.expected_date,
    notes: order.notes,
    createdAt: Number(order.created_at),
    totalMinor: orderTotal(lines),
    lines: lines.map((line) => ({
      id: line.id,
      variantId: line.variant_id,
      productId: line.product_id,
      productName: line.product_name,
      variantLabel: line.label,
      sku: line.sku,
      baseUnitId: line.base_unit_id,
      unitId: line.unit_id,
      trackLots: line.track_lots === 1,
      trackSerials: line.track_serials === 1,
      taxRateBp: line.rate_bp ?? 0,
      qtyMilli: Number(line.qty_milli),
      unitCostMinor: Number(line.unit_cost_minor),
      orderedBaseMilli: Number(line.ordered_base_milli),
      receivedBaseMilli: Number(line.received_base_milli),
    })),
  }
}

async function loadPurchase(db: Kysely<Database>, id: string): Promise<Purchase> {
  const repo = purchasingRepo(db)
  const document = await repo.findDocument(id)
  if (!document) throw new AppError('NOT_FOUND')
  const lines = await repo.linesOf(id)

  return {
    ...purchaseHeader(document, purchaseAmounts(lines)),
    lines: lines.map((line) => ({
      id: line.id,
      variantId: line.variant_id,
      productId: line.product_id,
      productName: line.product_name,
      variantLabel: line.label,
      sku: line.sku,
      baseUnitId: line.base_unit_id,
      unitId: line.unit_id,
      trackLots: line.track_lots === 1,
      trackSerials: line.track_serials === 1,
      qtyMilli: Number(line.qty_milli),
      unitCostMinor: Number(line.unit_cost_minor),
      discountMinor: Number(line.discount_minor),
      taxRateBp: line.tax_rate_bp,
      lotId: line.lot_id,
      lotNo: line.resolved_lot_no ?? line.lot_no,
      expiryDate: line.resolved_expiry_date ?? line.expiry_date,
      serials: line.serials ? (JSON.parse(line.serials) as string[]) : [],
      orderLineId: line.order_line_id,
    })),
  }
}

type PurchaseHeaderRow = NonNullable<Awaited<ReturnType<ReturnType<typeof purchasingRepo>['findDocument']>>>

function purchaseHeader(document: PurchaseHeaderRow, totals: ReturnType<typeof purchaseAmounts>) {
  return {
    id: document.id,
    kind: document.kind as PurchaseKind,
    status: document.status as PurchaseStatus,
    number: document.number,
    supplierId: document.supplier_id,
    supplierName: document.supplier_name,
    warehouseId: document.warehouse_id,
    orderId: document.order_id,
    orderNumber: document.order_number,
    supplierReference: document.supplier_reference,
    notes: document.notes,
    paidMinor: Number(document.paid_minor),
    paymentMethod: document.payment_method as PaymentMethod | null,
    businessDate: document.business_date,
    createdAt: Number(document.created_at),
    ...totals,
  }
}

function toLineRecord(line: z.output<typeof purchaseInputSchema>['lines'][number]) {
  return {
    variant_id: line.variantId,
    unit_id: line.unitId,
    qty_milli: line.qtyMilli,
    unit_cost_minor: line.unitCostMinor,
    discount_minor: line.discountMinor,
    tax_rate_bp: line.taxRateBp,
    lot_id: line.lotId ?? null,
    lot_no: line.lotNo ?? null,
    expiry_date: line.expiryDate ?? null,
    serials: line.serials?.length ? JSON.stringify(line.serials) : null,
    order_line_id: line.orderLineId ?? null,
  }
}

function documentFields(input: z.output<typeof purchaseInputSchema>) {
  return {
    supplier_id: input.supplierId,
    warehouse_id: input.warehouseId,
    order_id: input.orderId ?? null,
    supplier_reference: input.supplierReference ?? null,
    notes: input.notes ?? null,
    paid_minor: input.paidMinor ?? 0,
    payment_method: input.paymentMethod ?? null,
  }
}

export function purchaseRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('purchases.view')]
  const canManage = [...guard, requirePermission('purchases.manage')]
  const canVoid = [...guard, requirePermission('purchases.void')]

  const route = <M extends 'get' | 'post' | 'put' | 'delete', P extends string>(method: M, path: P) => ({ method, path })

  const listOrdersRoute = createRoute({
    ...route('get', '/purchase-orders'),
    middleware: canView,
    request: { query: orderQuerySchema },
    responses: { 200: jsonOk(orderPageSchema) },
  })
  const readOrderRoute = createRoute({
    ...route('get', '/purchase-orders/{id}'),
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(orderSchema) },
  })
  const createOrderRoute = createRoute({
    ...route('post', '/purchase-orders'),
    middleware: canManage,
    request: { body: jsonBody(orderInputSchema) },
    responses: { 200: jsonOk(orderSchema) },
  })
  const updateOrderRoute = createRoute({
    ...route('put', '/purchase-orders/{id}'),
    middleware: canManage,
    request: { params, body: jsonBody(orderInputSchema) },
    responses: { 200: jsonOk(orderSchema) },
  })
  const deleteOrderRoute = createRoute({
    ...route('delete', '/purchase-orders/{id}'),
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })
  const openOrderRoute = createRoute({
    ...route('post', '/purchase-orders/{id}/open'),
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(orderSchema) },
  })
  const cancelOrderRoute = createRoute({
    ...route('post', '/purchase-orders/{id}/cancel'),
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(orderSchema) },
  })

  const listRoute = createRoute({
    ...route('get', '/purchases'),
    middleware: canView,
    request: { query: purchaseQuerySchema },
    responses: { 200: jsonOk(purchasePageSchema) },
  })
  const readRoute = createRoute({
    ...route('get', '/purchases/{id}'),
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(purchaseSchema) },
  })
  const createPurchaseRoute = createRoute({
    ...route('post', '/purchases'),
    middleware: canManage,
    request: { body: jsonBody(purchaseInputSchema) },
    responses: { 200: jsonOk(purchaseSchema) },
  })
  const updateRoute = createRoute({
    ...route('put', '/purchases/{id}'),
    middleware: canManage,
    request: { params, body: jsonBody(purchaseInputSchema) },
    responses: { 200: jsonOk(purchaseSchema) },
  })
  const deleteRoute = createRoute({
    ...route('delete', '/purchases/{id}'),
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })
  const postRoute = createRoute({
    ...route('post', '/purchases/{id}/post'),
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(purchaseSchema) },
  })
  const voidRoute = createRoute({
    ...route('post', '/purchases/{id}/void'),
    middleware: canVoid,
    request: { params },
    responses: { 200: jsonOk(purchaseSchema) },
  })

  async function ledgerContext(documentId: string, kind: string, actor: Actor, number: string | null): Promise<LedgerContext> {
    const now = deps.clock()
    const { allowNegative } = await storeSettings(deps.db).stockPolicy()
    return {
      documentId,
      documentType: kind === 'invoice' ? 'purchase' : 'purchase_return',
      documentNumber: number,
      actorId: actor.id,
      occurredAt: now,
      businessDate: businessDate(now),
      allowNegative: allowNegative && actor.permissions.includes('stock.negative'),
    }
  }

  async function requireDraftOrder(id: string) {
    const order = await purchasingRepo(deps.db).findOrder(id)
    if (!order) throw new AppError('NOT_FOUND')
    if (order.status !== 'draft') throw new AppError('DOCUMENT_NOT_DRAFT')
    return order
  }

  async function requireDraftPurchase(id: string) {
    const document = await purchasingRepo(deps.db).findDocument(id)
    if (!document) throw new AppError('NOT_FOUND')
    if (document.status !== 'draft') throw new AppError('DOCUMENT_NOT_DRAFT')
    return document
  }

  return router()
    .openapi(listOrdersRoute, async (c) => {
      const { limit, cursor, status, supplierId } = c.req.valid('query')
      const { rows, lines, nextCursor } = await purchasingRepo(deps.db).pageOrders({ limit, cursor, status, supplierId })
      return c.json(
        {
          items: rows.map((order) => {
            const own = lines.filter((line) => line.order_id === order.id)
            return {
              id: order.id,
              number: order.number,
              status: order.status as OrderStatus,
              supplierId: order.supplier_id,
              supplierName: order.supplier_name,
              warehouseId: order.warehouse_id,
              expectedDate: order.expected_date,
              notes: order.notes,
              createdAt: Number(order.created_at),
              totalMinor: orderTotal(own),
              lineCount: own.length,
            }
          }),
          nextCursor,
        },
        200,
      )
    })
    .openapi(readOrderRoute, async (c) => c.json(await loadOrder(deps.db, c.req.valid('param').id), 200))
    .openapi(createOrderRoute, async (c) => {
      const input = c.req.valid('json')
      const id = newId()
      await deps.db.transaction().execute(async (trx) => {
        const repo = purchasingRepo(trx)
        await repo.insertOrder({
          id,
          number: null,
          status: 'draft',
          supplier_id: input.supplierId,
          warehouse_id: input.warehouseId,
          expected_date: input.expectedDate ?? null,
          notes: input.notes ?? null,
          created_by: c.get('actor').id,
          created_at: deps.clock(),
        })
        await repo.replaceOrderLines(
          id,
          input.lines.map((line) => ({
            variant_id: line.variantId,
            unit_id: line.unitId,
            qty_milli: line.qtyMilli,
            unit_cost_minor: line.unitCostMinor,
          })),
        )
      })
      return c.json(await loadOrder(deps.db, id), 200)
    })
    .openapi(updateOrderRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      await requireDraftOrder(id)
      await deps.db.transaction().execute(async (trx) => {
        const repo = purchasingRepo(trx)
        await repo.updateOrder(id, {
          supplier_id: input.supplierId,
          warehouse_id: input.warehouseId,
          expected_date: input.expectedDate ?? null,
          notes: input.notes ?? null,
        })
        await repo.replaceOrderLines(
          id,
          input.lines.map((line) => ({
            variant_id: line.variantId,
            unit_id: line.unitId,
            qty_milli: line.qtyMilli,
            unit_cost_minor: line.unitCostMinor,
          })),
        )
      })
      return c.json(await loadOrder(deps.db, id), 200)
    })
    .openapi(deleteOrderRoute, async (c) => {
      const { id } = c.req.valid('param')
      await requireDraftOrder(id)
      await purchasingRepo(deps.db).deleteOrder(id)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(openOrderRoute, async (c) => {
      const { id } = c.req.valid('param')
      await requireDraftOrder(id)
      const now = deps.clock()

      await deps.db.transaction().execute(async (trx) => {
        const repo = purchasingRepo(trx)
        const lines = await repo.orderLines(id)
        if (lines.length === 0) throw new AppError('DOCUMENT_EMPTY')

        const rules = await stockRepo(trx).variantRules([...new Set(lines.map((line) => line.variant_id))])
        for (const [index, line] of lines.entries()) {
          if (Number(line.qty_milli) <= 0) throw lineField(index, 'qtyMilli', 'QUANTITY_INVALID')
          const ordered = baseQuantity(line, rules.get(line.variant_id)!, index)
          await repo.updateOrderLine(line.id, { ordered_base_milli: ordered })
        }

        const number = documentNumber(ORDER_PREFIX, await nextSequence(trx, 'document:order'))
        await repo.updateOrder(id, { status: 'open', number })
        await auditRepo(trx).record({
          actorId: c.get('actor').id,
          action: 'purchase_order.opened',
          entityType: 'purchase_order',
          entityId: id,
          details: { number },
          occurredAt: now,
        })
      })
      return c.json(await loadOrder(deps.db, id), 200)
    })
    .openapi(cancelOrderRoute, async (c) => {
      const { id } = c.req.valid('param')
      const repo = purchasingRepo(deps.db)
      const order = await repo.findOrder(id)
      if (!order) throw new AppError('NOT_FOUND')
      if (order.status !== 'open' && order.status !== 'partial') throw new AppError('ORDER_NOT_OPEN')

      await repo.updateOrder(id, { status: 'cancelled' })
      await auditRepo(deps.db).record({
        actorId: c.get('actor').id,
        action: 'purchase_order.cancelled',
        entityType: 'purchase_order',
        entityId: id,
        occurredAt: deps.clock(),
      })
      return c.json(await loadOrder(deps.db, id), 200)
    })
    .openapi(listRoute, async (c) => {
      const { limit, cursor, kind, status, supplierId } = c.req.valid('query')
      const { rows, lines, nextCursor } = await purchasingRepo(deps.db).pageDocuments({ limit, cursor, kind, status, supplierId })
      return c.json(
        {
          items: rows.map((document) => {
            const own = lines.filter((line) => line.document_id === document.id)
            return { ...purchaseHeader(document, purchaseAmounts(own)), lineCount: own.length }
          }),
          nextCursor,
        },
        200,
      )
    })
    .openapi(readRoute, async (c) => c.json(await loadPurchase(deps.db, c.req.valid('param').id), 200))
    .openapi(createPurchaseRoute, async (c) => {
      const input = c.req.valid('json')
      const id = newId()
      await deps.db.transaction().execute(async (trx) => {
        const repo = purchasingRepo(trx)
        await repo.insertDocument({
          ...documentFields(input),
          id,
          kind: input.kind,
          status: 'draft',
          number: null,
          business_date: null,
          created_by: c.get('actor').id,
          created_at: deps.clock(),
          posted_at: null,
          voided_at: null,
        })
        await repo.replaceLines(id, input.lines.map(toLineRecord))
      })
      return c.json(await loadPurchase(deps.db, id), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      await requireDraftPurchase(id)
      await deps.db.transaction().execute(async (trx) => {
        const repo = purchasingRepo(trx)
        await repo.updateDocument(id, documentFields(input))
        await repo.replaceLines(id, input.lines.map(toLineRecord))
      })
      return c.json(await loadPurchase(deps.db, id), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid('param')
      await requireDraftPurchase(id)
      await purchasingRepo(deps.db).deleteDocument(id)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(postRoute, async (c) => {
      const { id } = c.req.valid('param')
      const actor = c.get('actor')
      const document = await requireDraftPurchase(id)
      const base = await ledgerContext(id, document.kind, actor, null)
      const { expiryRequired } = await storeSettings(deps.db).features()
      const kind = document.kind as PurchaseKind

      await withShortageExplained(deps.db, () =>
        deps.db.transaction().execute(async (trx) => {
          // Numbered first so every movement carries it. A rollback gives the number back.
          const number = documentNumber(PURCHASE_PREFIX[kind], await nextSequence(trx, `document:purchase_${kind}`))
          const context = { ...base, documentNumber: number }

          await postPurchase(trx, document, {
            now: context.occurredAt,
            today: context.businessDate,
            expiryRequired,
            context,
          })
          await purchasingRepo(trx).updateDocument(id, {
            status: 'posted',
            number,
            business_date: context.businessDate,
            posted_at: context.occurredAt,
          })
          await auditRepo(trx).record({
            actorId: actor.id,
            action: 'purchase.posted',
            entityType: 'purchase',
            entityId: id,
            details: { kind, number },
            occurredAt: context.occurredAt,
          })
        }),
      )
      return c.json(await loadPurchase(deps.db, id), 200)
    })
    .openapi(voidRoute, async (c) => {
      const { id } = c.req.valid('param')
      const actor = c.get('actor')
      const document = await purchasingRepo(deps.db).findDocument(id)
      if (!document) throw new AppError('NOT_FOUND')
      if (document.status !== 'posted') throw new AppError('DOCUMENT_NOT_POSTED')

      const context = await ledgerContext(id, document.kind, actor, document.number)

      await withShortageExplained(deps.db, () =>
        deps.db.transaction().execute(async (trx) => {
          await voidPurchase(trx, document, context)
          await purchasingRepo(trx).updateDocument(id, { status: 'voided', voided_at: context.occurredAt })
          await auditRepo(trx).record({
            actorId: actor.id,
            action: 'purchase.voided',
            entityType: 'purchase',
            entityId: id,
            details: { number: document.number },
            occurredAt: context.occurredAt,
          })
        }),
      )
      return c.json(await loadPurchase(deps.db, id), 200)
    })
}

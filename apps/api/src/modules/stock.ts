import { createRoute, z } from '@hono/zod-openapi'
import {
  countSheetInputSchema,
  okSchema,
  pageQuerySchema,
  productStockSchema,
  STOCK_DOCUMENT_PREFIX,
  stockDocumentInputSchema,
  stockDocumentPageSchema,
  stockDocumentQuerySchema,
  stockDocumentSchema,
  stockMovementPageSchema,
  stockPickListSchema,
  stockPickQuerySchema,
  type Actor,
  type AdjustmentReason,
  type MovementSource,
  type StockDocument,
  type StockDocumentKind,
  type StockDocumentRow,
  type StockDocumentStatus,
} from '@inv/contracts'
import {
  auditRepo,
  newId,
  nextSequence,
  stockLedger,
  stockRepo,
  type Database,
  type Kysely,
  type LedgerContext,
  type StockDocumentRecord,
} from '@inv/db'
import { averageCostMinor, businessDate } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { storeSettings } from './store'
import { postDocument, withShortageExplained } from './stock-posting'

const params = z.object({ id: z.string() })

function toRow(document: StockDocumentRecord, createdBy: string | null): Omit<StockDocumentRow, 'lineCount'> {
  return {
    id: document.id,
    kind: document.kind as StockDocumentKind,
    status: document.status as StockDocumentStatus,
    number: document.number,
    warehouseId: document.warehouse_id,
    toWarehouseId: document.to_warehouse_id,
    reason: document.reason as AdjustmentReason | null,
    notes: document.notes,
    businessDate: document.business_date,
    createdBy,
    createdAt: Number(document.created_at),
    postedAt: document.posted_at === null ? null : Number(document.posted_at),
    voidedAt: document.voided_at === null ? null : Number(document.voided_at),
  }
}

async function loadDocument(db: Kysely<Database>, id: string): Promise<StockDocument> {
  const repo = stockRepo(db)
  const document = await repo.findDocument(id)
  if (!document) throw new AppError('NOT_FOUND')

  const lines = await repo.linesOf(id)
  const author = document.created_by
    ? await db.selectFrom('users').select('full_name').where('id', '=', document.created_by).executeTakeFirst()
    : undefined

  return {
    ...toRow(document, author?.full_name ?? null),
    lines: lines.map((line) => ({
      id: line.id,
      variantId: line.variant_id,
      productId: line.product_id,
      productName: line.product_name,
      variantLabel: line.label,
      sku: line.sku,
      baseUnitId: line.base_unit_id,
      unitId: line.unit_id,
      qtyMilli: Number(line.qty_milli),
      lotId: line.lot_id,
      lotNo: line.resolved_lot_no ?? line.lot_no,
      expiryDate: line.resolved_expiry_date ?? line.expiry_date,
      unitCostMinor: line.unit_cost_minor === null ? null : Number(line.unit_cost_minor),
      expectedMilli: line.expected_milli === null ? null : Number(line.expected_milli),
      trackLots: line.track_lots === 1,
    })),
  }
}

export function stockRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('stock.view')]
  const canManage = [...guard, requirePermission('stock.manage')]
  const canVoid = [...guard, requirePermission('stock.void')]

  const listRoute = createRoute({
    method: 'get',
    path: '/stock/documents',
    middleware: canView,
    request: { query: stockDocumentQuerySchema },
    responses: { 200: jsonOk(stockDocumentPageSchema) },
  })

  const readRoute = createRoute({
    method: 'get',
    path: '/stock/documents/{id}',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(stockDocumentSchema) },
  })

  const createDocumentRoute = createRoute({
    method: 'post',
    path: '/stock/documents',
    middleware: canManage,
    request: { body: jsonBody(stockDocumentInputSchema) },
    responses: { 200: jsonOk(stockDocumentSchema) },
  })

  const countSheetRoute = createRoute({
    method: 'post',
    path: '/stock/documents/count-sheet',
    middleware: canManage,
    request: { body: jsonBody(countSheetInputSchema) },
    responses: { 200: jsonOk(stockDocumentSchema) },
  })

  const updateRoute = createRoute({
    method: 'put',
    path: '/stock/documents/{id}',
    middleware: canManage,
    request: { params, body: jsonBody(stockDocumentInputSchema) },
    responses: { 200: jsonOk(stockDocumentSchema) },
  })

  const deleteRoute = createRoute({
    method: 'delete',
    path: '/stock/documents/{id}',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  const postRoute = createRoute({
    method: 'post',
    path: '/stock/documents/{id}/post',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(stockDocumentSchema) },
  })

  const voidRoute = createRoute({
    method: 'post',
    path: '/stock/documents/{id}/void',
    middleware: canVoid,
    request: { params },
    responses: { 200: jsonOk(stockDocumentSchema) },
  })

  const pickRoute = createRoute({
    method: 'get',
    path: '/stock/pick',
    middleware: canView,
    request: { query: stockPickQuerySchema },
    responses: { 200: jsonOk(stockPickListSchema) },
  })

  const productStockRoute = createRoute({
    method: 'get',
    path: '/products/{id}/stock',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(productStockSchema) },
  })

  const movementsRoute = createRoute({
    method: 'get',
    path: '/products/{id}/movements',
    middleware: canView,
    request: { params, query: pageQuerySchema },
    responses: { 200: jsonOk(stockMovementPageSchema) },
  })

  async function ledgerContext(
    documentId: string,
    documentType: string,
    actor: Actor,
    documentNumber: string | null,
  ): Promise<LedgerContext> {
    const now = deps.clock()
    const { allowNegative } = await storeSettings(deps.db).stockPolicy()
    return {
      documentId,
      documentType,
      documentNumber,
      actorId: actor.id,
      occurredAt: now,
      businessDate: businessDate(now),
      // Both are needed: the shop must allow it, and this person must be trusted with it.
      allowNegative: allowNegative && actor.permissions.includes('stock.negative'),
    }
  }

  return router()
    .openapi(listRoute, async (c) => {
      const { limit, cursor, kind, status } = c.req.valid('query')
      const { rows, nextCursor } = await stockRepo(deps.db).pageDocuments({ limit, cursor, kind, status })
      return c.json(
        {
          items: rows.map((row) => ({
            ...toRow(row, row.created_by_name),
            lineCount: Number(row.line_count),
          })),
          nextCursor,
        },
        200,
      )
    })
    .openapi(countSheetRoute, async (c) => {
      const { warehouseId, categoryId } = c.req.valid('json')
      const id = newId()
      const now = deps.clock()

      await deps.db.transaction().execute(async (trx) => {
        const inner = stockRepo(trx)
        await inner.insertDocument({
          id,
          kind: 'count',
          status: 'draft',
          number: null,
          warehouse_id: warehouseId,
          to_warehouse_id: null,
          reason: null,
          notes: null,
          business_date: null,
          created_by: c.get('actor').id,
          created_at: now,
          posted_at: null,
          voided_at: null,
        })
        const sheet = await inner.countSheet(warehouseId, categoryId)
        await inner.replaceLines(
          id,
          sheet.map((row) => ({
            variant_id: row.variant_id,
            unit_id: row.base_unit_id,
            qty_milli: Number(row.qty_milli),
            lot_id: row.lot_id,
            lot_no: null,
            expiry_date: null,
            unit_cost_minor: null,
            expected_milli: Number(row.qty_milli),
          })),
        )
      })
      return c.json(await loadDocument(deps.db, id), 200)
    })
    .openapi(readRoute, async (c) => c.json(await loadDocument(deps.db, c.req.valid('param').id), 200))
    .openapi(createDocumentRoute, async (c) => {
      const input = c.req.valid('json')
      const id = newId()
      const now = deps.clock()

      await deps.db.transaction().execute(async (trx) => {
        const repo = stockRepo(trx)
        await repo.insertDocument({
          id,
          kind: input.kind,
          status: 'draft',
          number: null,
          warehouse_id: input.warehouseId,
          to_warehouse_id: input.toWarehouseId ?? null,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          business_date: null,
          created_by: c.get('actor').id,
          created_at: now,
          posted_at: null,
          voided_at: null,
        })
        await repo.replaceLines(id, input.lines.map(toLineRecord))
      })
      return c.json(await loadDocument(deps.db, id), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const repo = stockRepo(deps.db)
      const document = await repo.findDocument(id)
      if (!document) throw new AppError('NOT_FOUND')
      if (document.status !== 'draft') throw new AppError('DOCUMENT_NOT_DRAFT')

      await deps.db.transaction().execute(async (trx) => {
        const inner = stockRepo(trx)
        await inner.updateDocument(id, {
          warehouse_id: input.warehouseId,
          to_warehouse_id: input.toWarehouseId ?? null,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
        })
        await inner.replaceLines(id, input.lines.map(toLineRecord))
      })
      return c.json(await loadDocument(deps.db, id), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid('param')
      const repo = stockRepo(deps.db)
      const document = await repo.findDocument(id)
      if (!document) throw new AppError('NOT_FOUND')
      // Only a draft can vanish: a posted document stays in history and is voided instead.
      if (document.status !== 'draft') throw new AppError('DOCUMENT_NOT_DRAFT')
      await repo.deleteDocument(id)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(postRoute, async (c) => {
      const { id } = c.req.valid('param')
      const actor = c.get('actor')
      const document = await stockRepo(deps.db).findDocument(id)
      if (!document) throw new AppError('NOT_FOUND')
      if (document.status !== 'draft') throw new AppError('DOCUMENT_NOT_DRAFT')

      const base = await ledgerContext(id, document.kind, actor, null)
      const { expiryRequired } = await storeSettings(deps.db).features()

      await withShortageExplained(deps.db, () =>
        deps.db.transaction().execute(async (trx) => {
          // Numbered first so every movement carries it. A rollback gives the number back.
          const kind = document.kind as StockDocumentKind
          const sequence = await nextSequence(trx, `document:${kind}`)
          const number = `${STOCK_DOCUMENT_PREFIX[kind]}-${String(sequence).padStart(6, '0')}`
          const context = { ...base, documentNumber: number }

          await postDocument(trx, document, {
            now: context.occurredAt,
            today: context.businessDate,
            expiryRequired,
            context,
          })

          await stockRepo(trx).updateDocument(id, {
            status: 'posted',
            number,
            business_date: context.businessDate,
            posted_at: context.occurredAt,
          })
          await auditRepo(trx).record({
            actorId: actor.id,
            action: 'stock.posted',
            entityType: 'stock_document',
            entityId: id,
            details: { kind },
            occurredAt: context.occurredAt,
          })
        }),
      )
      return c.json(await loadDocument(deps.db, id), 200)
    })
    .openapi(voidRoute, async (c) => {
      const { id } = c.req.valid('param')
      const actor = c.get('actor')
      const document = await stockRepo(deps.db).findDocument(id)
      if (!document) throw new AppError('NOT_FOUND')
      if (document.status !== 'posted') throw new AppError('DOCUMENT_NOT_POSTED')

      const context = await ledgerContext(id, document.kind, actor, document.number)

      await withShortageExplained(deps.db, () =>
        deps.db.transaction().execute(async (trx) => {
          await stockLedger(trx, context).reverse(id)
          await stockRepo(trx).updateDocument(id, { status: 'voided', voided_at: context.occurredAt })
          await auditRepo(trx).record({
            actorId: actor.id,
            action: 'stock.voided',
            entityType: 'stock_document',
            entityId: id,
            details: { number: document.number },
            occurredAt: context.occurredAt,
          })
        }),
      )
      return c.json(await loadDocument(deps.db, id), 200)
    })
    .openapi(pickRoute, async (c) => {
      const { search, warehouseId } = c.req.valid('query')
      return c.json({ items: await stockRepo(deps.db).pickVariants(search ?? '', warehouseId) }, 200)
    })
    .openapi(productStockRoute, async (c) => {
      const stock = await stockRepo(deps.db).productStock(c.req.valid('param').id)
      if (!stock) throw new AppError('NOT_FOUND')

      return c.json(
        {
          productId: stock.product.id,
          productName: stock.product.name,
          baseUnitId: stock.product.base_unit_id,
          variants: stock.variants.map((variant) => {
            const onHandMilli = Number(variant.qty_milli ?? 0)
            const valueMinor = Number(variant.value_minor ?? 0)
            return {
              variantId: variant.id,
              label: variant.label,
              sku: variant.sku,
              onHandMilli,
              valueMinor,
              averageCostMinor: averageCostMinor(onHandMilli, valueMinor),
              balances: stock.balances
                .filter((balance) => balance.variant_id === variant.id)
                .map((balance) => ({
                  warehouseId: balance.warehouse_id,
                  warehouseName: balance.warehouse_name,
                  lotId: balance.lot_id,
                  lotNo: balance.lot_no,
                  expiryDate: balance.expiry_date,
                  qtyMilli: Number(balance.qty_milli),
                })),
            }
          }),
        },
        200,
      )
    })
    .openapi(movementsRoute, async (c) => {
      const { id } = c.req.valid('param')
      const { limit, cursor } = c.req.valid('query')
      const { rows, nextCursor } = await stockRepo(deps.db).movementPage(id, limit, cursor)
      return c.json(
        {
          items: rows.map((row) => ({
            id: row.id,
            occurredAt: Number(row.occurred_at),
            variantLabel: row.label,
            warehouseName: row.warehouse_name,
            lotNo: row.lot_no,
            qtyMilli: Number(row.qty_milli),
            valueMinor: Number(row.value_minor),
            documentId: row.document_id,
            documentKind: row.document_type as MovementSource,
            documentNumber: row.document_number,
            reversal: row.reversal_of !== null,
            actorName: row.full_name,
          })),
          nextCursor,
        },
        200,
      )
    })
}

function toLineRecord(line: z.output<typeof stockDocumentInputSchema>['lines'][number]) {
  return {
    variant_id: line.variantId,
    unit_id: line.unitId,
    qty_milli: line.qtyMilli,
    lot_id: line.lotId ?? null,
    lot_no: line.lotNo ?? null,
    expiry_date: line.expiryDate ?? null,
    unit_cost_minor: line.unitCostMinor ?? null,
    expected_milli: null,
  }
}

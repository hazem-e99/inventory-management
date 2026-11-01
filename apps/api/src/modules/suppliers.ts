import { createRoute, z } from '@hono/zod-openapi'
import {
  okSchema,
  pageQuerySchema,
  PAYMENT_PREFIX,
  paymentInputSchema,
  paymentSchema,
  statementPageSchema,
  supplierInputSchema,
  supplierPageSchema,
  supplierQuerySchema,
  supplierSchema,
  type LedgerSource,
  type Payment,
  type PaymentMethod,
  type Supplier,
} from '@inv/contracts'
import {
  auditRepo,
  newId,
  nextSequence,
  supplierLedger,
  suppliersRepo,
  type SupplierRecord,
} from '@inv/db'
import { buildSearchText, businessDate, searchTerms } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'

const params = z.object({ id: z.string() })

const toSupplier = (row: SupplierRecord): Supplier => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  address: row.address,
  taxNumber: row.tax_number,
  notes: row.notes,
  balanceMinor: Number(row.balance_minor),
  archived: row.archived_at !== null,
})

function supplierFields(input: z.output<typeof supplierInputSchema>) {
  return {
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    tax_number: input.taxNumber ?? null,
    notes: input.notes ?? null,
    search_text: buildSearchText([input.name, input.phone]),
  }
}

export function supplierRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('purchases.view')]
  const canManage = [...guard, requirePermission('suppliers.manage')]
  const canPay = [...guard, requirePermission('suppliers.pay')]

  const listRoute = createRoute({
    method: 'get',
    path: '/suppliers',
    middleware: canView,
    request: { query: supplierQuerySchema },
    responses: { 200: jsonOk(supplierPageSchema) },
  })

  const readRoute = createRoute({
    method: 'get',
    path: '/suppliers/{id}',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(supplierSchema) },
  })

  const createSupplierRoute = createRoute({
    method: 'post',
    path: '/suppliers',
    middleware: canManage,
    request: { body: jsonBody(supplierInputSchema) },
    responses: { 200: jsonOk(supplierSchema) },
  })

  const updateRoute = createRoute({
    method: 'put',
    path: '/suppliers/{id}',
    middleware: canManage,
    request: { params, body: jsonBody(supplierInputSchema) },
    responses: { 200: jsonOk(supplierSchema) },
  })

  const archiveRoute = createRoute({
    method: 'post',
    path: '/suppliers/{id}/archive',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  const restoreRoute = createRoute({
    method: 'post',
    path: '/suppliers/{id}/restore',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  const statementRoute = createRoute({
    method: 'get',
    path: '/suppliers/{id}/statement',
    middleware: canView,
    request: { params, query: pageQuerySchema },
    responses: { 200: jsonOk(statementPageSchema) },
  })

  const payRoute = createRoute({
    method: 'post',
    path: '/suppliers/{id}/payments',
    middleware: canPay,
    request: { params, body: jsonBody(paymentInputSchema) },
    responses: { 200: jsonOk(paymentSchema) },
  })

  const voidPaymentRoute = createRoute({
    method: 'post',
    path: '/supplier-payments/{id}/void',
    middleware: canPay,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  async function setArchived(id: string, archived: boolean) {
    const repo = suppliersRepo(deps.db)
    if (!(await repo.find(id))) throw new AppError('NOT_FOUND')
    const now = deps.clock()
    await repo.update(id, { archived_at: archived ? now : null, updated_at: now })
  }

  return router()
    .openapi(listRoute, async (c) => {
      const { limit, cursor, search, archived } = c.req.valid('query')
      const { rows, nextCursor } = await suppliersRepo(deps.db).page({
        terms: searchTerms(search ?? ''),
        archived: archived === 'true',
        limit,
        cursor,
      })
      return c.json({ items: rows.map(toSupplier), nextCursor }, 200)
    })
    .openapi(readRoute, async (c) => {
      const row = await suppliersRepo(deps.db).find(c.req.valid('param').id)
      if (!row) throw new AppError('NOT_FOUND')
      return c.json(toSupplier(row), 200)
    })
    .openapi(createSupplierRoute, async (c) => {
      const input = c.req.valid('json')
      const id = newId()
      const now = deps.clock()

      await deps.db.transaction().execute(async (trx) => {
        await suppliersRepo(trx).insert({
          ...supplierFields(input),
          id,
          archived_at: null,
          created_at: now,
          updated_at: now,
        })
        if (input.openingBalanceMinor) {
          await supplierLedger(trx, {
            source: 'opening',
            documentId: id,
            documentNumber: null,
            actorId: c.get('actor').id,
            occurredAt: now,
            businessDate: businessDate(now),
          }).post(id, input.openingBalanceMinor)
        }
        await auditRepo(trx).record({
          actorId: c.get('actor').id,
          action: 'supplier.created',
          entityType: 'supplier',
          entityId: id,
          details: { name: input.name },
          occurredAt: now,
        })
      })

      const created = await suppliersRepo(deps.db).find(id)
      return c.json(toSupplier(created!), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const repo = suppliersRepo(deps.db)
      if (!(await repo.find(id))) throw new AppError('NOT_FOUND')

      await repo.update(id, { ...supplierFields(input), updated_at: deps.clock() })
      const updated = await repo.find(id)
      return c.json(toSupplier(updated!), 200)
    })
    .openapi(archiveRoute, async (c) => {
      await setArchived(c.req.valid('param').id, true)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(restoreRoute, async (c) => {
      await setArchived(c.req.valid('param').id, false)
      return c.json({ ok: true as const }, 200)
    })
    .openapi(statementRoute, async (c) => {
      const { id } = c.req.valid('param')
      const { limit, cursor } = c.req.valid('query')
      const { rows, nextCursor } = await suppliersRepo(deps.db).statement(id, limit, cursor)
      return c.json(
        {
          items: rows.map((row) => ({
            id: row.id,
            occurredAt: Number(row.occurred_at),
            source: row.source as LedgerSource,
            documentId: row.document_id,
            documentNumber: row.document_number,
            amountMinor: Number(row.amount_minor),
            balanceMinor: Number(row.balance_after_minor),
            reversal: row.reversal_of !== null,
            purchaseId: row.purchase_id ?? null,
          })),
          nextCursor,
        },
        200,
      )
    })
    .openapi(payRoute, async (c) => {
      const { id: supplierId } = c.req.valid('param')
      const input = c.req.valid('json')
      const actor = c.get('actor')
      if (!(await suppliersRepo(deps.db).find(supplierId))) throw new AppError('NOT_FOUND')

      const id = newId()
      const now = deps.clock()

      const payment = await deps.db.transaction().execute(async (trx): Promise<Payment> => {
        const number = `${PAYMENT_PREFIX}-${String(await nextSequence(trx, 'document:payment')).padStart(6, '0')}`
        await suppliersRepo(trx).insertPayment({
          id,
          number,
          supplier_id: supplierId,
          amount_minor: input.amountMinor,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          status: 'posted',
          purchase_id: null,
          created_by: actor.id,
          created_at: now,
          voided_at: null,
        })
        await supplierLedger(trx, {
          source: 'payment',
          documentId: id,
          documentNumber: number,
          actorId: actor.id,
          occurredAt: now,
          businessDate: businessDate(now),
        }).post(supplierId, -input.amountMinor)
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'supplier.paid',
          entityType: 'supplier',
          entityId: supplierId,
          details: { number, amountMinor: input.amountMinor },
          occurredAt: now,
        })
        return {
          id,
          number,
          supplierId,
          amountMinor: input.amountMinor,
          method: input.method as PaymentMethod,
          reference: input.reference ?? null,
          status: 'posted',
          createdAt: now,
        }
      })
      return c.json(payment, 200)
    })
    .openapi(voidPaymentRoute, async (c) => {
      const { id } = c.req.valid('param')
      const actor = c.get('actor')
      const payment = await suppliersRepo(deps.db).findPayment(id)
      if (!payment) throw new AppError('NOT_FOUND')
      if (payment.status !== 'posted') throw new AppError('PAYMENT_ALREADY_VOIDED')
      if (payment.purchase_id) throw new AppError('PAYMENT_BELONGS_TO_PURCHASE')

      const now = deps.clock()
      await deps.db.transaction().execute(async (trx) => {
        await supplierLedger(trx, {
          source: 'payment',
          documentId: id,
          documentNumber: payment.number,
          actorId: actor.id,
          occurredAt: now,
          businessDate: businessDate(now),
        }).reverse(id)
        await suppliersRepo(trx).voidPayment(id, now)
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'supplier.payment_voided',
          entityType: 'supplier',
          entityId: payment.supplier_id,
          details: { number: payment.number },
          occurredAt: now,
        })
      })
      return c.json({ ok: true as const }, 200)
    })
}

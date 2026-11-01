import { createRoute, z } from '@hono/zod-openapi'
import {
  RECEIPT_PREFIX,
  customerInputSchema,
  customerPageSchema,
  customerQuerySchema,
  customerSchema,
  customerStatementSchema,
  okSchema,
  pageQuerySchema,
  receiptInputSchema,
  receiptSchema,
  type Customer,
  type CustomerLedgerSource,
  type Receipt,
  type ReceiptMethod,
} from '@inv/contracts'
import {
  auditRepo,
  customerLedger,
  customersRepo,
  newId,
  nextSequence,
  shiftsRepo,
  type CustomerRecord,
} from '@inv/db'
import { buildSearchText, businessDate, searchTerms } from '@inv/domain'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { drawerOf } from './sales'

const params = z.object({ id: z.string() })

const toCustomer = (row: CustomerRecord): Customer => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  address: row.address,
  notes: row.notes,
  creditLimitMinor: row.credit_limit_minor === null ? null : Number(row.credit_limit_minor),
  balanceMinor: Number(row.balance_minor),
  archived: row.archived_at !== null,
})

function customerFields(input: z.output<typeof customerInputSchema>) {
  return {
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    credit_limit_minor: input.creditLimitMinor ?? null,
    search_text: buildSearchText([input.name, input.phone]),
  }
}

export function customerRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('sales.view')]
  const canManage = [...guard, requirePermission('customers.manage')]
  const canCollect = [...guard, requirePermission('customers.collect')]

  const listRoute = createRoute({
    method: 'get',
    path: '/customers',
    middleware: canView,
    request: { query: customerQuerySchema },
    responses: { 200: jsonOk(customerPageSchema) },
  })

  const readRoute = createRoute({
    method: 'get',
    path: '/customers/{id}',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(customerSchema) },
  })

  // A cashier meets new customers at the counter, so adding one is part of selling.
  const createCustomerRoute = createRoute({
    method: 'post',
    path: '/customers',
    middleware: [...guard, requirePermission('sales.sell')],
    request: { body: jsonBody(customerInputSchema) },
    responses: { 200: jsonOk(customerSchema) },
  })

  const updateRoute = createRoute({
    method: 'put',
    path: '/customers/{id}',
    middleware: canManage,
    request: { params, body: jsonBody(customerInputSchema) },
    responses: { 200: jsonOk(customerSchema) },
  })

  const archiveRoute = createRoute({
    method: 'post',
    path: '/customers/{id}/archive',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  const restoreRoute = createRoute({
    method: 'post',
    path: '/customers/{id}/restore',
    middleware: canManage,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  const statementRoute = createRoute({
    method: 'get',
    path: '/customers/{id}/statement',
    middleware: canView,
    request: { params, query: pageQuerySchema },
    responses: { 200: jsonOk(customerStatementSchema) },
  })

  const collectRoute = createRoute({
    method: 'post',
    path: '/customers/{id}/receipts',
    middleware: canCollect,
    request: { params, body: jsonBody(receiptInputSchema) },
    responses: { 200: jsonOk(receiptSchema) },
  })

  const voidReceiptRoute = createRoute({
    method: 'post',
    path: '/customer-receipts/{id}/void',
    middleware: canCollect,
    request: { params },
    responses: { 200: jsonOk(okSchema) },
  })

  async function setArchived(id: string, archived: boolean) {
    const repo = customersRepo(deps.db)
    if (!(await repo.find(id))) throw new AppError('NOT_FOUND')
    const now = deps.clock()
    await repo.update(id, { archived_at: archived ? now : null, updated_at: now })
  }

  return router()
    .openapi(listRoute, async (c) => {
      const { limit, cursor, search, archived } = c.req.valid('query')
      const { rows, nextCursor } = await customersRepo(deps.db).page({
        terms: searchTerms(search ?? ''),
        archived: archived === 'true',
        limit,
        cursor,
      })
      return c.json({ items: rows.map(toCustomer), nextCursor }, 200)
    })
    .openapi(readRoute, async (c) => {
      const customer = await customersRepo(deps.db).find(c.req.valid('param').id)
      if (!customer) throw new AppError('NOT_FOUND')
      return c.json(toCustomer(customer), 200)
    })
    .openapi(createCustomerRoute, async (c) => {
      const input = c.req.valid('json')
      const actor = c.get('actor')
      const now = deps.clock()
      const id = newId()
      const opening = input.openingBalanceMinor ?? 0

      const created = await deps.db.transaction().execute(async (trx) => {
        const repo = customersRepo(trx)
        await repo.insert({ ...customerFields(input), id, archived_at: null, created_at: now, updated_at: now })
        if (opening !== 0) {
          await customerLedger(trx, {
            source: 'opening',
            documentId: id,
            documentNumber: null,
            actorId: actor.id,
            occurredAt: now,
            businessDate: businessDate(now),
          }).post(id, opening)
        }
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'customer.created',
          entityType: 'customer',
          entityId: id,
          details: { name: input.name },
          occurredAt: now,
        })
        return repo.find(id)
      })
      return c.json(toCustomer(created!), 200)
    })
    .openapi(updateRoute, async (c) => {
      const { id } = c.req.valid('param')
      const repo = customersRepo(deps.db)
      if (!(await repo.find(id))) throw new AppError('NOT_FOUND')
      await repo.update(id, { ...customerFields(c.req.valid('json')), updated_at: deps.clock() })
      return c.json(toCustomer((await repo.find(id))!), 200)
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
      const { rows, nextCursor } = await customersRepo(deps.db).statement(id, limit, cursor)
      return c.json(
        {
          items: rows.map((row) => ({
            id: row.id,
            occurredAt: Number(row.occurred_at),
            source: row.source as CustomerLedgerSource,
            documentId: row.document_id,
            documentNumber: row.document_number,
            amountMinor: Number(row.amount_minor),
            balanceMinor: Number(row.balance_after_minor),
            reversal: row.reversal_of !== null,
          })),
          nextCursor,
        },
        200,
      )
    })
    .openapi(collectRoute, async (c) => {
      const { id: customerId } = c.req.valid('param')
      const input = c.req.valid('json')
      const actor = c.get('actor')
      if (!(await customersRepo(deps.db).find(customerId))) throw new AppError('NOT_FOUND')
      const shiftId = await drawerOf(deps.db, actor)

      const now = deps.clock()
      const id = newId()
      const receipt = await deps.db.transaction().execute(async (trx): Promise<Receipt> => {
        const number = `${RECEIPT_PREFIX}-${String(await nextSequence(trx, 'document:receipt')).padStart(6, '0')}`
        await customersRepo(trx).insertReceipt({
          id,
          number,
          customer_id: customerId,
          shift_id: shiftId,
          amount_minor: input.amountMinor,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          status: 'posted',
          created_by: actor.id,
          created_at: now,
          voided_at: null,
        })
        await customerLedger(trx, {
          source: 'receipt',
          documentId: id,
          documentNumber: number,
          actorId: actor.id,
          occurredAt: now,
          businessDate: businessDate(now),
        }).post(customerId, -input.amountMinor)
        if (input.method === 'cash') {
          await shiftsRepo(trx).insertMovement({
            shift_id: shiftId,
            kind: 'receipt',
            amount_minor: input.amountMinor,
            reason: number,
            document_id: id,
            actor_id: actor.id,
            occurred_at: now,
          })
        }
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'customer.collected',
          entityType: 'customer',
          entityId: customerId,
          details: { number, amountMinor: input.amountMinor },
          occurredAt: now,
        })
        return {
          id,
          number,
          customerId,
          amountMinor: input.amountMinor,
          method: input.method as ReceiptMethod,
          status: 'posted',
          createdAt: now,
        }
      })
      return c.json(receipt, 200)
    })
    .openapi(voidReceiptRoute, async (c) => {
      const { id } = c.req.valid('param')
      const actor = c.get('actor')
      const receipt = await customersRepo(deps.db).findReceipt(id)
      if (!receipt) throw new AppError('NOT_FOUND')
      if (receipt.status !== 'posted') throw new AppError('RECEIPT_ALREADY_VOIDED')
      const shiftId = await drawerOf(deps.db, actor)

      const now = deps.clock()
      await deps.db.transaction().execute(async (trx) => {
        await customerLedger(trx, {
          source: 'receipt',
          documentId: id,
          documentNumber: receipt.number,
          actorId: actor.id,
          occurredAt: now,
          businessDate: businessDate(now),
        }).reverse(id)
        if (receipt.method === 'cash') {
          await shiftsRepo(trx).insertMovement({
            shift_id: shiftId,
            kind: 'receipt',
            amount_minor: -Number(receipt.amount_minor),
            reason: receipt.number,
            document_id: id,
            actor_id: actor.id,
            occurred_at: now,
          })
        }
        await customersRepo(trx).voidReceipt(id, now)
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'customer.receipt_voided',
          entityType: 'customer',
          entityId: receipt.customer_id,
          details: { number: receipt.number },
          occurredAt: now,
        })
      })
      return c.json({ ok: true as const }, 200)
    })
}

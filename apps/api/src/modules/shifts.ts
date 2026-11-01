import { createRoute, z } from '@hono/zod-openapi'
import {
  SHIFT_PREFIX,
  cashMovementInputSchema,
  closeShiftSchema,
  currentShiftSchema,
  openShiftSchema,
  pageQuerySchema,
  shiftPageSchema,
  shiftSummarySchema,
  type CashMovementKind,
  type ShiftRow,
  type ShiftStatus,
  type ShiftSummary,
  type TenderMethod,
} from '@inv/contracts'
import { auditRepo, newId, nextSequence, shiftsRepo, type Database, type Kysely } from '@inv/db'
import type { AppDeps } from '../http/context'
import { AppError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'
import { drawerOf } from './sales'

const params = z.object({ id: z.string() })

type ShiftRecordWithUser = NonNullable<Awaited<ReturnType<ReturnType<typeof shiftsRepo>['find']>>>

function shiftRow(shift: ShiftRecordWithUser): ShiftRow {
  const expected = shift.expected_cash_minor === null ? null : Number(shift.expected_cash_minor)
  const counted = shift.counted_cash_minor === null ? null : Number(shift.counted_cash_minor)
  return {
    id: shift.id,
    number: shift.number,
    status: shift.status as ShiftStatus,
    userId: shift.user_id,
    userName: shift.user_name,
    openedAt: Number(shift.opened_at),
    closedAt: shift.closed_at === null ? null : Number(shift.closed_at),
    openingCashMinor: Number(shift.opening_cash_minor),
    expectedCashMinor: expected,
    countedCashMinor: counted,
    differenceMinor: expected !== null && counted !== null ? counted - expected : null,
    notes: shift.notes,
  }
}

async function summarize(db: Kysely<Database>, shift: ShiftRecordWithUser): Promise<ShiftSummary> {
  const repo = shiftsRepo(db)
  const [figures, movements, expected] = await Promise.all([repo.figures(shift.id), repo.movementsOf(shift.id), repo.expectedCash(shift)])

  const sales = figures.documents.find(({ kind }) => kind === 'sale')
  const returns = figures.documents.find(({ kind }) => kind === 'return')
  const movementTotal = (kind: CashMovementKind) =>
    movements.filter((row) => row.kind === kind).reduce((sum, row) => sum + Number(row.amount_minor), 0)

  return {
    ...shiftRow(shift),
    expectedCashMinor: expected,
    salesCount: sales?.count ?? 0,
    returnsCount: returns?.count ?? 0,
    salesMinor: sales?.totalMinor ?? 0,
    returnsMinor: returns?.totalMinor ?? 0,
    taxMinor: (sales?.taxMinor ?? 0) - (returns?.taxMinor ?? 0),
    discountMinor: sales?.discountMinor ?? 0,
    byMethod: figures.byMethod.map(({ method, amountMinor }) => ({ method: method as TenderMethod, amountMinor })),
    cashInMinor: movementTotal('in'),
    cashOutMinor: -movementTotal('out'),
    receiptsMinor: movementTotal('receipt'),
    movements: movements.map((row) => ({
      id: row.id,
      kind: row.kind as CashMovementKind,
      amountMinor: Number(row.amount_minor),
      reason: row.reason,
      occurredAt: Number(row.occurred_at),
    })),
  }
}

export function shiftRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('sales.view')]
  const canSell = [...guard, requirePermission('sales.sell')]

  const currentRoute = createRoute({
    method: 'get',
    path: '/shifts/current',
    middleware: canView,
    responses: { 200: jsonOk(currentShiftSchema) },
  })

  const listRoute = createRoute({
    method: 'get',
    path: '/shifts',
    middleware: canView,
    request: { query: pageQuerySchema },
    responses: { 200: jsonOk(shiftPageSchema) },
  })

  const readRoute = createRoute({
    method: 'get',
    path: '/shifts/{id}',
    middleware: canView,
    request: { params },
    responses: { 200: jsonOk(shiftSummarySchema) },
  })

  const openRoute = createRoute({
    method: 'post',
    path: '/shifts',
    middleware: canSell,
    request: { body: jsonBody(openShiftSchema) },
    responses: { 200: jsonOk(shiftSummarySchema) },
  })

  const closeRoute = createRoute({
    method: 'post',
    path: '/shifts/{id}/close',
    middleware: canSell,
    request: { params, body: jsonBody(closeShiftSchema) },
    responses: { 200: jsonOk(shiftSummarySchema) },
  })

  const cashRoute = createRoute({
    method: 'post',
    path: '/shifts/current/cash',
    middleware: canSell,
    request: { body: jsonBody(cashMovementInputSchema) },
    responses: { 200: jsonOk(shiftSummarySchema) },
  })

  async function load(db: Kysely<Database>, id: string): Promise<ShiftSummary> {
    const shift = await shiftsRepo(db).find(id)
    if (!shift) throw new AppError('NOT_FOUND')
    return summarize(db, shift)
  }

  return router()
    .openapi(currentRoute, async (c) => {
      const shift = await shiftsRepo(deps.db).current()
      return c.json({ shift: shift ? await summarize(deps.db, shift) : null }, 200)
    })
    .openapi(listRoute, async (c) => {
      const { limit, cursor } = c.req.valid('query')
      const { rows, nextCursor } = await shiftsRepo(deps.db).page(limit, cursor)
      return c.json({ items: rows.map(shiftRow), nextCursor }, 200)
    })
    .openapi(openRoute, async (c) => {
      const input = c.req.valid('json')
      const actor = c.get('actor')
      if (await shiftsRepo(deps.db).current()) throw new AppError('SHIFT_ALREADY_OPEN')

      const now = deps.clock()
      const id = newId()
      await deps.db.transaction().execute(async (trx) => {
        const number = `${SHIFT_PREFIX}-${String(await nextSequence(trx, 'document:shift')).padStart(6, '0')}`
        await shiftsRepo(trx).insert({
          id,
          number,
          status: 'open',
          user_id: actor.id,
          opened_at: now,
          closed_at: null,
          closed_by: null,
          opening_cash_minor: input.openingCashMinor,
          expected_cash_minor: null,
          counted_cash_minor: null,
          notes: null,
        })
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'shift.opened',
          entityType: 'shift',
          entityId: id,
          details: { number, openingCashMinor: input.openingCashMinor },
          occurredAt: now,
        })
      })
      return c.json(await load(deps.db, id), 200)
    })
    .openapi(cashRoute, async (c) => {
      const input = c.req.valid('json')
      const actor = c.get('actor')
      const shiftId = await drawerOf(deps.db, actor)
      const now = deps.clock()

      await deps.db.transaction().execute(async (trx) => {
        await shiftsRepo(trx).insertMovement({
          shift_id: shiftId,
          kind: input.kind,
          amount_minor: input.kind === 'in' ? input.amountMinor : -input.amountMinor,
          reason: input.reason,
          document_id: null,
          actor_id: actor.id,
          occurred_at: now,
        })
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'shift.cash_moved',
          entityType: 'shift',
          entityId: shiftId,
          details: input,
          occurredAt: now,
        })
      })
      return c.json(await load(deps.db, shiftId), 200)
    })
    .openapi(closeRoute, async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const actor = c.get('actor')
      const repo = shiftsRepo(deps.db)

      const shift = await repo.find(id)
      if (!shift) throw new AppError('NOT_FOUND')
      if (shift.status !== 'open') throw new AppError('SHIFT_NOT_OPEN')
      if (shift.user_id !== actor.id && !actor.permissions.includes('shifts.manage')) {
        throw new AppError('SHIFT_OTHER_USER', { params: { name: shift.user_name } })
      }

      const now = deps.clock()
      await deps.db.transaction().execute(async (trx) => {
        const shifts = shiftsRepo(trx)
        const expected = await shifts.expectedCash(shift)
        await shifts.update(id, {
          status: 'closed',
          closed_at: now,
          closed_by: actor.id,
          expected_cash_minor: expected,
          counted_cash_minor: input.countedCashMinor,
          notes: input.notes ?? null,
        })
        await auditRepo(trx).record({
          actorId: actor.id,
          action: 'shift.closed',
          entityType: 'shift',
          entityId: id,
          details: { expectedCashMinor: expected, countedCashMinor: input.countedCashMinor },
          occurredAt: now,
        })
      })
      return c.json(await load(deps.db, id), 200)
    })
    .openapi(readRoute, async (c) => c.json(await load(deps.db, c.req.valid('param').id), 200))
}

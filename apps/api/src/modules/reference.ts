import { createRoute, z } from '@hono/zod-openapi'
import {
  attributesListSchema,
  attributeValueInputSchema,
  attributeValueSchema,
  okSchema,
  REFERENCE_KINDS,
  referenceInputSchema,
  referenceListSchema,
  referenceSchema,
  type ReferenceKind,
} from '@inv/contracts'
import {
  attributesRepo,
  auditRepo,
  classifyConstraintError,
  referenceRepo,
  type ReferenceRow,
  type ReferenceTable,
} from '@inv/db'
import type { AppDeps } from '../http/context'
import { AppError, fieldError } from '../http/errors'
import { jsonBody, jsonOk, router } from '../http/routing'
import { requireAuth, requirePasswordCurrent, requirePermission } from '../http/session'

const TABLES: Record<ReferenceKind, ReferenceTable> = {
  categories: 'categories',
  brands: 'brands',
  units: 'units',
  'tax-rates': 'tax_rates',
  'price-lists': 'price_lists',
  warehouses: 'warehouses',
}

const kindParams = z.object({ kind: z.enum(REFERENCE_KINDS) })
const itemParams = kindParams.extend({ id: z.string() })

async function saved<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (classifyConstraintError(error)?.kind === 'unique') throw fieldError('name', 'NAME_TAKEN')
    throw error
  }
}

/** Walks up from the proposed parent, so a category can never become its own ancestor. */
function assertNoCycle(rows: ReferenceRow[], id: string, parentId: string | null | undefined): void {
  const parents = new Map(rows.map((row) => [row.id, row.parentId ?? null]))
  for (let current = parentId ?? null; current !== null; current = parents.get(current) ?? null) {
    if (current === id) throw fieldError('parentId', 'CATEGORY_CYCLE')
  }
}

export function referenceRoutes(deps: AppDeps) {
  const guard = [requireAuth(deps), requirePasswordCurrent]
  const canView = [...guard, requirePermission('catalog.view')]
  const canManage = [...guard, requirePermission('catalog.manage')]

  const attributesRoute = createRoute({
    method: 'get',
    path: '/catalog/attributes',
    middleware: canView,
    responses: { 200: jsonOk(attributesListSchema) },
  })

  const addValueRoute = createRoute({
    method: 'post',
    path: '/catalog/attributes/{id}/values',
    middleware: canManage,
    request: { params: z.object({ id: z.string() }), body: jsonBody(attributeValueInputSchema) },
    responses: { 200: jsonOk(attributeValueSchema) },
  })

  const listRoute = createRoute({
    method: 'get',
    path: '/catalog/{kind}',
    middleware: canView,
    request: { params: kindParams },
    responses: { 200: jsonOk(referenceListSchema) },
  })

  const createItemRoute = createRoute({
    method: 'post',
    path: '/catalog/{kind}',
    middleware: canManage,
    request: { params: kindParams, body: jsonBody(referenceInputSchema) },
    responses: { 200: jsonOk(referenceSchema) },
  })

  const updateRoute = createRoute({
    method: 'put',
    path: '/catalog/{kind}/{id}',
    middleware: canManage,
    request: { params: itemParams, body: jsonBody(referenceInputSchema) },
    responses: { 200: jsonOk(referenceSchema) },
  })

  const deleteRoute = createRoute({
    method: 'delete',
    path: '/catalog/{kind}/{id}',
    middleware: canManage,
    request: { params: itemParams },
    responses: { 200: jsonOk(okSchema) },
  })

  return router()
    .openapi(attributesRoute, async (c) => c.json({ items: await attributesRepo(deps.db).list() }, 200))
    .openapi(addValueRoute, async (c) => {
      const { id } = c.req.valid('param')
      const { value } = c.req.valid('json')
      const valueId = await saved(() => attributesRepo(deps.db).addValue(id, value, deps.clock()))
      return c.json({ id: valueId, attributeId: id, value }, 200)
    })
    .openapi(listRoute, async (c) => {
      const { kind } = c.req.valid('param')
      return c.json({ items: await referenceRepo(deps.db, TABLES[kind]).list() }, 200)
    })
    .openapi(createItemRoute, async (c) => {
      const { kind } = c.req.valid('param')
      const input = c.req.valid('json')
      const repo = referenceRepo(deps.db, TABLES[kind])
      const now = deps.clock()

      const id = await saved(() =>
        repo.insert(
          {
            name: input.name,
            ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
            ...(input.allowsFraction === undefined ? {} : { allowsFraction: input.allowsFraction }),
            ...(input.rateBp === undefined ? {} : { rateBp: input.rateBp }),
          },
          now,
        ),
      )
      await auditRepo(deps.db).record({
        actorId: c.get('actor').id,
        action: 'reference.created',
        entityType: TABLES[kind],
        entityId: id,
        details: { name: input.name },
        occurredAt: now,
      })
      return c.json((await repo.find(id))!, 200)
    })
    .openapi(updateRoute, async (c) => {
      const { kind, id } = c.req.valid('param')
      const input = c.req.valid('json')
      const repo = referenceRepo(deps.db, TABLES[kind])
      const rows = await repo.list()
      const existing = rows.find((row) => row.id === id)
      if (!existing) throw new AppError('NOT_FOUND')

      if (existing.isSystem && input.name !== existing.name) throw new AppError('REFERENCE_IS_SYSTEM')
      if (kind === 'categories') assertNoCycle(rows, id, input.parentId)

      const now = deps.clock()
      await saved(() =>
        repo.update(
          id,
          {
            name: input.name,
            ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
            ...(input.allowsFraction === undefined ? {} : { allowsFraction: input.allowsFraction }),
            ...(input.rateBp === undefined ? {} : { rateBp: input.rateBp }),
            ...(input.archived === undefined ? {} : { archived: input.archived }),
          },
          now,
        ),
      )
      await auditRepo(deps.db).record({
        actorId: c.get('actor').id,
        action: 'reference.updated',
        entityType: TABLES[kind],
        entityId: id,
        occurredAt: now,
      })
      return c.json((await repo.find(id))!, 200)
    })
    .openapi(deleteRoute, async (c) => {
      const { kind, id } = c.req.valid('param')
      const repo = referenceRepo(deps.db, TABLES[kind])
      const existing = await repo.find(id)
      if (!existing) throw new AppError('NOT_FOUND')
      if (existing.isSystem) throw new AppError('REFERENCE_IS_SYSTEM')

      try {
        await repo.delete(id)
      } catch (error) {
        if (classifyConstraintError(error)?.kind === 'foreign_key') {
          throw new AppError('REFERENCE_IN_USE', { params: { count: existing.usageCount } })
        }
        throw error
      }
      await auditRepo(deps.db).record({
        actorId: c.get('actor').id,
        action: 'reference.deleted',
        entityType: TABLES[kind],
        entityId: id,
        details: { name: existing.name },
        occurredAt: deps.clock(),
      })
      return c.json({ ok: true as const }, 200)
    })
}

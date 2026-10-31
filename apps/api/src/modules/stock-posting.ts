import type { ErrorCode } from '@inv/contracts'
import {
  InsufficientStock,
  stockLedger,
  stockRepo,
  type Database,
  type Kysely,
  type LedgerContext,
  type StockDocumentRecord,
  type VariantRule,
} from '@inv/db'
import { allocateFefo, receiptValue, toBaseQuantity, type LotAllocation } from '@inv/domain'
import { AppError, fieldError } from '../http/errors'

type Rules = Map<string, VariantRule>
type Rule = VariantRule
type Line = Awaited<ReturnType<ReturnType<typeof stockRepo>['linesOf']>>[number]

export interface PostingOptions {
  now: number
  today: string
  expiryRequired: boolean
  context: LedgerContext
}

const lineField = (index: number, field: string, code: ErrorCode) => fieldError(`lines.${index}.${field}`, code)

function baseQuantity(line: Line, rule: Rule, index: number): number {
  const magnitude = Math.abs(Number(line.qty_milli))
  const factor = line.unit_id === rule.baseUnitId ? 1000 : rule.factors.get(line.unit_id)
  if (factor === undefined) throw lineField(index, 'unitId', 'UNIT_CONVERSION_INVALID')

  const base = toBaseQuantity(magnitude, factor)
  if (base === null || (!rule.allowsFraction && base % 1000 !== 0)) {
    throw lineField(index, 'qtyMilli', 'QUANTITY_NOT_WHOLE')
  }
  return base
}

/** Receipts name or create their batch; a batch with no expiry is refused where it matters. */
async function receiptLot(
  trx: Kysely<Database>,
  line: Line,
  rule: Rule,
  index: number,
  options: PostingOptions,
): Promise<string | null> {
  if (line.lot_id) return line.lot_id
  if (!rule.trackLots) return null

  if (!line.lot_no) throw lineField(index, 'lotNo', 'LOT_REQUIRED')
  if (options.expiryRequired && !line.expiry_date) throw lineField(index, 'expiryDate', 'EXPIRY_REQUIRED')

  const { id, conflict } = await stockRepo(trx).resolveLot(line.variant_id, line.lot_no, line.expiry_date, options.now)
  if (conflict) throw lineField(index, 'expiryDate', 'LOT_EXPIRY_MISMATCH')
  return id
}

/** Refuses with the real total across batches, unless the shop lets stock go negative. */
function assertCovered(line: Line, baseQty: number, planned: number, options: PostingOptions): void {
  if (planned < baseQty && !options.context.allowNegative) {
    throw new InsufficientStock(line.variant_id, null, planned, baseQty)
  }
}

/** A chosen batch is respected; otherwise the nearest expiry leaves first. */
async function issueLots(
  trx: Kysely<Database>,
  line: Line,
  rule: Rule,
  warehouseId: string,
  baseQty: number,
  options: PostingOptions & { includeExpired: boolean },
): Promise<LotAllocation[]> {
  if (line.lot_id) return [{ lotId: line.lot_id, qtyMilli: baseQty }]
  if (!rule.trackLots) return []

  const lots = await stockRepo(trx).lotsInWarehouse(line.variant_id, warehouseId)
  const { allocations } = allocateFefo(lots, baseQty, { today: options.today, includeExpired: options.includeExpired })
  return allocations
}

function receiptValueOf(line: Line, rule: Rule, baseQty: number): number {
  if (line.unit_cost_minor !== null) {
    return receiptValue(Math.abs(Number(line.qty_milli)), Number(line.unit_cost_minor))
  }
  const averageOrLast = rule.onHandMilli > 0 ? Math.round((rule.valueMinor * 1000) / rule.onHandMilli) : rule.costMinor
  return receiptValue(baseQty, averageOrLast)
}

async function postAdjustment(
  trx: Kysely<Database>,
  document: StockDocumentRecord,
  lines: Line[],
  rules: Rules,
  options: PostingOptions,
): Promise<void> {
  if (!document.reason) throw fieldError('reason', 'REQUIRED')
  const ledger = stockLedger(trx, options.context)

  for (const [index, line] of lines.entries()) {
    const rule = rules.get(line.variant_id)!
    const qty = Number(line.qty_milli)
    if (qty === 0) throw lineField(index, 'qtyMilli', 'QUANTITY_INVALID')
    const baseQty = baseQuantity(line, rule, index)
    const warehouseId = document.warehouse_id

    if (qty > 0) {
      const lotId = await receiptLot(trx, line, rule, index, options)
      await ledger.post({ variantId: line.variant_id, warehouseId, lotId, qtyMilli: baseQty, valueMinor: receiptValueOf(line, rule, baseQty) })
      continue
    }

    const lots = await issueLots(trx, line, rule, warehouseId, baseQty, {
      ...options,
      // Writing off expired stock is the one issue that should reach expired batches.
      includeExpired: document.reason === 'expired' || document.reason === 'damage',
    })
    const planned = lots.reduce((sum, { qtyMilli }) => sum + qtyMilli, 0)

    if (rule.trackLots) {
      for (const { lotId, qtyMilli } of lots) {
        await ledger.post({ variantId: line.variant_id, warehouseId, lotId, qtyMilli: -qtyMilli })
      }
      assertCovered(line, baseQty, planned, options)
      if (planned < baseQty) {
        await ledger.post({ variantId: line.variant_id, warehouseId, lotId: line.lot_id, qtyMilli: -(baseQty - planned) })
      }
    } else {
      await ledger.post({ variantId: line.variant_id, warehouseId, lotId: null, qtyMilli: -baseQty })
    }
  }
}

async function postTransfer(
  trx: Kysely<Database>,
  document: StockDocumentRecord,
  lines: Line[],
  rules: Rules,
  options: PostingOptions,
): Promise<void> {
  const to = document.to_warehouse_id
  if (!to) throw fieldError('toWarehouseId', 'REQUIRED')
  if (to === document.warehouse_id) throw fieldError('toWarehouseId', 'SAME_WAREHOUSE')
  const ledger = stockLedger(trx, options.context)

  for (const [index, line] of lines.entries()) {
    const rule = rules.get(line.variant_id)!
    if (Number(line.qty_milli) <= 0) throw lineField(index, 'qtyMilli', 'QUANTITY_INVALID')
    const baseQty = baseQuantity(line, rule, index)

    const lots = await issueLots(trx, line, rule, document.warehouse_id, baseQty, { ...options, includeExpired: true })
    const planned = lots.reduce((sum, { qtyMilli }) => sum + qtyMilli, 0)

    for (const { lotId, qtyMilli } of lots) {
      await ledger.transfer({ variantId: line.variant_id, lotId, qtyMilli, from: document.warehouse_id, to })
    }
    if (rule.trackLots) assertCovered(line, baseQty, planned, options)
    if (planned < baseQty) {
      await ledger.transfer({ variantId: line.variant_id, lotId: line.lot_id, qtyMilli: baseQty - planned, from: document.warehouse_id, to })
    }
  }
}

/** A count sets the shelf to what was counted, measured against the stock at this moment. */
async function postCount(
  trx: Kysely<Database>,
  document: StockDocumentRecord,
  lines: Line[],
  rules: Rules,
  options: PostingOptions,
): Promise<void> {
  const repo = stockRepo(trx)
  const ledger = stockLedger(trx, { ...options.context, allowNegative: true })
  const warehouseId = document.warehouse_id
  const seen = new Set<string>()

  for (const [index, line] of lines.entries()) {
    const rule = rules.get(line.variant_id)!
    if (Number(line.qty_milli) < 0) throw lineField(index, 'qtyMilli', 'QUANTITY_INVALID')
    const counted = baseQuantity(line, rule, index)
    const lotId = await receiptLot(trx, line, rule, index, options)

    const key = `${line.variant_id}|${lotId ?? ''}`
    if (seen.has(key)) throw lineField(index, 'variantId', 'LINE_DUPLICATED')
    seen.add(key)

    const current = await repo.balanceOf(line.variant_id, warehouseId, lotId)
    await repo.updateLine(line.id, { expected_milli: current })

    const delta = counted - current
    if (delta === 0) continue
    await ledger.post({
      variantId: line.variant_id,
      warehouseId,
      lotId,
      qtyMilli: delta,
      ...(delta > 0 ? { valueMinor: receiptValueOf(line, rule, delta) } : {}),
    })
  }
}

const POSTERS = { adjustment: postAdjustment, transfer: postTransfer, count: postCount }

export async function postDocument(
  trx: Kysely<Database>,
  document: StockDocumentRecord,
  options: PostingOptions,
): Promise<void> {
  const repo = stockRepo(trx)
  const lines = await repo.linesOf(document.id)
  if (lines.length === 0) throw new AppError('DOCUMENT_EMPTY')

  const rules = await repo.variantRules([...new Set(lines.map((line) => line.variant_id))])
  await POSTERS[document.kind as keyof typeof POSTERS](trx, document, lines, rules, options)
}

import {
  SALE_PREFIX,
  type Actor,
  type checkoutSchema,
  type returnInputSchema,
  type SaleKind,
} from '@inv/contracts'
import {
  customerLedger,
  customersRepo,
  newId,
  nextSequence,
  purchasingRepo,
  salesRepo,
  stockLedger,
  stockRepo,
  type Database,
  type Kysely,
  type LedgerContext,
  type SaleLineRecord,
  type SaleRecord,
  type VariantRule,
} from '@inv/db'
import { moneyToText, priceForUnit, priceSale, returnShare, settle } from '@inv/domain'
import type { z } from 'zod'
import { AppError, fieldError } from '../http/errors'
import { checkSerials } from './purchase-posting'
import { assertCovered, baseQuantity, issueLots, lineField, type PostingOptions } from './stock-posting'

export interface SaleContext {
  actor: Actor
  shiftId: string
  warehouseId: string
  now: number
  today: string
  allowNegative: boolean
}

type CheckoutInput = z.output<typeof checkoutSchema>
type ReturnInput = z.output<typeof returnInputSchema>
type InputLine = CheckoutInput['lines'][number]

const documentNumber = (kind: SaleKind, sequence: number) => `${SALE_PREFIX[kind]}-${String(sequence).padStart(6, '0')}`

const parseSerials = (line: Pick<SaleLineRecord, 'serials'>): string[] =>
  line.serials ? (JSON.parse(line.serials) as string[]) : []

const ledgerContext = (saleId: string, kind: SaleKind, number: string, context: SaleContext): LedgerContext => ({
  documentId: saleId,
  documentType: kind === 'sale' ? 'sale' : 'sale_return',
  documentNumber: number,
  actorId: context.actor.id,
  occurredAt: context.now,
  businessDate: context.today,
  allowNegative: context.allowNegative,
})

const customerContext = (ledger: LedgerContext) => ({
  source: ledger.documentType,
  documentId: ledger.documentId,
  documentNumber: ledger.documentNumber,
  actorId: ledger.actorId,
  occurredAt: ledger.occurredAt,
  businessDate: ledger.businessDate,
})

const can = (context: SaleContext, permission: Actor['permissions'][number]) =>
  context.actor.permissions.includes(permission)

/** The list price is the rule. Selling at anything else is a decision someone has to be allowed. */
function assertPrice(line: InputLine, rule: VariantRule, listPrice: number | null, index: number, context: SaleContext): void {
  if (line.unitPriceMinor === listPrice || can(context, 'sales.price')) return
  throw lineField(index, 'unitPriceMinor', listPrice === null ? 'ITEM_NOT_PRICED' : 'PRICE_CHANGE_FORBIDDEN')
}

async function issueLine(
  trx: Kysely<Database>,
  line: InputLine,
  rule: VariantRule,
  baseQty: number,
  index: number,
  lineId: string,
  ledger: LedgerContext,
  context: SaleContext,
): Promise<number> {
  const stock = stockLedger(trx, ledger)
  const sales = salesRepo(trx)
  const options: PostingOptions = { now: context.now, today: context.today, expiryRequired: false, context: ledger }
  const lotLine = {
    variant_id: line.variantId,
    unit_id: line.unitId,
    qty_milli: line.qtyMilli,
    lot_id: line.lotId ?? null,
    lot_no: null,
    expiry_date: null,
  }

  if (line.lotId) {
    const lots = await stockRepo(trx).lotsInWarehouse(line.variantId, context.warehouseId)
    const chosen = lots.find(({ lotId }) => lotId === line.lotId)
    if (chosen?.expiryDate && chosen.expiryDate < context.today) throw lineField(index, 'lotId', 'LOT_EXPIRED')
  }

  const lots = await issueLots(trx, lotLine, rule, context.warehouseId, baseQty, { ...options, includeExpired: false })
  const planned = lots.reduce((sum, { qtyMilli }) => sum + qtyMilli, 0)
  if (rule.trackLots) assertCovered(lotLine, baseQty, planned, options)

  const parts = [...lots, ...(planned < baseQty ? [{ lotId: null, qtyMilli: baseQty - planned }] : [])]
  let cost = 0
  for (const { lotId, qtyMilli } of parts) {
    cost -= await stock.post({ variantId: line.variantId, warehouseId: context.warehouseId, lotId, qtyMilli: -qtyMilli })
    await sales.insertLineLot({ id: newId(), sale_line_id: lineId, lot_id: lotId, qty_milli: qtyMilli })
  }
  return cost
}

async function markSerialsSold(trx: Kysely<Database>, line: InputLine, serials: string[], index: number): Promise<void> {
  if (serials.length === 0) return
  const repo = purchasingRepo(trx)
  const existing = await repo.existingSerials(line.variantId, serials)
  if (existing.length !== serials.length || existing.some(({ status }) => status !== 'in_stock')) {
    throw lineField(index, 'serials', 'SERIAL_NOT_IN_STOCK')
  }
  await repo.setSerialStatus(line.variantId, serials, 'sold')
}

export async function postSale(trx: Kysely<Database>, input: CheckoutInput, context: SaleContext): Promise<string> {
  const { lines, tenders } = input
  if (lines.length === 0) throw new AppError('DOCUMENT_EMPTY')

  const customer = input.customerId ? await customersRepo(trx).find(input.customerId) : null
  if (input.customerId && !customer) throw new AppError('NOT_FOUND')
  if (customer?.archived_at != null) throw new AppError('CUSTOMER_ARCHIVED')

  const sales = salesRepo(trx)
  const variantIds = [...new Set(lines.map(({ variantId }) => variantId))]
  const [rules, pricing] = await Promise.all([stockRepo(trx).variantRules(variantIds), sales.pricing(variantIds)])

  const documentDiscount = input.discountMinor ?? 0
  if (documentDiscount > 0 && !can(context, 'sales.discount')) throw fieldError('discountMinor', 'DISCOUNT_FORBIDDEN')

  const bases = lines.map((line, index) => {
    const rule = rules.get(line.variantId)
    if (!rule) throw lineField(index, 'variantId', 'INVALID_VALUE')
    const baseQty = baseQuantity({ unit_id: line.unitId, qty_milli: line.qtyMilli }, rule, index)

    const factor = line.unitId === rule.baseUnitId ? 1000 : rule.factors.get(line.unitId)!
    const list = pricing.get(line.variantId)
    assertPrice(line, rule, list ? priceForUnit(list.prices, line.unitId, rule.baseUnitId, factor) : null, index, context)

    if (line.discountMinor > 0 && !can(context, 'sales.discount')) throw lineField(index, 'discountMinor', 'DISCOUNT_FORBIDDEN')
    return baseQty
  })

  const amounts = lines.map((line) => ({
    qtyMilli: line.qtyMilli,
    unitPriceMinor: line.unitPriceMinor,
    discountMinor: line.discountMinor,
    taxRateBp: pricing.get(line.variantId)?.taxRateBp ?? 0,
  }))
  const { lines: priced, totals } = priceSale(amounts, documentDiscount)

  priced.forEach((line, index) => {
    if (lines[index]!.discountMinor > line.grossMinor) throw lineField(index, 'discountMinor', 'DISCOUNT_TOO_LARGE')
  })
  if (totals.discountMinor !== lines.reduce((sum, line) => sum + line.discountMinor, 0) + documentDiscount) {
    throw fieldError('discountMinor', 'DISCOUNT_TOO_LARGE')
  }

  const settlement = settle(totals.totalMinor, tenders)
  if (!settlement.ok) throw new AppError(settlement.reason === 'short' ? 'PAYMENT_SHORT' : 'PAYMENT_OVER_TOTAL')
  if (settlement.creditMinor > 0) {
    if (!customer) throw new AppError('CREDIT_NEEDS_CUSTOMER')
    const limit = customer.credit_limit_minor === null ? null : Number(customer.credit_limit_minor)
    const owed = Number(customer.balance_minor) + settlement.creditMinor
    if (limit !== null && owed > limit) {
      throw new AppError('CREDIT_LIMIT_EXCEEDED', { params: { limit: moneyToText(limit), owed: moneyToText(owed) } })
    }
  }

  const saleId = newId()
  const number = documentNumber('sale', await nextSequence(trx, 'document:sale'))
  const ledger = ledgerContext(saleId, 'sale', number, context)
  const tendered = tenders.reduce((sum, { amountMinor }) => sum + amountMinor, 0)

  await sales.insertSale({
    id: saleId,
    request_id: input.requestId,
    kind: 'sale',
    status: 'posted',
    number,
    return_of: null,
    customer_id: customer?.id ?? null,
    shift_id: context.shiftId,
    warehouse_id: context.warehouseId,
    gross_minor: totals.grossMinor,
    discount_minor: totals.discountMinor,
    tax_minor: totals.taxMinor,
    total_minor: totals.totalMinor,
    tendered_minor: tendered,
    change_minor: settlement.changeMinor,
    notes: input.notes ?? null,
    business_date: context.today,
    created_by: context.actor.id,
    created_at: context.now,
    voided_at: null,
    voided_by: null,
  })

  let totalCost = 0
  for (const [index, line] of lines.entries()) {
    const rule = rules.get(line.variantId)!
    const baseQty = bases[index]!
    const lineId = newId()
    const serials = rule.trackSerials ? checkSerials(line.serials ?? [], rule, baseQty, index) : []
    const total = priced[index]!

    await sales.insertLine({
      id: lineId,
      sale_id: saleId,
      position: index,
      variant_id: line.variantId,
      unit_id: line.unitId,
      item_name: rule.productName,
      qty_milli: line.qtyMilli,
      base_qty_milli: baseQty,
      unit_price_minor: line.unitPriceMinor,
      discount_minor: total.discountMinor,
      tax_rate_bp: amounts[index]!.taxRateBp,
      tax_minor: total.taxMinor,
      total_minor: total.totalMinor,
      cost_minor: 0,
      serials: serials.length > 0 ? JSON.stringify(serials) : null,
      return_of_line: null,
      report_date: context.today,
    })
    const cost = await issueLine(trx, line, rule, baseQty, index, lineId, ledger, context)
    await sales.updateLine(lineId, { cost_minor: cost })
    await markSerialsSold(trx, line, serials, index)
    totalCost += cost
  }
  await sales.updateSale(saleId, { cost_minor: totalCost })

  const kept = { cash: settlement.cashKeptMinor } as Record<string, number>
  for (const { method, amountMinor } of tenders) {
    if (method !== 'cash') kept[method] = (kept[method] ?? 0) + amountMinor
  }
  for (const [method, amount] of Object.entries(kept)) {
    if (amount === 0) continue
    await sales.insertPayment({
      sale_id: saleId,
      shift_id: context.shiftId,
      method,
      amount_minor: amount,
      reversal_of: null,
      occurred_at: context.now,
    })
  }

  if (settlement.creditMinor > 0) {
    await customerLedger(trx, customerContext(ledger)).post(customer!.id, settlement.creditMinor)
  }
  if (input.heldId) await sales.deleteHeld(input.heldId)
  return saleId
}

/** Stock goes back to the batches it came from, each at its share of what the line cost. */
async function restockLine(
  trx: Kysely<Database>,
  line: SaleLineRecord,
  returnLineId: string,
  baseQty: number,
  costShare: number,
  warehouseId: string,
  ledger: LedgerContext,
): Promise<void> {
  const sales = salesRepo(trx)
  const stock = stockLedger(trx, ledger)
  const allocations = await sales.lotsOfLines([line.id])

  let left = baseQty
  let moved = 0
  let valued = 0
  for (const allocation of allocations) {
    if (left === 0) break
    const returned = Number(allocation.returned_milli)
    const taken = Math.min(Number(allocation.qty_milli) - returned, left)
    if (taken <= 0) continue

    const value = returnShare(costShare, valued, baseQty, moved, taken)
    await stock.post({ variantId: line.variant_id, warehouseId, lotId: allocation.lot_id, qtyMilli: taken, valueMinor: value })
    await sales.updateLineLot(allocation.id, returned + taken)
    await sales.insertLineLot({ id: newId(), sale_line_id: returnLineId, lot_id: allocation.lot_id, qty_milli: taken })

    left -= taken
    moved += taken
    valued += value
  }
}

async function restoreSerials(trx: Kysely<Database>, line: SaleLineRecord, requested: string[], baseQty: number, rule: VariantRule, index: number) {
  if (!rule.trackSerials) return []
  const serials = checkSerials(requested, rule, baseQty, index)
  const sold = new Set(parseSerials(line))
  const repo = purchasingRepo(trx)
  const existing = await repo.existingSerials(line.variant_id, serials)
  if (
    serials.some((serial) => !sold.has(serial)) ||
    existing.length !== serials.length ||
    existing.some(({ status }) => status !== 'sold')
  ) {
    throw lineField(index, 'serials', 'SERIAL_NOT_ON_SALE')
  }
  await repo.setSerialStatus(line.variant_id, serials, 'in_stock')
  return serials
}

export async function postReturn(trx: Kysely<Database>, sale: SaleRecord, input: ReturnInput, context: SaleContext): Promise<string> {
  if (sale.kind !== 'sale' || sale.status !== 'posted') throw new AppError('SALE_NOT_RETURNABLE')
  if (input.lines.length === 0) throw new AppError('DOCUMENT_EMPTY')
  if (input.method === 'credit' && !sale.customer_id) throw new AppError('CREDIT_NEEDS_CUSTOMER')

  const sales = salesRepo(trx)
  const soldLines = await sales.linesOf(sale.id)
  const rules = await stockRepo(trx).variantRules([...new Set(soldLines.map((line) => line.variant_id))])

  const returnId = newId()
  const number = documentNumber('return', await nextSequence(trx, 'document:sale_return'))
  const ledger = ledgerContext(returnId, 'return', number, context)

  await sales.insertSale({
    id: returnId,
    request_id: input.requestId,
    kind: 'return',
    status: 'posted',
    number,
    return_of: sale.id,
    customer_id: sale.customer_id,
    shift_id: context.shiftId,
    warehouse_id: sale.warehouse_id,
    gross_minor: 0,
    discount_minor: 0,
    tax_minor: 0,
    total_minor: 0,
    tendered_minor: 0,
    change_minor: 0,
    notes: input.reason ?? null,
    business_date: context.today,
    created_by: context.actor.id,
    created_at: context.now,
    voided_at: null,
    voided_by: null,
  })

  const seen = new Set<string>()
  let refund = 0
  let tax = 0
  let cost = 0

  for (const [index, requested] of input.lines.entries()) {
    const line = soldLines.find(({ id }) => id === requested.saleLineId)
    if (!line) throw lineField(index, 'saleLineId', 'INVALID_VALUE')
    if (seen.has(line.id)) throw lineField(index, 'saleLineId', 'LINE_DUPLICATED')
    seen.add(line.id)

    const rule = rules.get(line.variant_id)!
    const soldBase = Number(line.base_qty_milli)
    const soldQty = Number(line.qty_milli)
    const returnedBase = Number(line.returned_base_milli)
    const baseQty = Math.round((requested.qtyMilli * soldBase) / soldQty)
    if (baseQty <= 0 || returnedBase + baseQty > soldBase) throw lineField(index, 'qtyMilli', 'RETURN_EXCEEDS_SALE')

    const lineRefund = returnShare(Number(line.total_minor), Number(line.refunded_minor), soldBase, returnedBase, baseQty)
    const costShare = returnShare(Number(line.cost_minor), Number(line.returned_cost_minor), soldBase, returnedBase, baseQty)
    const taxShare = Math.round((Number(line.tax_minor) * baseQty) / soldBase)
    const serials = await restoreSerials(trx, line, requested.serials ?? [], baseQty, rule, index)

    const returnLineId = newId()
    await sales.insertLine({
      id: returnLineId,
      sale_id: returnId,
      position: index,
      variant_id: line.variant_id,
      unit_id: line.unit_id,
      item_name: line.item_name,
      qty_milli: requested.qtyMilli,
      base_qty_milli: baseQty,
      unit_price_minor: Number(line.unit_price_minor),
      discount_minor: 0,
      tax_rate_bp: line.tax_rate_bp,
      tax_minor: taxShare,
      total_minor: lineRefund,
      cost_minor: costShare,
      serials: serials.length > 0 ? JSON.stringify(serials) : null,
      return_of_line: line.id,
      report_date: context.today,
      is_return: 1,
    })
    await restockLine(trx, line, returnLineId, baseQty, costShare, sale.warehouse_id, ledger)
    await sales.updateLine(line.id, {
      returned_base_milli: returnedBase + baseQty,
      refunded_minor: Number(line.refunded_minor) + lineRefund,
      returned_cost_minor: Number(line.returned_cost_minor) + costShare,
    })

    refund += lineRefund
    tax += taxShare
    cost += costShare
  }

  await sales.updateSale(returnId, { gross_minor: refund, tax_minor: tax, total_minor: refund, cost_minor: cost })
  if (refund > 0) {
    await sales.insertPayment({
      sale_id: returnId,
      shift_id: context.shiftId,
      method: input.method,
      amount_minor: -refund,
      reversal_of: null,
      occurred_at: context.now,
    })
  }
  if (input.method === 'credit' && refund > 0) {
    await customerLedger(trx, customerContext(ledger)).post(sale.customer_id!, -refund)
  }
  return returnId
}

/** Undoes a return's mark on the sale, so what it gave back can be returned again. */
async function restoreOriginal(trx: Kysely<Database>, sale: SaleRecord): Promise<void> {
  const sales = salesRepo(trx)
  const lines = await sales.linesOf(sale.id)

  for (const line of lines) {
    const original = (await sales.linesOf(sale.return_of!)).find(({ id }) => id === line.return_of_line)!
    await sales.updateLine(original.id, {
      returned_base_milli: Number(original.returned_base_milli) - Number(line.base_qty_milli),
      refunded_minor: Number(original.refunded_minor) - Number(line.total_minor),
      returned_cost_minor: Number(original.returned_cost_minor) - Number(line.cost_minor),
    })

    const given = await sales.lotsOfLines([original.id])
    for (const allocation of await sales.lotsOfLines([line.id])) {
      let left = Number(allocation.qty_milli)
      for (const source of given.filter(({ lot_id }) => lot_id === allocation.lot_id)) {
        const taken = Math.min(Number(source.returned_milli), left)
        if (taken === 0) continue
        source.returned_milli = Number(source.returned_milli) - taken
        await sales.updateLineLot(source.id, source.returned_milli)
        left -= taken
      }
    }

    const serials = parseSerials(line)
    if (serials.length > 0) {
      const existing = await purchasingRepo(trx).existingSerials(line.variant_id, serials)
      if (existing.some(({ status }) => status !== 'in_stock')) throw new AppError('SERIAL_ALREADY_SOLD')
      await purchasingRepo(trx).setSerialStatus(line.variant_id, serials, 'sold')
    }
  }
}

async function releaseSerials(trx: Kysely<Database>, sale: SaleRecord): Promise<void> {
  for (const line of await salesRepo(trx).linesOf(sale.id)) {
    const serials = parseSerials(line)
    if (serials.length > 0) await purchasingRepo(trx).setSerialStatus(line.variant_id, serials, 'in_stock')
  }
}

export async function voidSale(trx: Kysely<Database>, sale: SaleRecord, context: SaleContext): Promise<void> {
  if (sale.status !== 'posted') throw new AppError('SALE_ALREADY_VOIDED')
  const sales = salesRepo(trx)
  const kind = sale.kind as SaleKind

  if (kind === 'sale') {
    if ((await sales.returnsOf(sale.id)).length > 0) throw new AppError('SALE_HAS_RETURNS')
    await releaseSerials(trx, sale)
  } else {
    await restoreOriginal(trx, sale)
  }

  const ledger = ledgerContext(sale.id, kind, sale.number, context)
  await stockLedger(trx, ledger).reverse(sale.id)
  await customerLedger(trx, customerContext(ledger)).reverse(sale.id)

  // The money goes back through today's drawer, whichever shift it came in on.
  for (const payment of await sales.paymentsOf(sale.id)) {
    await sales.insertPayment({
      sale_id: sale.id,
      shift_id: context.shiftId,
      method: payment.method,
      amount_minor: -Number(payment.amount_minor),
      reversal_of: payment.id,
      occurred_at: context.now,
    })
  }
  await sales.updateSale(sale.id, { status: 'voided', voided_at: context.now, voided_by: context.actor.id })
  await sales.dropFromReports(sale.id)
}

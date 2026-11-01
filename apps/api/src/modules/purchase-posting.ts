import { PAYMENT_PREFIX } from '@inv/contracts'
import {
  newId,
  nextSequence,
  purchasingRepo,
  stockLedger,
  stockRepo,
  supplierLedger,
  suppliersRepo,
  type Database,
  type Kysely,
  type LedgerContext,
  type PurchaseRecord,
  type VariantRule,
} from '@inv/db'
import { costPerBaseUnit, orderProgress, purchaseDocumentTotals, purchaseLineTotals } from '@inv/domain'
import { AppError, fieldError } from '../http/errors'
import { assertCovered, baseQuantity, issueLots, lineField, receiptLot, type PostingOptions } from './stock-posting'

type PurchaseLine = Awaited<ReturnType<ReturnType<typeof purchasingRepo>['linesOf']>>[number]

const parseSerials = (line: PurchaseLine): string[] => (line.serials ? (JSON.parse(line.serials) as string[]) : [])

const amountsOf = (line: Pick<PurchaseLine, 'qty_milli' | 'unit_cost_minor' | 'discount_minor' | 'tax_rate_bp'>) => ({
  qtyMilli: Number(line.qty_milli),
  unitCostMinor: Number(line.unit_cost_minor),
  discountMinor: Number(line.discount_minor),
  taxRateBp: line.tax_rate_bp,
})

export function purchaseAmounts(lines: ReadonlyArray<Parameters<typeof amountsOf>[0]>) {
  return purchaseDocumentTotals(lines.map(amountsOf))
}

/** A tracked item needs one serial for each piece, whichever document moves it. */
export function checkSerials(serials: string[], rule: VariantRule, baseQty: number, index: number): string[] {
  if (!rule.trackSerials) return []

  if (baseQty % 1000 !== 0 || serials.length !== baseQty / 1000) {
    throw lineField(index, 'serials', 'SERIAL_COUNT_MISMATCH')
  }
  if (new Set(serials).size !== serials.length) throw lineField(index, 'serials', 'SERIAL_DUPLICATED')
  return serials
}

async function receiveAgainstOrder(trx: Kysely<Database>, line: PurchaseLine, baseQty: number, index: number) {
  if (!line.order_line_id) return
  const repo = purchasingRepo(trx)
  const orderLine = await repo.findOrderLine(line.order_line_id)
  if (!orderLine) throw lineField(index, 'orderLineId', 'INVALID_VALUE')

  const received = Number(orderLine.received_base_milli) + baseQty
  if (received > Number(orderLine.ordered_base_milli)) throw lineField(index, 'qtyMilli', 'RECEIPT_EXCEEDS_ORDER')
  await repo.updateOrderLine(orderLine.id, { received_base_milli: received })
}

/** An order's status always follows its lines, in both directions. */
async function refreshOrderStatus(trx: Kysely<Database>, orderId: string): Promise<void> {
  const repo = purchasingRepo(trx)
  const order = await repo.findOrder(orderId)
  if (!order || order.status === 'cancelled') return

  const lines = await repo.orderLines(orderId)
  const status = orderProgress(
    lines.map((line) => ({
      orderedMilli: Number(line.ordered_base_milli),
      receivedMilli: Number(line.received_base_milli),
    })),
  )
  await repo.updateOrder(orderId, { status })
}

async function postInvoice(
  trx: Kysely<Database>,
  document: PurchaseRecord,
  lines: PurchaseLine[],
  rules: Map<string, VariantRule>,
  options: PostingOptions,
): Promise<void> {
  const repo = purchasingRepo(trx)
  const ledger = stockLedger(trx, options.context)

  if (document.order_id) {
    const order = await repo.findOrder(document.order_id)
    if (!order || (order.status !== 'open' && order.status !== 'partial')) throw new AppError('ORDER_NOT_OPEN')
  }

  const seen = new Set<string>()

  for (const [index, line] of lines.entries()) {
    const rule = rules.get(line.variant_id)!
    if (Number(line.qty_milli) <= 0) throw lineField(index, 'qtyMilli', 'QUANTITY_INVALID')
    const baseQty = baseQuantity(line, rule, index)
    const lotId = await receiptLot(trx, line, rule, index, options)

    const serials = checkSerials(parseSerials(line), rule, baseQty, index)
    if (serials.some((serial) => seen.has(`${line.variant_id}|${serial}`))) {
      throw lineField(index, 'serials', 'SERIAL_DUPLICATED')
    }
    serials.forEach((serial) => seen.add(`${line.variant_id}|${serial}`))
    if ((await repo.existingSerials(line.variant_id, serials)).length > 0) {
      throw lineField(index, 'serials', 'SERIAL_TAKEN')
    }

    const { netMinor } = purchaseLineTotals(amountsOf(line))
    await ledger.post({
      variantId: line.variant_id,
      warehouseId: document.warehouse_id,
      lotId,
      qtyMilli: baseQty,
      valueMinor: netMinor,
    })
    await repo.setVariantCost(line.variant_id, costPerBaseUnit(netMinor, baseQty), options.now)
    await repo.insertSerials(
      serials.map((serial) => ({
        variantId: line.variant_id,
        serial,
        warehouseId: document.warehouse_id,
        purchaseId: document.id,
      })),
      options.now,
    )
    await receiveAgainstOrder(trx, line, baseQty, index)
  }

  if (document.order_id) await refreshOrderStatus(trx, document.order_id)
}

async function postReturn(
  trx: Kysely<Database>,
  document: PurchaseRecord,
  lines: PurchaseLine[],
  rules: Map<string, VariantRule>,
  options: PostingOptions,
): Promise<void> {
  const repo = purchasingRepo(trx)
  const ledger = stockLedger(trx, options.context)

  for (const [index, line] of lines.entries()) {
    const rule = rules.get(line.variant_id)!
    if (Number(line.qty_milli) <= 0) throw lineField(index, 'qtyMilli', 'QUANTITY_INVALID')
    const baseQty = baseQuantity(line, rule, index)

    const serials = checkSerials(parseSerials(line), rule, baseQty, index)
    const existing = await repo.existingSerials(line.variant_id, serials)
    if (existing.length !== serials.length || existing.some(({ status }) => status !== 'in_stock')) {
      throw lineField(index, 'serials', 'SERIAL_NOT_IN_STOCK')
    }
    if (serials.length > 0) await repo.setSerialStatus(line.variant_id, serials, 'returned')

    // Expired stock is exactly what often goes back to a supplier.
    const lots = await issueLots(trx, line, rule, document.warehouse_id, baseQty, { ...options, includeExpired: true })
    const planned = lots.reduce((sum, { qtyMilli }) => sum + qtyMilli, 0)

    if (rule.trackLots) {
      assertCovered(line, baseQty, planned, options)
      for (const { lotId, qtyMilli } of lots) {
        await ledger.post({ variantId: line.variant_id, warehouseId: document.warehouse_id, lotId, qtyMilli: -qtyMilli })
      }
      if (planned < baseQty) {
        await ledger.post({ variantId: line.variant_id, warehouseId: document.warehouse_id, lotId: null, qtyMilli: -(baseQty - planned) })
      }
    } else {
      await ledger.post({ variantId: line.variant_id, warehouseId: document.warehouse_id, lotId: null, qtyMilli: -baseQty })
    }
  }
}

export interface PurchasePosting extends PostingOptions {
  context: LedgerContext
}

export async function postPurchase(trx: Kysely<Database>, document: PurchaseRecord, options: PurchasePosting): Promise<void> {
  const repo = purchasingRepo(trx)
  const suppliers = suppliersRepo(trx)
  const lines = await repo.linesOf(document.id)
  if (lines.length === 0) throw new AppError('DOCUMENT_EMPTY')

  const supplier = await suppliers.find(document.supplier_id)
  if (!supplier) throw new AppError('NOT_FOUND')
  if (supplier.archived_at !== null) throw new AppError('SUPPLIER_ARCHIVED')

  const { totalMinor } = purchaseAmounts(lines)
  const paid = Number(document.paid_minor)
  const invoice = document.kind === 'invoice'
  if (invoice && paid > totalMinor) throw fieldError('paidMinor', 'PAID_EXCEEDS_TOTAL')

  const rules = await stockRepo(trx).variantRules([...new Set(lines.map((line) => line.variant_id))])
  await (invoice ? postInvoice : postReturn)(trx, document, lines, rules, options)

  const { context } = options
  const ledgerContext = {
    source: invoice ? 'purchase' : 'purchase_return',
    documentId: document.id,
    documentNumber: context.documentNumber,
    actorId: context.actorId,
    occurredAt: context.occurredAt,
    businessDate: context.businessDate,
  }
  await supplierLedger(trx, ledgerContext).post(document.supplier_id, invoice ? totalMinor : -totalMinor)

  if (invoice && paid > 0) {
    const id = newId()
    const number = `${PAYMENT_PREFIX}-${String(await nextSequence(trx, 'document:payment')).padStart(6, '0')}`
    await suppliers.insertPayment({
      id,
      number,
      supplier_id: document.supplier_id,
      amount_minor: paid,
      method: document.payment_method ?? 'cash',
      reference: null,
      notes: null,
      status: 'posted',
      purchase_id: document.id,
      created_by: context.actorId,
      created_at: context.occurredAt,
      voided_at: null,
    })
    await supplierLedger(trx, { ...ledgerContext, source: 'payment', documentId: id, documentNumber: number }).post(
      document.supplier_id,
      -paid,
    )
  }
}

export async function voidPurchase(trx: Kysely<Database>, document: PurchaseRecord, context: LedgerContext): Promise<void> {
  const repo = purchasingRepo(trx)
  const suppliers = suppliersRepo(trx)
  const lines = await repo.linesOf(document.id)

  if (document.kind === 'invoice') {
    const serials = await repo.serialsOfPurchase(document.id)
    if (serials.some(({ status }) => status !== 'in_stock')) throw new AppError('SERIAL_ALREADY_SOLD')
    await repo.deleteSerialsOfPurchase(document.id)
  } else {
    for (const line of lines) {
      const serials = parseSerials(line)
      if (serials.length > 0) await repo.setSerialStatus(line.variant_id, serials, 'in_stock')
    }
  }

  await stockLedger(trx, context).reverse(document.id)

  const ledgerContext = {
    source: document.kind === 'invoice' ? 'purchase' : 'purchase_return',
    documentId: document.id,
    documentNumber: context.documentNumber,
    actorId: context.actorId,
    occurredAt: context.occurredAt,
    businessDate: context.businessDate,
  }
  await supplierLedger(trx, ledgerContext).reverse(document.id)

  // Money paid with the invoice goes back on the statement with it.
  for (const payment of await suppliers.paymentsOfPurchase(document.id)) {
    await supplierLedger(trx, { ...ledgerContext, source: 'payment', documentId: payment.id, documentNumber: payment.number }).reverse(payment.id)
    await suppliers.voidPayment(payment.id, context.occurredAt)
  }

  for (const line of lines) {
    if (!line.order_line_id) continue
    const rules = await stockRepo(trx).variantRules([line.variant_id])
    const baseQty = baseQuantity(line, rules.get(line.variant_id)!, 0)
    const orderLine = await repo.findOrderLine(line.order_line_id)
    if (orderLine) {
      await repo.updateOrderLine(orderLine.id, {
        received_base_milli: Math.max(Number(orderLine.received_base_milli) - baseQty, 0),
      })
    }
  }
  if (document.order_id) await refreshOrderStatus(trx, document.order_id)
}

import { issueValue } from '@inv/domain'
import type { Kysely } from 'kysely'
import { isSqlite } from './dialect'
import { newId } from './ids'
import type { Database } from './schema'

/** A failed stock check, carrying what the error message needs to be specific. */
export class InsufficientStock extends Error {
  constructor(
    readonly variantId: string,
    readonly lotId: string | null,
    readonly availableMilli: number,
    readonly requestedMilli: number,
  ) {
    super('Insufficient stock')
  }
}

export interface LedgerContext {
  documentId: string
  documentType: string
  actorId: string | null
  occurredAt: number
  businessDate: string
  allowNegative: boolean
}

export interface LedgerEntry {
  variantId: string
  warehouseId: string
  lotId: string | null
  qtyMilli: number
  /** Required on receipts. Issues are valued from the moving average. */
  valueMinor?: number
}

const lotKey = (lotId: string | null) => lotId ?? ''

/**
 * The only code that writes stock. Every change is one movement, plus its balance and the
 * variant's totals, in the caller's transaction, so the three can never disagree.
 */
export function stockLedger(db: Kysely<Database>, context: LedgerContext) {
  const lockForPosting = !isSqlite(db)

  async function readVariant(variantId: string) {
    const row = await db
      .selectFrom('product_variants')
      .leftJoin('variant_stock', 'variant_stock.variant_id', 'product_variants.id')
      .select(['product_variants.cost_minor', 'variant_stock.qty_milli', 'variant_stock.value_minor'])
      .where('product_variants.id', '=', variantId)
      .$if(lockForPosting, (query) => query.forUpdate('product_variants'))
      .executeTakeFirstOrThrow()

    return {
      onHandMilli: Number(row.qty_milli ?? 0),
      valueMinor: Number(row.value_minor ?? 0),
      fallbackCostMinor: Number(row.cost_minor),
    }
  }

  async function readBalance(entry: Pick<LedgerEntry, 'variantId' | 'warehouseId' | 'lotId'>): Promise<number> {
    const row = await db
      .selectFrom('stock_balances')
      .select('qty_milli')
      .where('variant_id', '=', entry.variantId)
      .where('warehouse_id', '=', entry.warehouseId)
      .where('lot_key', '=', lotKey(entry.lotId))
      .executeTakeFirst()
    return Number(row?.qty_milli ?? 0)
  }

  async function write(entry: LedgerEntry, valueMinor: number, reversalOf: string | null): Promise<void> {
    const { variantId, warehouseId, lotId, qtyMilli } = entry

    await db
      .insertInto('stock_movements')
      .values({
        id: newId(),
        occurred_at: context.occurredAt,
        business_date: context.businessDate,
        variant_id: variantId,
        warehouse_id: warehouseId,
        lot_id: lotId,
        qty_milli: qtyMilli,
        value_minor: valueMinor,
        document_id: context.documentId,
        document_type: context.documentType,
        reversal_of: reversalOf,
        actor_id: context.actorId,
      })
      .execute()

    await db
      .insertInto('stock_balances')
      .values({ variant_id: variantId, warehouse_id: warehouseId, lot_key: lotKey(lotId), lot_id: lotId, qty_milli: qtyMilli })
      .onConflict((oc) =>
        oc
          .columns(['variant_id', 'warehouse_id', 'lot_key'])
          .doUpdateSet((eb) => ({ qty_milli: eb('stock_balances.qty_milli', '+', qtyMilli) })),
      )
      .execute()

    await db
      .insertInto('variant_stock')
      .values({ variant_id: variantId, qty_milli: qtyMilli, value_minor: valueMinor })
      .onConflict((oc) =>
        oc.column('variant_id').doUpdateSet((eb) => ({
          qty_milli: eb('variant_stock.qty_milli', '+', qtyMilli),
          value_minor: eb('variant_stock.value_minor', '+', valueMinor),
        })),
      )
      .execute()
  }

  async function assertAvailable(entry: LedgerEntry): Promise<void> {
    if (entry.qtyMilli >= 0 || context.allowNegative) return
    const available = await readBalance(entry)
    if (available + entry.qtyMilli < 0) {
      throw new InsufficientStock(entry.variantId, entry.lotId, available, -entry.qtyMilli)
    }
  }

  /** With nothing left there must be no value left, whatever rounding or voids did before. */
  function settledValue(onHandMilli: number, valueMinor: number, qtyMilli: number, proposed: number): number {
    return onHandMilli + qtyMilli === 0 ? -valueMinor : proposed
  }

  async function post(entry: LedgerEntry): Promise<number> {
    await assertAvailable(entry)
    const { onHandMilli, valueMinor, fallbackCostMinor } = await readVariant(entry.variantId)

    const proposed =
      entry.qtyMilli > 0
        ? (entry.valueMinor ?? 0)
        : -issueValue(-entry.qtyMilli, onHandMilli, valueMinor, fallbackCostMinor)

    const movementValue = settledValue(onHandMilli, valueMinor, entry.qtyMilli, proposed)
    await write(entry, movementValue, null)
    return movementValue
  }

  return {
    post,

    /** Moves stock without changing what it is worth. */
    async transfer(entry: Omit<LedgerEntry, 'warehouseId' | 'qtyMilli'> & { qtyMilli: number; from: string; to: string }) {
      const { variantId, lotId, qtyMilli, from, to } = entry
      const outbound: LedgerEntry = { variantId, lotId, warehouseId: from, qtyMilli: -qtyMilli }
      await assertAvailable(outbound)
      const { onHandMilli, valueMinor, fallbackCostMinor } = await readVariant(variantId)
      const moved = issueValue(qtyMilli, onHandMilli, valueMinor, fallbackCostMinor)
      await write(outbound, -moved, null)
      await write({ variantId, lotId, warehouseId: to, qtyMilli }, moved, null)
    },

    /** Posts the exact opposite of a document, leaving its movements untouched in history. */
    async reverse(originalDocumentId: string): Promise<void> {
      const movements = await db
        .selectFrom('stock_movements')
        .selectAll()
        .where('document_id', '=', originalDocumentId)
        .where('reversal_of', 'is', null)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .execute()

      for (const movement of movements) {
        const entry: LedgerEntry = {
          variantId: movement.variant_id,
          warehouseId: movement.warehouse_id,
          lotId: movement.lot_id,
          qtyMilli: -Number(movement.qty_milli),
        }
        await assertAvailable(entry)
        const { onHandMilli, valueMinor } = await readVariant(entry.variantId)
        const value = settledValue(onHandMilli, valueMinor, entry.qtyMilli, -Number(movement.value_minor))
        await write(entry, value, movement.id)
      }
    },
  }
}

import type { HeldLine, HeldSale, PosItem } from '@inv/contracts'
import { priceForUnit } from '@inv/domain'
import { useSyncExternalStore } from 'react'

export interface CartLine extends HeldLine {
  key: string
}

export interface CartCustomer {
  id: string
  name: string
}

export interface Cart {
  lines: CartLine[]
  selected: string | null
  customer: CartCustomer | null
  discountMinor: number
  heldId: string | null
  // Kept until the sale goes through, so a retry can't ring it up twice.
  requestId: string
}

const emptyCart = (): Cart => ({
  lines: [],
  selected: null,
  customer: null,
  discountMinor: 0,
  heldId: null,
  requestId: crypto.randomUUID(),
})

// Outside React, so stepping away to look something up doesn't lose the sale in progress.
let cart = emptyCart()
const listeners = new Set<() => void>()

function update(next: Cart): void {
  cart = next
  listeners.forEach((listener) => listener())
}

export function useCart(): Cart {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => cart,
  )
}

export function unitPriceOf(item: PosItem, unitId: string): number {
  const factor = unitId === item.baseUnitId ? 1000 : (item.units.find((unit) => unit.unitId === unitId)?.factorMilli ?? 1000)
  return priceForUnit(item.prices, unitId, item.baseUnitId, factor) ?? 0
}

export const cartActions = {
  /** A repeated scan adds to the same line, unless the line has to stay one piece at a time. */
  add(item: PosItem, multiplierMilli: number): void {
    const qtyMilli = item.scaleQtyMilli ?? multiplierMilli
    const existing = cart.lines.find(
      (line) => line.item.variantId === item.variantId && line.unitId === item.unitId && item.scaleQtyMilli === null,
    )

    if (existing) {
      update({
        ...cart,
        selected: existing.key,
        lines: cart.lines.map((line) => (line === existing ? { ...line, qtyMilli: line.qtyMilli + qtyMilli } : line)),
      })
      return
    }

    const key = crypto.randomUUID()
    update({
      ...cart,
      selected: key,
      lines: [
        ...cart.lines,
        {
          key,
          item,
          unitId: item.unitId,
          qtyMilli,
          unitPriceMinor: unitPriceOf(item, item.unitId),
          discountMinor: 0,
          lotId: null,
          serials: [],
        },
      ],
    })
  },

  patch(key: string, changes: Partial<CartLine>): void {
    update({ ...cart, lines: cart.lines.map((line) => (line.key === key ? { ...line, ...changes } : line)) })
  },

  remove(key: string): void {
    const index = cart.lines.findIndex((line) => line.key === key)
    const lines = cart.lines.filter((line) => line.key !== key)
    update({ ...cart, lines, selected: (lines[index] ?? lines.at(-1))?.key ?? null })
  },

  select(key: string): void {
    update({ ...cart, selected: key })
  },

  move(step: 1 | -1): void {
    const index = cart.lines.findIndex((line) => line.key === cart.selected)
    const next = cart.lines[index + step]
    if (next) update({ ...cart, selected: next.key })
  },

  setCustomer(customer: CartCustomer | null): void {
    update({ ...cart, customer })
  },

  setDiscount(discountMinor: number): void {
    update({ ...cart, discountMinor })
  },

  load(held: HeldSale): void {
    const lines = held.lines.map((line) => ({ ...line, key: crypto.randomUUID() }))
    update({ ...emptyCart(), lines, selected: lines.at(-1)?.key ?? null, customer: held.customer, discountMinor: held.discountMinor, heldId: held.id })
  },

  clear(): void {
    update(emptyCart())
  },
}

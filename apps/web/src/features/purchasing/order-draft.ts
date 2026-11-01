export interface OrderDraftLine {
  variantId: string
  name: string
  baseUnitId: string
  qtyMilli: number
  costMinor: number
}

// Handed from the reorder report to a new order. The page reads it once, then clears it.
let draft: OrderDraftLine[] = []

export function setOrderDraft(lines: OrderDraftLine[]): void {
  draft = lines
}

export const peekOrderDraft = (): OrderDraftLine[] => draft

export function clearOrderDraft(): void {
  draft = []
}

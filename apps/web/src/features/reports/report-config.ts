import type { ColumnKind, ReportKey } from '@inv/contracts'

export interface ReportColumn {
  key: string
  /** A key under `reports.columns`, when it differs from `key`. */
  label?: string
  kind: ColumnKind
  width: string
  /** Hidden unless the viewer may see cost. */
  cost?: boolean
  /** Translations for a column that holds a code, under this prefix. Unknown codes stay as they are. */
  values?: 'stock.kinds' | 'reference.warehouses'
  link?: (row: Record<string, unknown>) => { to: string; params: Record<string, string> } | null
}

export interface ReportDefinition {
  group: 'sales' | 'stock' | 'accounts'
  range?: boolean
  /** Reports asking how far to look, with the number of days they start from. */
  days?: number
  landscape?: boolean
  columns: ReportColumn[]
}

const ITEM_WIDTH = 'minmax(12rem,1fr)'

const itemLink = (row: Record<string, unknown>) => ({ to: '/products/$id/stock', params: { id: String(row.productId) } })

function documentLink(row: Record<string, unknown>) {
  const id = String(row.documentId)
  const kind = String(row.kind)
  if (kind === 'sale' || kind === 'sale_return') return { to: '/sales/$id', params: { id } }
  if (kind === 'purchase' || kind === 'purchase_return') return { to: '/purchases/$id', params: { id } }
  return { to: '/stock/$id', params: { id } }
}

export const REPORTS: Record<ReportKey, ReportDefinition> = {
  sales: {
    group: 'sales',
    range: true,
    landscape: true,
    columns: [
      { key: 'date', kind: 'date', width: '7rem' },
      { key: 'salesCount', kind: 'number', width: '5rem' },
      { key: 'salesMinor', kind: 'money', width: '1fr' },
      { key: 'returnsMinor', kind: 'money', width: '1fr' },
      { key: 'netMinor', kind: 'money', width: '1fr' },
      { key: 'discountMinor', kind: 'money', width: '1fr' },
      { key: 'taxMinor', kind: 'money', width: '1fr' },
      { key: 'costMinor', kind: 'money', width: '1fr', cost: true },
      { key: 'profitMinor', kind: 'money', width: '1fr', cost: true },
    ],
  },
  items: {
    group: 'sales',
    range: true,
    columns: [
      { key: 'name', kind: 'text', width: ITEM_WIDTH, link: itemLink },
      { key: 'abc', kind: 'text', width: '4rem' },
      { key: 'qtyMilli', kind: 'quantity', width: '6rem' },
      { key: 'salesMinor', kind: 'money', width: '8rem' },
      { key: 'costMinor', kind: 'money', width: '8rem', cost: true },
      { key: 'profitMinor', kind: 'money', width: '8rem', cost: true },
    ],
  },
  inventory: {
    group: 'stock',
    columns: [
      { key: 'name', kind: 'text', width: ITEM_WIDTH, link: itemLink },
      { key: 'category', kind: 'text', width: '9rem' },
      { key: 'onHandMilli', kind: 'quantity', width: '6rem' },
      { key: 'averageCostMinor', kind: 'money', width: '7rem', cost: true },
      { key: 'valueMinor', kind: 'money', width: '8rem', cost: true },
    ],
  },
  movements: {
    group: 'stock',
    range: true,
    landscape: true,
    columns: [
      { key: 'occurredAt', kind: 'dateTime', width: '9rem' },
      { key: 'name', kind: 'text', width: 'minmax(8rem,1fr)', link: itemLink },
      { key: 'kind', kind: 'text', width: '6.5rem', values: 'stock.kinds' },
      { key: 'documentNumber', kind: 'text', width: '6.5rem', link: documentLink },
      { key: 'warehouse', kind: 'text', width: '7.5rem', values: 'reference.warehouses' },
      { key: 'lotNo', kind: 'text', width: '5rem' },
      { key: 'qtyMilli', kind: 'quantity', width: '4rem' },
      { key: 'valueMinor', kind: 'money', width: '6rem', cost: true },
    ],
  },
  reorder: {
    group: 'stock',
    columns: [
      { key: 'name', kind: 'text', width: ITEM_WIDTH, link: itemLink },
      { key: 'supplier', kind: 'text', width: '10rem' },
      { key: 'onHandMilli', kind: 'quantity', width: '6rem' },
      { key: 'levelMilli', kind: 'quantity', width: '6rem' },
      { key: 'soldLastMonthMilli', kind: 'quantity', width: '7rem' },
      { key: 'suggestedMilli', kind: 'quantity', width: '6rem' },
    ],
  },
  expiry: {
    group: 'stock',
    days: 90,
    columns: [
      { key: 'name', kind: 'text', width: ITEM_WIDTH, link: itemLink },
      { key: 'lotNo', kind: 'text', width: '8rem' },
      { key: 'expiryDate', kind: 'date', width: '7rem' },
      { key: 'daysLeft', kind: 'number', width: '7rem' },
      { key: 'warehouse', kind: 'text', width: '8rem', values: 'reference.warehouses' },
      { key: 'qtyMilli', kind: 'quantity', width: '6rem' },
    ],
  },
  dead: {
    group: 'stock',
    days: 90,
    columns: [
      { key: 'name', kind: 'text', width: ITEM_WIDTH, link: itemLink },
      { key: 'lastSoldOn', kind: 'date', width: '8rem' },
      { key: 'onHandMilli', kind: 'quantity', width: '7rem' },
      { key: 'valueMinor', kind: 'money', width: '8rem', cost: true },
    ],
  },
  suppliers: {
    group: 'accounts',
    range: true,
    columns: [
      { key: 'name', label: 'partyName', kind: 'text', width: ITEM_WIDTH, link: (row) => ({ to: '/suppliers/$id', params: { id: String(row.id) } }) },
      { key: 'purchasesMinor', kind: 'money', width: '8rem' },
      { key: 'returnsMinor', kind: 'money', width: '8rem' },
      { key: 'paidMinor', kind: 'money', width: '8rem' },
      { key: 'balanceMinor', kind: 'money', width: '8rem' },
    ],
  },
  customers: {
    group: 'accounts',
    range: true,
    columns: [
      { key: 'name', label: 'partyName', kind: 'text', width: ITEM_WIDTH, link: (row) => ({ to: '/customers/$id', params: { id: String(row.id) } }) },
      { key: 'salesMinor', kind: 'money', width: '8rem' },
      { key: 'returnsMinor', kind: 'money', width: '8rem' },
      { key: 'collectedMinor', kind: 'money', width: '8rem' },
      { key: 'balanceMinor', kind: 'money', width: '8rem' },
    ],
  },
  shifts: {
    group: 'accounts',
    range: true,
    landscape: true,
    columns: [
      { key: 'number', kind: 'text', width: '7rem', link: (row) => ({ to: '/shifts/$id', params: { id: String(row.id) } }) },
      { key: 'cashier', kind: 'text', width: 'minmax(7rem,1fr)' },
      { key: 'openedAt', kind: 'dateTime', width: '9rem' },
      { key: 'salesMinor', kind: 'money', width: '6rem' },
      { key: 'returnsMinor', kind: 'money', width: '6rem' },
      { key: 'expectedCashMinor', kind: 'money', width: '6rem' },
      { key: 'countedCashMinor', kind: 'money', width: '6rem' },
      { key: 'differenceMinor', kind: 'money', width: '6rem' },
    ],
  },
}

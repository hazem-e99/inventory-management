import type { Generated } from 'kysely'

// Booleans are 0/1 integers and timestamps are epoch ms, which read the same on both dialects.
export interface SettingsTable {
  key: string
  value: string
  updated_at: number
}

export interface RolesTable {
  id: string
  name: string
  is_system: number
  created_at: number
}

export interface RolePermissionsTable {
  role_id: string
  permission: string
}

export interface UsersTable {
  id: string
  username: string
  full_name: string
  password_hash: string
  pin_hash: string | null
  role_id: string
  is_active: Generated<number>
  must_change_password: Generated<number>
  failed_attempts: Generated<number>
  locked_until: number | null
  created_at: number
  updated_at: number
}

export interface SessionsTable {
  token_hash: string
  user_id: string
  created_at: number
  expires_at: number
}

export interface AuditLogTable {
  id: string
  actor_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  details: string | null
  occurred_at: number
}

export interface DocumentSequencesTable {
  key: string
  last_value: number
}

export interface CategoriesTable {
  id: string
  name: string
  parent_id: string | null
  archived_at: number | null
  created_at: number
}

export interface NamedReferenceTable {
  id: string
  name: string
  is_system: Generated<number>
  archived_at: number | null
  created_at: number
}

export interface UnitsTable extends NamedReferenceTable {
  allows_fraction: Generated<number>
}

export interface TaxRatesTable extends NamedReferenceTable {
  rate_bp: number
}

export interface AttributesTable {
  id: string
  name: string
  is_system: Generated<number>
  created_at: number
}

export interface AttributeValuesTable {
  id: string
  attribute_id: string
  value: string
  created_at: number
}

export interface ProductsTable {
  id: string
  name: string
  name_en: string | null
  generic_name: string | null
  description: string | null
  search_text: string
  category_id: string | null
  brand_id: string | null
  tax_rate_id: string | null
  base_unit_id: string
  prescription_required: number
  track_lots: number
  track_serials: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

export interface UnitConversionsTable {
  product_id: string
  unit_id: string
  factor_milli: number
}

export interface ProductVariantsTable {
  id: string
  product_id: string
  sku: string
  label: string | null
  cost_minor: number
  reorder_level_milli: Generated<number | null>
  is_default: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

export interface VariantAttributeValuesTable {
  variant_id: string
  value_id: string
}

export interface BarcodesTable {
  code: string
  variant_id: string
  unit_id: string
  created_at: number
}

export interface VariantPricesTable {
  variant_id: string
  price_list_id: string
  unit_id: string
  amount_minor: number
}

export interface LotsTable {
  id: string
  variant_id: string
  lot_no: string
  expiry_date: string | null
  created_at: number
}

export interface StockDocumentsTable {
  id: string
  kind: string
  status: string
  number: string | null
  warehouse_id: string
  to_warehouse_id: string | null
  reason: string | null
  notes: string | null
  business_date: string | null
  created_by: string | null
  created_at: number
  posted_at: number | null
  voided_at: number | null
}

export interface StockDocumentLinesTable {
  id: string
  document_id: string
  position: number
  variant_id: string
  unit_id: string
  qty_milli: number
  lot_id: string | null
  lot_no: string | null
  expiry_date: string | null
  unit_cost_minor: number | null
  expected_milli: number | null
}

export interface StockMovementsTable {
  id: string
  occurred_at: number
  business_date: string
  variant_id: string
  warehouse_id: string
  lot_id: string | null
  qty_milli: number
  value_minor: number
  document_id: string
  document_type: string
  document_number: string | null
  reversal_of: string | null
  actor_id: string | null
}

export interface StockBalancesTable {
  variant_id: string
  warehouse_id: string
  lot_key: string
  lot_id: string | null
  qty_milli: number
}

export interface VariantStockTable {
  variant_id: string
  qty_milli: number
  value_minor: number
}

export interface SuppliersTable {
  id: string
  name: string
  phone: string | null
  address: string | null
  tax_number: string | null
  notes: string | null
  search_text: string
  balance_minor: Generated<number>
  archived_at: number | null
  created_at: number
  updated_at: number
}

export interface SupplierLedgerTable {
  id: string
  supplier_id: string
  occurred_at: number
  business_date: string
  amount_minor: number
  balance_after_minor: number
  source: string
  document_id: string
  document_number: string | null
  reversal_of: string | null
  actor_id: string | null
}

export interface PurchaseOrdersTable {
  id: string
  number: string | null
  status: string
  supplier_id: string
  warehouse_id: string
  expected_date: string | null
  notes: string | null
  created_by: string | null
  created_at: number
}

export interface PurchaseOrderLinesTable {
  id: string
  order_id: string
  position: number
  variant_id: string
  unit_id: string
  qty_milli: number
  unit_cost_minor: number
  ordered_base_milli: Generated<number>
  received_base_milli: Generated<number>
}

export interface PurchaseDocumentsTable {
  id: string
  kind: string
  status: string
  number: string | null
  supplier_id: string
  warehouse_id: string
  order_id: string | null
  supplier_reference: string | null
  notes: string | null
  paid_minor: number
  payment_method: string | null
  business_date: string | null
  created_by: string | null
  created_at: number
  posted_at: number | null
  voided_at: number | null
}

export interface PurchaseDocumentLinesTable {
  id: string
  document_id: string
  position: number
  variant_id: string
  unit_id: string
  qty_milli: number
  unit_cost_minor: number
  discount_minor: number
  tax_rate_bp: number
  lot_id: string | null
  lot_no: string | null
  expiry_date: string | null
  serials: string | null
  order_line_id: string | null
}

export interface SupplierPaymentsTable {
  id: string
  number: string
  supplier_id: string
  amount_minor: number
  method: string
  reference: string | null
  notes: string | null
  status: string
  purchase_id: string | null
  created_by: string | null
  created_at: number
  voided_at: number | null
}

export interface SerialsTable {
  id: string
  variant_id: string
  serial: string
  status: string
  warehouse_id: string
  purchase_id: string | null
  created_at: number
}

export interface CustomersTable {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  search_text: string
  credit_limit_minor: number | null
  balance_minor: Generated<number>
  archived_at: number | null
  created_at: number
  updated_at: number
}

export interface CustomerLedgerTable {
  id: string
  customer_id: string
  occurred_at: number
  business_date: string
  amount_minor: number
  balance_after_minor: number
  source: string
  document_id: string
  document_number: string | null
  reversal_of: string | null
  actor_id: string | null
}

export interface ShiftsTable {
  id: string
  number: string
  status: string
  user_id: string
  opened_at: number
  closed_at: number | null
  closed_by: string | null
  opening_cash_minor: number
  expected_cash_minor: number | null
  counted_cash_minor: number | null
  notes: string | null
}

export interface SalesTable {
  id: string
  request_id: string
  kind: string
  status: string
  number: string
  return_of: string | null
  customer_id: string | null
  shift_id: string
  warehouse_id: string
  gross_minor: number
  discount_minor: number
  tax_minor: number
  total_minor: number
  cost_minor: Generated<number>
  tendered_minor: number
  change_minor: number
  notes: string | null
  business_date: string
  created_by: string | null
  created_at: number
  voided_at: number | null
  voided_by: string | null
}

export interface SaleLinesTable {
  id: string
  sale_id: string
  position: number
  variant_id: string
  unit_id: string
  item_name: string
  qty_milli: number
  base_qty_milli: number
  unit_price_minor: number
  discount_minor: number
  tax_rate_bp: number
  tax_minor: number
  total_minor: number
  cost_minor: number
  serials: string | null
  return_of_line: string | null
  // The day it counts in reports, cleared when the document is voided.
  report_date: string | null
  is_return: Generated<number>
  returned_base_milli: Generated<number>
  refunded_minor: Generated<number>
  returned_cost_minor: Generated<number>
}

export interface SaleLineLotsTable {
  id: string
  sale_line_id: string
  lot_id: string | null
  qty_milli: number
  returned_milli: Generated<number>
}

export interface SalePaymentsTable {
  id: string
  sale_id: string
  shift_id: string
  method: string
  amount_minor: number
  reversal_of: string | null
  occurred_at: number
}

export interface CustomerReceiptsTable {
  id: string
  number: string
  customer_id: string
  shift_id: string
  amount_minor: number
  method: string
  reference: string | null
  notes: string | null
  status: string
  created_by: string | null
  created_at: number
  voided_at: number | null
}

export interface CashMovementsTable {
  id: string
  shift_id: string
  kind: string
  amount_minor: number
  reason: string | null
  document_id: string | null
  actor_id: string | null
  occurred_at: number
}

export interface HeldSalesTable {
  id: string
  label: string | null
  cart: string
  total_minor: number
  created_by: string | null
  created_at: number
}

export interface Database {
  settings: SettingsTable
  customers: CustomersTable
  customer_ledger: CustomerLedgerTable
  shifts: ShiftsTable
  sales: SalesTable
  sale_lines: SaleLinesTable
  sale_line_lots: SaleLineLotsTable
  sale_payments: SalePaymentsTable
  customer_receipts: CustomerReceiptsTable
  cash_movements: CashMovementsTable
  held_sales: HeldSalesTable
  suppliers: SuppliersTable
  supplier_ledger: SupplierLedgerTable
  purchase_orders: PurchaseOrdersTable
  purchase_order_lines: PurchaseOrderLinesTable
  purchase_documents: PurchaseDocumentsTable
  purchase_document_lines: PurchaseDocumentLinesTable
  supplier_payments: SupplierPaymentsTable
  serials: SerialsTable
  warehouses: NamedReferenceTable
  lots: LotsTable
  stock_documents: StockDocumentsTable
  stock_document_lines: StockDocumentLinesTable
  stock_movements: StockMovementsTable
  stock_balances: StockBalancesTable
  variant_stock: VariantStockTable
  document_sequences: DocumentSequencesTable
  categories: CategoriesTable
  brands: NamedReferenceTable
  price_lists: NamedReferenceTable
  units: UnitsTable
  tax_rates: TaxRatesTable
  attributes: AttributesTable
  attribute_values: AttributeValuesTable
  products: ProductsTable
  unit_conversions: UnitConversionsTable
  product_variants: ProductVariantsTable
  variant_attribute_values: VariantAttributeValuesTable
  barcodes: BarcodesTable
  variant_prices: VariantPricesTable
  roles: RolesTable
  role_permissions: RolePermissionsTable
  users: UsersTable
  sessions: SessionsTable
  audit_log: AuditLogTable
}

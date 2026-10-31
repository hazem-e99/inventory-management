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

export interface Database {
  settings: SettingsTable
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

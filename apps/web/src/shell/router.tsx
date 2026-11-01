import type { Bootstrap } from '@inv/contracts'
import { TableSkeleton } from '@inv/ui'
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'
import { ErrorState } from '../components/states'
import { Shell } from './shell'

interface RouterContext {
  bootstrap: Bootstrap
}

function RootLayout() {
  const { bootstrap } = rootRoute.useRouteContext()
  return <Shell bootstrap={bootstrap} />
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: ({ error, reset }) => <ErrorState error={error} onRetry={reset} />,
  pendingComponent: () => <TableSkeleton />,
})

// Each screen is its own chunk, so the shell and the cashier flow load first.
const page = <T extends string>(path: string, load: () => Promise<Record<T, () => React.JSX.Element>>, name: T) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: lazyRouteComponent(load, name),
  })

const routeTree = rootRoute.addChildren([
  page('/', () => import('../features/home/home-page'), 'HomePage'),
  page('/products', () => import('../features/catalog/products-page'), 'ProductsPage'),
  page('/products/new', () => import('../features/catalog/product-form'), 'ProductFormPage'),
  page('/products/$id', () => import('../features/catalog/product-form'), 'ProductFormPage'),
  page('/products/$id/stock', () => import('../features/stock/product-stock-page'), 'ProductStockPage'),
  page('/catalog', () => import('../features/catalog/reference-page'), 'ReferencePage'),
  page('/stock', () => import('../features/stock/documents-page'), 'DocumentsPage'),
  page('/stock/new/$kind', () => import('../features/stock/document-page'), 'DocumentPage'),
  page('/stock/$id', () => import('../features/stock/document-page'), 'DocumentPage'),
  page('/suppliers', () => import('../features/purchasing/suppliers-page'), 'SuppliersPage'),
  page('/suppliers/$id', () => import('../features/purchasing/supplier-page'), 'SupplierPage'),
  page('/purchases', () => import('../features/purchasing/purchases-page'), 'PurchasesPage'),
  page('/purchases/new/$kind', () => import('../features/purchasing/purchase-page'), 'PurchasePage'),
  page('/purchases/receive/$orderId', () => import('../features/purchasing/purchase-page'), 'PurchasePage'),
  page('/purchases/$id', () => import('../features/purchasing/purchase-page'), 'PurchasePage'),
  page('/orders', () => import('../features/purchasing/orders-page'), 'OrdersPage'),
  page('/orders/new', () => import('../features/purchasing/order-page'), 'OrderPage'),
  page('/orders/$id', () => import('../features/purchasing/order-page'), 'OrderPage'),
  page('/pos', () => import('../features/sales/pos-page'), 'PosPage'),
  page('/sales', () => import('../features/sales/sales-page'), 'SalesPage'),
  page('/sales/$id', () => import('../features/sales/sale-page'), 'SalePage'),
  page('/sales/$id/return', () => import('../features/sales/return-page'), 'ReturnPage'),
  page('/customers', () => import('../features/sales/customers-page'), 'CustomersPage'),
  page('/customers/$id', () => import('../features/sales/customer-page'), 'CustomerPage'),
  page('/shifts', () => import('../features/sales/shifts-page'), 'ShiftsPage'),
  page('/shifts/$id', () => import('../features/sales/shift-page'), 'ShiftPage'),
  page('/reports', () => import('../features/reports/reports-page'), 'ReportsPage'),
  page('/reports/$key', () => import('../features/reports/report-page'), 'ReportPage'),
  page('/license', () => import('../features/license/license-page'), 'LicensePage'),
  page('/users', () => import('../features/users/users-page'), 'UsersPage'),
  page('/roles', () => import('../features/users/roles-page'), 'RolesPage'),
  page('/audit', () => import('../features/audit/audit-page'), 'AuditPage'),
  page('/backups', () => import('../features/backups/backups-page'), 'BackupsPage'),
  page('/settings', () => import('../features/settings/settings-page'), 'SettingsPage'),
  page('/help', () => import('../features/help/help-page'), 'HelpPage'),
])

export function createAppRouter(bootstrap: Bootstrap) {
  return createRouter({
    routeTree,
    // Hash URLs survive a reload under the custom app:// protocol.
    history: createHashHistory(),
    context: { bootstrap },
    defaultPreload: 'intent',
    defaultPendingMs: 150,
  })
}

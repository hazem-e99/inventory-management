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
  page('/catalog', () => import('../features/catalog/reference-page'), 'ReferencePage'),
  page('/users', () => import('../features/users/users-page'), 'UsersPage'),
  page('/roles', () => import('../features/users/roles-page'), 'RolesPage'),
  page('/audit', () => import('../features/audit/audit-page'), 'AuditPage'),
  page('/backups', () => import('../features/backups/backups-page'), 'BackupsPage'),
  page('/settings', () => import('../features/settings/settings-page'), 'SettingsPage'),
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

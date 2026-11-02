import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { FormSkeleton } from '@inv/ui'
import {
  Outlet,
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { ApiError, api, type Overview } from './api'
import { Login, TotpSetup } from './auth-screens'
import { AiUsagePage, CustomerPage, CustomersPage, EventsPage, LicensePage, OverviewPage } from './pages'
import { Shell } from './shell'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

function Gate() {
  const access = useQuery({
    queryKey: ['access'],
    queryFn: () => api<Overview>('GET', '/admin/overview'),
  })

  if (access.isPending) {
    return (
      <div className="mx-auto max-w-md p-8">
        <FormSkeleton fields={2} />
      </div>
    )
  }
  if (access.error instanceof ApiError && access.error.code === 'TOTP_REQUIRED') return <TotpSetup />
  if (access.isError) return <Login />
  return (
    <Shell>
      <Outlet />
    </Shell>
  )
}

const rootRoute = createRootRoute({ component: Gate })
const page = (path: string, component: () => React.JSX.Element) => createRoute({ getParentRoute: () => rootRoute, path, component })

const router = createRouter({
  routeTree: rootRoute.addChildren([
    page('/', OverviewPage),
    page('/customers', CustomersPage),
    page('/customers/$id', CustomerPage),
    page('/licenses/$id', LicensePage),
    page('/ai', AiUsagePage),
    page('/events', EventsPage),
  ]),
  history: createHashHistory(),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-center" dir="rtl" />
    </QueryClientProvider>
  </StrictMode>,
)

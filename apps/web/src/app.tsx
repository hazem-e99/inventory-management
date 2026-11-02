import { bootstrapSchema, type Bootstrap } from '@inv/contracts'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import { CrashBoundary, ErrorState, TopProgress } from './components/states'
import { ForcedPasswordChange, Login } from './features/auth/login'
import { RestoreScreen } from './features/backups/restore'
import { Onboarding } from './features/onboarding/onboarding'
import { api, connect, ApiRequestError } from './lib/api'
import { desktop } from './lib/desktop'
import { PreferencesProvider, usePreferences } from './lib/preferences'
import { SessionProvider, useSession } from './lib/session'
import { createAppRouter } from './shell/router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Permission and validation failures will not change on a retry.
      retry: (failures, error) =>
        failures < 1 && !(error instanceof ApiRequestError && error.error.status < 500 && error.error.status > 0),
    },
  },
})

const bootstrapQuery = {
  queryKey: ['bootstrap'],
  queryFn: () => api(bootstrapSchema, 'GET', '/bootstrap'),
}

function Authenticated({ bootstrap }: { bootstrap: Bootstrap }) {
  // One router for the session: a replacement starts with no screen, and Strict Mode leaves it there.
  const [router] = useState(() => createAppRouter(bootstrap))
  const applied = useRef(bootstrap)

  useEffect(() => {
    if (applied.current === bootstrap) return
    applied.current = bootstrap
    void router.invalidate()
  }, [router, bootstrap])

  return <RouterProvider router={router} context={{ bootstrap }} />
}

/** One place decides which world the user is in, so no screen needs its own guard. */
function Gate({ bootstrap }: { bootstrap: Bootstrap }) {
  const { actor, restoring } = useSession()
  const [restoringBackup, setRestoringBackup] = useState(false)

  if (restoring) return null
  if (restoringBackup) return <RestoreScreen onCancel={() => setRestoringBackup(false)} />
  if (actor?.mustChangePassword) return <ForcedPasswordChange bootstrap={bootstrap} />
  if (actor) return <Authenticated bootstrap={bootstrap} />
  if (!bootstrap.onboarded) return <Onboarding onRestore={() => setRestoringBackup(true)} />
  return <Login bootstrap={bootstrap} />
}

function ThemedToaster() {
  const { preferences } = usePreferences()
  return (
    <Toaster
      dir={preferences.locale === 'ar' ? 'rtl' : 'ltr'}
      position="bottom-center"
      theme={preferences.theme}
      // Tied to the design tokens: the library's rich colours fall short of AA contrast.
      style={
        {
          '--normal-bg': 'var(--surface)',
          '--normal-text': 'var(--ink)',
          '--normal-border': 'var(--rule-strong)',
        } as CSSProperties
      }
      toastOptions={{ style: { fontFamily: 'inherit', fontSize: '1rem' } }}
    />
  )
}

function Loaded() {
  const query = useQuery(bootstrapQuery)
  const { t } = useTranslation()

  if (query.isPending) return <p className="sr-only">{t('app.name')}</p>
  if (query.isError) {
    return (
      <div className="p-8">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    )
  }

  return (
    <PreferencesProvider initial={query.data.preferences}>
      <SessionProvider>
        <CrashBoundary>
          <TopProgress />
          <Gate bootstrap={query.data} />
          <ThemedToaster />
        </CrashBoundary>
      </SessionProvider>
    </PreferencesProvider>
  )
}

const DEFAULT_PREFERENCES = { locale: 'ar', theme: 'system', digits: 'latin' } as const

export function App() {
  const [state, setState] = useState<'loading' | 'ready' | 'restore-required'>('loading')

  useEffect(() => {
    void desktop().startup().then((startup) => {
      if (startup.kind === 'ready') connect(startup)
      setState(startup.kind)
    })
  }, [])

  if (state === 'loading') return null

  return (
    <QueryClientProvider client={queryClient}>
      {state === 'ready' ? (
        <Loaded />
      ) : (
        <PreferencesProvider initial={DEFAULT_PREFERENCES}>
          <RestoreScreen />
          <ThemedToaster />
        </PreferencesProvider>
      )}
    </QueryClientProvider>
  )
}

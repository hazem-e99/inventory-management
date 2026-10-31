import { actorSchema, okSchema, type Actor, type Permission, type Session } from '@inv/contracts'
import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, hasSession, setSessionToken, subscribeSessionLost } from './api'

interface SessionContextValue {
  actor: Actor | null
  restoring: boolean
  signIn(session: Session): void
  setActor(actor: Actor): void
  signOut(): Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [actor, setActor] = useState<Actor | null>(null)
  const [restoring, setRestoring] = useState(hasSession)

  useEffect(() => {
    subscribeSessionLost((code) => {
      setActor(null)
      queryClient.clear()
      toast.error(t(`errors.${code}`))
    })
  }, [queryClient, t])

  useEffect(() => {
    if (!hasSession()) return
    api(actorSchema, 'GET', '/auth/me')
      .then(setActor)
      .catch(() => setSessionToken(null))
      .finally(() => setRestoring(false))
  }, [])

  const signIn = useCallback((session: Session) => {
    setSessionToken(session.token)
    setActor(session.actor)
  }, [])

  const signOut = useCallback(async () => {
    await api(okSchema, 'POST', '/auth/logout').catch(() => {})
    setSessionToken(null)
    setActor(null)
    queryClient.clear()
    toast.dismiss()
  }, [queryClient])

  const value = useMemo(
    () => ({ actor, restoring, signIn, setActor, signOut }),
    [actor, restoring, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession needs SessionProvider')
  return value
}

export function useActor(): Actor {
  const { actor } = useSession()
  if (!actor) throw new Error('useActor needs a signed-in user')
  return actor
}

export function useCan(permission: Permission): boolean {
  return useActor().permissions.includes(permission)
}

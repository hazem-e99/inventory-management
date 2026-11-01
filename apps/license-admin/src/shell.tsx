import { Button, Station } from '@inv/ui'
import { useMutation } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { History, Home, LogOut, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from './api'

const NAV = [
  { to: '/', label: 'الرئيسية', icon: <Home /> },
  { to: '/customers', label: 'العملاء', icon: <Users /> },
  { to: '/events', label: 'سجل العمليات', icon: <History /> },
]

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const signOut = useMutation({
    mutationFn: () => api('POST', '/api/auth/sign-out', {}),
    // A reload leaves nothing of the session in memory, and lands on the sign-in screen.
    onSettled: () => window.location.reload(),
  })

  return (
    <div className="grid h-screen grid-cols-[15rem_1fr]">
      <aside className="flex min-h-0 flex-col border-e border-rule bg-surface">
        <div className="bg-plate px-5 py-4 text-plate-ink">
          <p className="text-lg font-semibold">لوحة التراخيص</p>
          <p className="text-sm text-plate-soft">Super Admin</p>
        </div>
        <nav aria-label="القائمة الرئيسية" className="flex-1 p-3">
          <ul>
            {NAV.map((item, index) => {
              const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
              return (
                <li key={item.to}>
                  <Link to={item.to} className="group block rounded-md" aria-current={active ? 'page' : undefined}>
                    <Station icon={item.icon} label={item.label} active={active} last={index === NAV.length - 1} />
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="border-t border-rule p-2">
          <Button variant="ghost" className="w-full justify-start" loading={signOut.isPending} onClick={() => signOut.mutate()}>
            <LogOut aria-hidden className="size-4" />
            تسجيل الخروج
          </Button>
        </div>
      </aside>
      <main className="min-h-0 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">{children}</div>
      </main>
    </div>
  )
}

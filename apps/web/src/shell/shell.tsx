import type { Bootstrap, Permission } from '@inv/contracts'
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, Station } from '@inv/ui'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Archive, ChevronsUpDown, ClipboardList, FileClock, History, Home, KeyRound, LockKeyhole, LogOut, Package, ReceiptText, Settings, ShieldCheck, Tags, Truck, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AccountDialogs, type AccountPanel } from '../features/auth/account-dialogs'
import { useActor, useSession } from '../lib/session'

type NavKey = 'home' | 'products' | 'stock' | 'purchases' | 'orders' | 'suppliers' | 'catalog' | 'users' | 'roles' | 'audit' | 'backups' | 'settings'

interface NavItem {
  key: NavKey
  to: string
  icon: ReactNode
  permission?: Permission
}

const NAV: NavItem[] = [
  { key: 'home', to: '/', icon: <Home /> },
  { key: 'products', to: '/products', icon: <Package />, permission: 'catalog.view' },
  { key: 'stock', to: '/stock', icon: <ClipboardList />, permission: 'stock.view' },
  { key: 'purchases', to: '/purchases', icon: <ReceiptText />, permission: 'purchases.view' },
  { key: 'orders', to: '/orders', icon: <FileClock />, permission: 'purchases.view' },
  { key: 'suppliers', to: '/suppliers', icon: <Truck />, permission: 'purchases.view' },
  { key: 'catalog', to: '/catalog', icon: <Tags />, permission: 'catalog.manage' },
  { key: 'users', to: '/users', icon: <Users />, permission: 'users.view' },
  { key: 'roles', to: '/roles', icon: <ShieldCheck />, permission: 'users.view' },
  { key: 'audit', to: '/audit', icon: <History />, permission: 'audit.view' },
  { key: 'backups', to: '/backups', icon: <Archive />, permission: 'backups.manage' },
  { key: 'settings', to: '/settings', icon: <Settings /> },
]

function AccountMenu({ onOpen }: { onOpen: (panel: AccountPanel) => void }) {
  const { t } = useTranslation()
  const actor = useActor()
  const { signOut } = useSession()

  return (
    <Menu
      trigger={
        <Button variant="ghost" className="h-auto w-full justify-between px-3 py-2">
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate font-medium text-ink">{actor.fullName}</span>
            <bdi dir="ltr" className="truncate text-sm text-ink-faint">
              {actor.username}
            </bdi>
          </span>
          <span className="sr-only">{t('account.menu')}</span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0" />
        </Button>
      }
    >
      <MenuLabel>{actor.fullName}</MenuLabel>
      <MenuItem onSelect={() => onOpen('password')}>
        <LockKeyhole aria-hidden />
        {t('account.changePassword')}
      </MenuItem>
      <MenuItem onSelect={() => onOpen('pin')}>
        <KeyRound aria-hidden />
        {t('account.setPin')}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => void signOut()}>
        <LogOut aria-hidden />
        {t('account.signOut')}
      </MenuItem>
    </Menu>
  )
}

export function Shell({ bootstrap }: { bootstrap: Bootstrap }) {
  const { t } = useTranslation()
  const actor = useActor()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [panel, setPanel] = useState<AccountPanel>(null)

  const items = NAV.filter((item) => !item.permission || actor.permissions.includes(item.permission))

  return (
    <div className="grid h-screen grid-cols-[17rem_1fr]">
      <aside className="flex min-h-0 flex-col border-e border-rule bg-surface">
        <div className="bg-plate px-5 py-4 text-plate-ink">
          <p className="truncate text-lg leading-snug font-semibold">{bootstrap.store?.name}</p>
          <p className="text-sm text-plate-soft">{bootstrap.store && t(`business.${bootstrap.store.businessType}.name`)}</p>
        </div>

        <nav aria-label={t('nav.main')} className="min-h-0 flex-1 overflow-y-auto p-3">
          <ul>
            {items.map((item, index) => {
              const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
              return (
                <li key={item.key}>
                  <Link to={item.to} className="group block rounded-md" aria-current={active ? 'page' : undefined}>
                    <Station
                      icon={item.icon}
                      label={t(`nav.${item.key}.label`)}
                      active={active}
                      last={index === items.length - 1}
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t border-rule p-2">
          <AccountMenu onOpen={setPanel} />
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto">
        <div className="mx-auto flex h-full max-w-6xl flex-col p-8">
          <Outlet />
        </div>
      </main>

      <AccountDialogs panel={panel} onClose={() => setPanel(null)} />
    </div>
  )
}

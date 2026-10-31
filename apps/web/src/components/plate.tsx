import { Button, cn } from '@inv/ui'
import { Languages } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { usePreferences } from '../lib/preferences'

export function LanguageSwitch({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { preferences, update } = usePreferences()
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => update({ locale: preferences.locale === 'ar' ? 'en' : 'ar' })}
    >
      <Languages aria-hidden className="size-4" />
      <span lang={preferences.locale === 'ar' ? 'en' : 'ar'}>{t('language.switch')}</span>
    </Button>
  )
}

/**
 * The enamel sign beside every pre-sign-in form: it names where you are, in both languages,
 * and carries the stops of the journey.
 */
export function PlateLayout({
  sign,
  secondary,
  plate,
  footer,
  children,
}: {
  sign: ReactNode
  secondary?: ReactNode
  plate?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid min-h-screen grid-cols-[minmax(20rem,28rem)_1fr]">
      <aside className="flex flex-col justify-between gap-10 bg-plate p-10 text-plate-ink">
        <div className="flex flex-col gap-1 border-b-2 border-plate-route pb-6">
          <p className="text-3xl leading-tight font-semibold">{sign}</p>
          {secondary && <p className="text-lg text-plate-soft">{secondary}</p>}
        </div>
        <div className="flex-1">{plate}</div>
        {footer && <div className="text-sm text-plate-soft">{footer}</div>}
      </aside>

      <main className="relative flex items-center justify-center px-10 py-12">
        <LanguageSwitch className="absolute end-6 top-6" />
        <div className={cn('w-full max-w-lg')}>{children}</div>
      </main>
    </div>
  )
}

export function FormHeading({ title, body }: { title: ReactNode; body?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <h1 className="text-2xl leading-tight font-semibold text-ink">{title}</h1>
      {body && <p className="text-ink-soft">{body}</p>}
    </div>
  )
}

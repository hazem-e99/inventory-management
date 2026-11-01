import { Button, Sign } from '@inv/ui'
import { useRouteContext } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { desktop } from '../../lib/desktop'

const TOPICS = ['start', 'sell', 'stock', 'purchases', 'reports', 'backup', 'license'] as const
const SHORTCUTS = ['F2', 'F3', 'F4', 'F6', 'F7', 'F9', 'F12', 'Escape'] as const

function Topic({ topic }: { topic: (typeof TOPICS)[number] }) {
  const { t } = useTranslation()
  const steps = t(`help.topics.${topic}.steps`, { returnObjects: true }) as unknown as string[]

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-ink">{t(`help.topics.${topic}.title`)}</h2>
      <ol className="flex list-decimal flex-col gap-1 ps-5 text-ink-soft">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  )
}

export function HelpPage() {
  const { t } = useTranslation()
  const { bootstrap } = useRouteContext({ from: '__root__' })

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <Sign title={t('nav.help.label')} secondary={t('nav.help.other')} />

      {TOPICS.map((topic) => (
        <Topic key={topic} topic={topic} />
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('help.shortcuts')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-ink-soft">
          {SHORTCUTS.map((key) => (
            <div key={key} className="contents">
              <dt>
                <kbd dir="ltr" className="rounded border border-rule bg-surface px-2 py-0.5 text-sm text-ink">
                  {key === 'Escape' ? 'Esc' : key}
                </kbd>
              </dt>
              <dd>{t(`help.keys.${key}`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col items-start gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('help.support')}</h2>
        <p className="text-ink-soft">{t('help.supportBody')}</p>
        <Button variant="secondary" onClick={() => void desktop().openLogs()}>
          {t('help.openLogs')}
        </Button>
        <p className="text-sm text-ink-soft">{t('help.version', { version: bootstrap.version })}</p>
      </section>
    </div>
  )
}

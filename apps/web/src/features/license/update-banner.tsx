import { Button } from '@inv/ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { desktop } from '../../lib/desktop'

/** Offers the restart, and never forces it: closing the app at night installs it anyway. */
export function UpdateBanner() {
  const { t } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    void desktop().updateReady().then(setVersion)
    return desktop().onUpdateReady(setVersion)
  }, [])

  if (!version) return null

  return (
    <div role="status" className="flex shrink-0 items-center justify-between gap-4 border-b border-rule bg-route-soft px-6 py-2 text-ink">
      <span>{t('common.updateReady', { version })}</span>
      <Button size="sm" onClick={() => void desktop().installUpdate()}>
        {t('common.updateRestart')}
      </Button>
    </div>
  )
}

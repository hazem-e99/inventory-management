import { recoveryCodeSchema } from '@inv/contracts'
import { Button } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { FileArchive } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SubmitButton, TextField } from '../../components/form'
import { FormHeading, PlateLayout } from '../../components/plate'
import { desktop } from '../../lib/desktop'
import { useErrorText } from '../../lib/errors'

const schema = z.object({ recoveryCode: recoveryCodeSchema })

/** Shared by the Backups screen and by startup when the database cannot be opened. */
export function RestoreForm({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation()
  const errorText = useErrorText()
  const [path, setPath] = useState<string | null>(null)
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { recoveryCode: '' } })

  const submit = form.handleSubmit(async ({ recoveryCode }) => {
    if (!path) return
    const result = await desktop().restoreBackup({ path, recoveryCode })
    if (result.ok) return // The main process reloads the window once the data is in place.

    if (result.code === 'RECOVERY_CODE_INVALID') {
      form.setError('recoveryCode', { type: 'server', message: result.code }, { shouldFocus: true })
    } else {
      toast.error(errorText(result.code))
    }
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-md border border-rule bg-sunken p-3">
        <Button
          variant="secondary"
          onClick={() => {
            void desktop().chooseBackupFile().then((chosen) => {
              if (chosen) setPath(chosen)
            })
          }}
        >
          <FileArchive aria-hidden className="size-4" />
          {t('backups.chooseFile')}
        </Button>
        <bdi dir="ltr" className="min-w-0 truncate text-sm text-ink-soft">
          {path ?? t('backups.noFile')}
        </bdi>
      </div>
      <TextField form={form} name="recoveryCode" dir="ltr" label={t('backups.recoveryCode')} autoComplete="off" />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <SubmitButton form={form} disabled={!path}>
          {t('backups.restoreSubmit')}
        </SubmitButton>
      </div>
    </form>
  )
}

export function RestoreScreen({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation()
  return (
    <PlateLayout sign={t('backups.fullTitle')} secondary={t('app.otherName')}>
      <FormHeading title={t('backups.fullTitle')} body={t('backups.fullBody')} />
      <RestoreForm {...(onCancel ? { onCancel } : {})} />
    </PlateLayout>
  )
}

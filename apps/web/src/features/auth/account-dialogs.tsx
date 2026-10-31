import { actorSchema, setPinSchema } from '@inv/contracts'
import { Button, Dialog } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SubmitButton, TextField } from '../../components/form'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useSession } from '../../lib/session'
import { ChangePasswordForm } from './login'

function PinForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const { setActor } = useSession()
  const form = useForm({
    resolver: zodResolver(setPinSchema),
    defaultValues: { currentPassword: '', pin: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(actorSchema, 'POST', '/auth/pin', { body })
      .then((actor) => {
        setActor(actor)
        toast.success(t('pin.saved'))
        onDone()
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField
        form={form}
        name="currentPassword"
        type="password"
        dir="ltr"
        label={t('login.currentPassword')}
        autoComplete="current-password"
        autoFocus
      />
      <TextField
        form={form}
        name="pin"
        type="password"
        inputMode="numeric"
        dir="ltr"
        maxLength={6}
        label={t('users.pin')}
        hint={t('users.pinHint')}
        autoComplete="off"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <SubmitButton form={form}>{t('pin.submit')}</SubmitButton>
      </div>
    </form>
  )
}

export type AccountPanel = 'password' | 'pin' | null

export function AccountDialogs({
  panel,
  onClose,
}: {
  panel: AccountPanel
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={panel === 'pin' ? t('pin.title') : t('account.changePassword')}
      {...(panel === 'pin' ? { description: t('pin.body') } : {})}
      closeLabel={t('common.close')}
    >
      {panel === 'pin' && <PinForm onDone={onClose} />}
      {panel === 'password' && <ChangePasswordForm onDone={onClose} />}
    </Dialog>
  )
}

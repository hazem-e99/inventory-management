import {
  actorSchema,
  changePasswordSchema,
  loginSchema,
  okSchema,
  pinLoginSchema,
  recoverAccountSchema,
  sessionSchema,
  type Bootstrap,
} from '@inv/contracts'
import { Button, cn } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SubmitButton, TextField } from '../../components/form'
import { FormHeading, PlateLayout } from '../../components/plate'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useSession } from '../../lib/session'

function PasswordForm() {
  const { t } = useTranslation()
  const { signIn } = useSession()
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(sessionSchema, 'POST', '/auth/login', { body }).then(signIn).catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField form={form} name="username" dir="ltr" label={t('login.username')} autoComplete="username" autoFocus />
      <TextField
        form={form}
        name="password"
        type="password"
        dir="ltr"
        label={t('login.password')}
        autoComplete="current-password"
      />
      <SubmitButton form={form} size="lg" className="mt-2 w-full">
        {t('login.submit')}
      </SubmitButton>
    </form>
  )
}

function PinForm() {
  const { t } = useTranslation()
  const { signIn } = useSession()
  const form = useForm({
    resolver: zodResolver(pinLoginSchema),
    defaultValues: { username: '', pin: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(sessionSchema, 'POST', '/auth/pin-login', { body }).then(signIn).catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField form={form} name="username" dir="ltr" label={t('login.username')} autoComplete="username" />
      <TextField
        form={form}
        name="pin"
        type="password"
        inputMode="numeric"
        dir="ltr"
        maxLength={6}
        label={t('login.pin')}
        autoComplete="off"
      />
      <SubmitButton form={form} size="lg" className="mt-2 w-full">
        {t('login.submit')}
      </SubmitButton>
    </form>
  )
}

const recoverFormSchema = recoverAccountSchema
  .extend({ passwordConfirm: z.string({ error: 'REQUIRED' }).min(1, 'REQUIRED') })
  .refine((values) => values.newPassword === values.passwordConfirm, {
    path: ['passwordConfirm'],
    error: 'PASSWORDS_DO_NOT_MATCH',
  })

function RecoverForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const form = useForm({
    resolver: zodResolver(recoverFormSchema),
    defaultValues: { username: '', recoveryCode: '', newPassword: '', passwordConfirm: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async ({ username, recoveryCode, newPassword }) => {
    await api(okSchema, 'POST', '/auth/recover', { body: { username, recoveryCode, newPassword } })
      .then(() => {
        toast.success(t('login.recovered'))
        onDone()
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <FormHeading title={t('login.recoverTitle')} body={t('login.recoverBody')} />
      <div className="flex flex-col gap-4">
        <TextField form={form} name="username" dir="ltr" label={t('login.username')} autoFocus />
        <TextField form={form} name="recoveryCode" dir="ltr" label={t('login.recoveryCode')} autoComplete="off" />
        <TextField
          form={form}
          name="newPassword"
          type="password"
          dir="ltr"
          label={t('login.newPassword')}
          hint={t('onboarding.fields.passwordHint')}
          autoComplete="new-password"
        />
        <TextField
          form={form}
          name="passwordConfirm"
          type="password"
          dir="ltr"
          label={t('onboarding.fields.passwordConfirm')}
          autoComplete="new-password"
        />
      </div>
      <div className="mt-6 flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={onDone}>
          {t('login.backToLogin')}
        </Button>
        <SubmitButton form={form} size="lg">
          {t('login.recoverSubmit')}
        </SubmitButton>
      </div>
    </form>
  )
}

const tabStyles =
  'flex-1 border-b-2 border-transparent px-3 py-2.5 font-medium text-ink-soft transition-colors duration-150 hover:text-ink data-[state=active]:border-route data-[state=active]:text-route'

export function Login({ bootstrap }: { bootstrap: Bootstrap }) {
  const { t } = useTranslation()
  const [recovering, setRecovering] = useState(false)

  return (
    <PlateLayout
      sign={bootstrap.store?.name}
      secondary={bootstrap.store && t(`business.${bootstrap.store.businessType}.name`)}
      footer={t('common.version', { version: bootstrap.version })}
    >
      {recovering ? (
        <RecoverForm onDone={() => setRecovering(false)} />
      ) : (
        <>
          <FormHeading title={t('login.title')} />
          <Tabs.Root defaultValue="password">
            <Tabs.List className={cn('mb-5 flex border-b border-rule')}>
              <Tabs.Trigger value="password" className={tabStyles}>
                {t('login.password')}
              </Tabs.Trigger>
              <Tabs.Trigger value="pin" className={tabStyles}>
                {t('login.pin')}
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="password">
              <PasswordForm />
            </Tabs.Content>
            <Tabs.Content value="pin">
              <PinForm />
            </Tabs.Content>
          </Tabs.Root>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => setRecovering(true)}>
            {t('login.forgot')}
          </Button>
        </>
      )}
    </PlateLayout>
  )
}

const forcedChangeSchema = changePasswordSchema
  .extend({ passwordConfirm: z.string({ error: 'REQUIRED' }).min(1, 'REQUIRED') })
  .refine((values) => values.newPassword === values.passwordConfirm, {
    path: ['passwordConfirm'],
    error: 'PASSWORDS_DO_NOT_MATCH',
  })

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation()
  const { setActor } = useSession()
  const form = useForm({
    resolver: zodResolver(forcedChangeSchema),
    defaultValues: { currentPassword: '', newPassword: '', passwordConfirm: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    await api(actorSchema, 'POST', '/auth/change-password', { body: { currentPassword, newPassword } })
      .then((actor) => {
        setActor(actor)
        toast.success(t('login.passwordChanged'))
        onDone?.()
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
        name="newPassword"
        type="password"
        dir="ltr"
        label={t('login.newPassword')}
        hint={t('onboarding.fields.passwordHint')}
        autoComplete="new-password"
      />
      <TextField
        form={form}
        name="passwordConfirm"
        type="password"
        dir="ltr"
        label={t('onboarding.fields.passwordConfirm')}
        autoComplete="new-password"
      />
      <SubmitButton form={form} size="lg" className="mt-2 w-full">
        {t('login.changeSubmit')}
      </SubmitButton>
    </form>
  )
}

export function ForcedPasswordChange({ bootstrap }: { bootstrap: Bootstrap }) {
  const { t } = useTranslation()
  return (
    <PlateLayout sign={bootstrap.store?.name}>
      <FormHeading title={t('login.mustChangeTitle')} body={t('login.mustChangeBody')} />
      <ChangePasswordForm />
    </PlateLayout>
  )
}

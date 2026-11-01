import { activateLicenseSchema, licenseInfoSchema, offlineLicenseSchema, type LicenseInfo } from '@inv/contracts'
import { Button } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SubmitButton, TextField } from '../../components/form'
import { FormHeading, PlateLayout } from '../../components/plate'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useCan, useSession } from '../../lib/session'
import { licenseQuery } from './queries'

function useActivated() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return async () => {
    toast.success(t('license.activated'))
    await queryClient.invalidateQueries({ queryKey: licenseQuery.queryKey })
  }
}

export function SerialForm() {
  const { t } = useTranslation()
  const activated = useActivated()
  const form = useForm<z.input<typeof activateLicenseSchema>>({
    resolver: zodResolver(activateLicenseSchema),
    defaultValues: { serial: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(licenseInfoSchema, 'POST', '/license/activate', { body }).then(activated).catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField form={form} name="serial" dir="ltr" autoComplete="off" autoFocus label={t('license.serial')} />
      <SubmitButton form={form} size="lg" className="w-full">
        {t('license.activate')}
      </SubmitButton>
    </form>
  )
}

export function OfflineForm({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const activated = useActivated()
  const form = useForm<z.input<typeof offlineLicenseSchema>>({
    resolver: zodResolver(offlineLicenseSchema),
    defaultValues: { code: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(licenseInfoSchema, 'POST', '/license/offline', { body }).then(activated).catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p className="text-ink-soft">{t('license.offlineBody')}</p>
      <div>
        <p className="text-sm font-medium text-ink">{t('license.deviceId')}</p>
        <p data-testid="device-id" dir="ltr" className="tabular rounded-md bg-sunken px-3 py-2 text-sm break-all text-ink">
          {deviceId}
        </p>
      </div>
      <TextField form={form} name="code" dir="ltr" autoComplete="off" label={t('license.code')} />
      <SubmitButton form={form} variant="secondary" className="w-full">
        {t('license.useCode')}
      </SubmitButton>
    </form>
  )
}

/** Nothing has been sold yet at this point, so there is nothing to show but the way in. */
export function ActivationScreen({ license }: { license: LicenseInfo }) {
  const { t } = useTranslation()
  const { signOut } = useSession()
  const canManage = useCan('settings.manage')
  const [offline, setOffline] = useState(false)

  return (
    <PlateLayout sign={t('nav.license.label')} secondary={t('nav.license.other')}>
      <div className="flex flex-col gap-6">
        <FormHeading title={t('license.title')} body={license.reason === 'other_device' ? t('license.otherDevice') : t('license.body')} />
        {!canManage ? (
          <p className="text-ink-soft">{t('license.askOwner')}</p>
        ) : offline ? (
          <OfflineForm deviceId={license.deviceId} />
        ) : (
          <>
            <SerialForm />
            <Button variant="ghost" onClick={() => setOffline(true)}>
              {t('license.noInternet')}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={() => void signOut()}>
          {t('license.signOut')}
        </Button>
      </div>
    </PlateLayout>
  )
}

export function LicenseBanner() {
  const { t } = useTranslation()
  const canManage = useCan('settings.manage')
  const { data } = useQuery(licenseQuery)

  if (!data || (data.status !== 'grace' && data.status !== 'read_only')) return null

  const message =
    data.status === 'grace'
      ? t('license.bannerGrace', { days: data.daysLeft })
      : t(data.reason === 'suspended' ? 'license.bannerSuspended' : 'license.bannerExpired')

  return (
    <div role="status" className="flex shrink-0 items-center justify-between gap-4 border-b border-rule bg-warn-soft px-6 py-2.5 text-ink">
      <span>{message}</span>
      {canManage && (
        <Link to="/license" className="shrink-0 font-medium underline">
          {t('license.renewLink')}
        </Link>
      )}
    </div>
  )
}

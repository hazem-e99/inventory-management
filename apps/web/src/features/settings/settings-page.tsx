import {
  DIGIT_STYLES,
  LOCALES,
  storeSchema,
  THEMES,
  updateStoreSchema,
  type Settings,
  type UpdateStoreInput,
} from '@inv/contracts'
import { cn, FormSkeleton, Sign } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RadioGroup } from 'radix-ui'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SubmitButton, TextField, UnsavedGuard } from '../../components/form'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { usePreferences } from '../../lib/preferences'
import { useCan } from '../../lib/session'
import { settingsQuery } from './queries'

function Segmented<T extends string>({
  label,
  options,
  value,
  render,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  render: (option: T) => ReactNode
  onChange: (option: T) => void
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-rule py-3 last:border-b-0">
      <span className="font-medium text-ink">{label}</span>
      <RadioGroup.Root
        aria-label={label}
        orientation="horizontal"
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="flex rounded-md border border-rule-strong p-0.5"
      >
        {options.map((option) => (
          <RadioGroup.Item
            key={option}
            value={option}
            className={cn(
              'rounded-sm px-3 py-1 transition-colors duration-150',
              value === option ? 'bg-route text-route-ink' : 'text-ink-soft hover:bg-sunken',
            )}
          >
            {render(option)}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  )
}

function PreferencesSection() {
  const { t } = useTranslation()
  const { preferences, update } = usePreferences()

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-ink">{t('settings.preferencesTitle')}</h2>
      <div className="rounded-lg border border-rule bg-surface px-4">
        <Segmented
          label={t('language.label')}
          options={LOCALES}
          value={preferences.locale}
          render={(locale) => t(`language.${locale}`)}
          onChange={(locale) => update({ locale })}
        />
        <Segmented
          label={t('theme.label')}
          options={THEMES}
          value={preferences.theme}
          render={(theme) => t(`theme.${theme}`)}
          onChange={(theme) => update({ theme })}
        />
        <Segmented
          label={t('digits.label')}
          options={DIGIT_STYLES}
          value={preferences.digits}
          render={(digits) => t(`digits.${digits}`)}
          onChange={(digits) => update({ digits })}
        />
      </div>
    </section>
  )
}

function StoreSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const canEdit = useCan('settings.manage')
  const { store } = settings

  const values: UpdateStoreInput = {
    name: store.name,
    phone: store.phone ?? '',
    address: store.address ?? '',
    taxNumber: store.taxNumber ?? '',
  }
  const form = useForm({ resolver: zodResolver(updateStoreSchema), defaultValues: values })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(storeSchema, 'PUT', '/settings/store', { body })
      .then(async (saved) => {
        toast.success(t('common.saved'))
        form.reset({
          name: saved.name,
          phone: saved.phone ?? '',
          address: saved.address ?? '',
          taxNumber: saved.taxNumber ?? '',
        })
        await queryClient.invalidateQueries({ queryKey: ['settings'] })
        await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      })
      .catch(report)
  })

  return (
    <section className="flex flex-col gap-3">
      <UnsavedGuard when={form.formState.isDirty} />
      <h2 className="text-lg font-semibold text-ink">{t('settings.storeTitle')}</h2>
      <form noValidate onSubmit={(event) => void submit(event)} className="flex max-w-xl flex-col gap-4">
        <TextField form={form} name="name" label={t('onboarding.fields.storeName')} disabled={!canEdit} />
        <div className="grid grid-cols-2 gap-4">
          <TextField form={form} name="phone" dir="ltr" label={t('onboarding.fields.phone')} disabled={!canEdit} />
          <TextField
            form={form}
            name="taxNumber"
            dir="ltr"
            label={t('onboarding.fields.taxNumber')}
            hint={t('onboarding.fields.taxHint')}
            disabled={!canEdit}
          />
        </div>
        <TextField form={form} name="address" label={t('onboarding.fields.address')} disabled={!canEdit} />
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm font-medium text-ink">{t('settings.businessType')}</dt>
            <dd className="text-ink-soft">{t(`business.${store.businessType}.name`)}</dd>
            <dd className="text-sm text-ink-faint">{t('settings.businessLocked')}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ink">{t('settings.currency')}</dt>
            <dd className="text-ink-soft">{store.currency}</dd>
          </div>
        </dl>
        {canEdit && (
          <div>
            <SubmitButton form={form} disabled={!form.formState.isDirty}>
              {t('common.save')}
            </SubmitButton>
          </div>
        )}
      </form>
    </section>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const query = useQuery(settingsQuery)

  return (
    <div className="flex flex-col gap-8">
      <Sign title={t('nav.settings.label')} secondary={t('nav.settings.other')} />
      <PreferencesSection />
      <QueryBoundary query={query} skeleton={<FormSkeleton />}>
        {(settings) => <StoreSection key={settings.store.name} settings={settings} />}
      </QueryBoundary>
    </div>
  )
}

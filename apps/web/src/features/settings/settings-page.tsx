import {
  DIGIT_STYLES,
  LOCALES,
  RECEIPT_PAPERS,
  posSettingsSchema,
  stockPolicySchema,
  storeSchema,
  THEMES,
  updateStoreSchema,
  type PosSettings,
  type ReceiptPaper,
  type Settings,
  type UpdateStoreInput,
} from '@inv/contracts'
import { cn, Field, FormSkeleton, Select, Sign } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RadioGroup } from 'radix-ui'
import { useId, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SubmitButton, TextField, UnsavedGuard } from '../../components/form'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { desktop } from '../../lib/desktop'
import { useReportError } from '../../lib/errors'
import { usePreferences } from '../../lib/preferences'
import { useCan } from '../../lib/session'
import { referenceQuery, useReferenceName } from '../catalog/queries'
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

function StockPolicySection({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const report = useReportError()

  const update = useMutation({
    mutationFn: (allowNegative: boolean) =>
      api(stockPolicySchema, 'PUT', '/settings/stock-policy', { body: { allowNegative } }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      return queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: report,
  })

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-ink">{t('settings.stockTitle')}</h2>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-route"
          checked={settings.stockPolicy.allowNegative}
          disabled={update.isPending}
          onChange={(event) => update.mutate(event.target.checked)}
        />
        <span className="flex flex-col">
          <span className="font-medium text-ink">{t('settings.allowNegative')}</span>
          <span className="text-sm text-ink-faint">{t('settings.allowNegativeHint')}</span>
        </span>
      </label>
    </section>
  )
}

function PosSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const report = useReportError()
  const warehouseName = useReferenceName('warehouses')
  const warehouseId = useId()
  const paperId = useId()
  const printerId = useId()
  const warehouses = useQuery(referenceQuery('warehouses'))
  const printers = useQuery({ queryKey: ['printers'], queryFn: () => desktop().listPrinters() })
  const current = settings.pos

  const update = useMutation({
    mutationFn: (changes: Partial<PosSettings>) =>
      api(posSettingsSchema, 'PUT', '/settings/pos', { body: { ...current, ...changes } }),
    onSuccess: () => {
      toast.success(t('settings.posSaved'))
      return queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: report,
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">{t('settings.posTitle')}</h2>
      <div className="grid max-w-3xl grid-cols-3 gap-4">
        <Field id={warehouseId} label={t('settings.posWarehouse')}>
          <Select id={warehouseId} value={current.warehouseId} onChange={(event) => update.mutate({ warehouseId: event.target.value })}>
            {warehouses.data?.items
              .filter((row) => !row.archived)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {warehouseName(row)}
                </option>
              ))}
          </Select>
        </Field>
        <Field id={paperId} label={t('settings.posPaper')}>
          <Select
            id={paperId}
            value={current.receiptPaper}
            onChange={(event) => update.mutate({ receiptPaper: event.target.value as ReceiptPaper })}
          >
            {RECEIPT_PAPERS.map((paper) => (
              <option key={paper} value={paper}>
                {t(`settings.posPapers.${paper}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={printerId} label={t('settings.posPrinter')}>
          <Select
            id={printerId}
            value={current.printerName ?? ''}
            onChange={(event) => update.mutate({ printerName: event.target.value || null })}
          >
            <option value="">{t('settings.posPrinterAsk')}</option>
            {printers.data?.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="size-4 accent-route"
          checked={current.autoPrint}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ autoPrint: event.target.checked })}
        />
        <span className="font-medium text-ink">{t('settings.posAutoPrint')}</span>
      </label>
    </section>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const query = useQuery(settingsQuery)
  const canManage = useCan('settings.manage')

  return (
    <div className="flex flex-col gap-8">
      <Sign title={t('nav.settings.label')} secondary={t('nav.settings.other')} />
      <PreferencesSection />
      <QueryBoundary query={query} skeleton={<FormSkeleton />}>
        {(settings) => (
          <>
            <StoreSection key={settings.store.name} settings={settings} />
            {canManage && <StockPolicySection settings={settings} />}
            {canManage && <PosSection settings={settings} />}
          </>
        )}
      </QueryBoundary>
    </div>
  )
}

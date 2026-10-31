import {
  BUSINESS_TYPES,
  fullNameSchema,
  LOCALES,
  onboardingResultSchema,
  onboardingSchema,
  passwordSchema,
  storeProfileSchema,
  usernameSchema,
  type BusinessType,
  type Locale,
  type OnboardingResult,
} from '@inv/contracts'
import { Button, cn, Stops } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { RadioGroup } from 'radix-ui'
import { ArrowLeft, ArrowRight, Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SubmitButton, TextField } from '../../components/form'
import { FormHeading, PlateLayout } from '../../components/plate'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { usePreferences } from '../../lib/preferences'
import { useSession } from '../../lib/session'

type Step = 'language' | 'business' | 'store' | 'owner' | 'recovery'

const STEPS: Step[] = ['language', 'business', 'store', 'owner', 'recovery']

const storeStepSchema = storeProfileSchema.omit({ businessType: true })
type StoreValues = z.input<typeof storeStepSchema>

const ownerStepSchema = z
  .object({
    fullName: fullNameSchema,
    username: usernameSchema,
    password: passwordSchema,
    passwordConfirm: z.string({ error: 'REQUIRED' }).min(1, 'REQUIRED'),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    path: ['passwordConfirm'],
    error: 'PASSWORDS_DO_NOT_MATCH',
  })

type OwnerValues = z.input<typeof ownerStepSchema>

function useBackArrow() {
  const { preferences } = usePreferences()
  return preferences.locale === 'ar' ? ArrowRight : ArrowLeft
}

function NextArrow() {
  const { preferences } = usePreferences()
  const Icon = preferences.locale === 'ar' ? ArrowLeft : ArrowRight
  return <Icon aria-hidden className="size-4" />
}

function LanguageStep({ onNext, onRestore }: { onNext: () => void; onRestore: () => void }) {
  const { t } = useTranslation()
  const { preferences, update } = usePreferences()

  return (
    <>
      <FormHeading title={t('onboarding.languageTitle')} body={t('onboarding.languageBody')} />
      <RadioGroup.Root
        aria-label={t('language.label')}
        value={preferences.locale}
        onValueChange={(locale) => update({ locale: locale as Locale })}
        className="grid grid-cols-2 gap-3"
      >
        {LOCALES.map((locale) => {
          const selected = preferences.locale === locale
          return (
            <RadioGroup.Item
              key={locale}
              value={locale}
              lang={locale}
              className={cn(
                'flex h-24 items-center justify-center rounded-lg border-2 text-xl font-medium transition-colors duration-150',
                selected
                  ? 'border-route bg-route-soft text-route'
                  : 'border-rule bg-surface text-ink hover:border-rule-strong',
              )}
            >
              {t(`language.${locale}`)}
            </RadioGroup.Item>
          )
        })}
      </RadioGroup.Root>
      <div className="mt-8 flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={onRestore}>
          {t('onboarding.restoreInstead')}
        </Button>
        <Button size="lg" onClick={onNext}>
          {t('common.next')}
          <NextArrow />
        </Button>
      </div>
    </>
  )
}

function BusinessStep({
  value,
  onChange,
  onBack,
  onNext,
}: {
  value: BusinessType | null
  onChange: (value: BusinessType) => void
  onBack: () => void
  onNext: () => void
}) {
  const { t } = useTranslation()
  const BackArrow = useBackArrow()

  return (
    <>
      <FormHeading title={t('onboarding.businessTitle')} body={t('onboarding.businessBody')} />
      <RadioGroup.Root
        aria-label={t('onboarding.steps.business')}
        value={value ?? ''}
        onValueChange={(next) => onChange(next as BusinessType)}
        className="flex flex-col gap-2"
      >
        {BUSINESS_TYPES.map((type) => {
          const selected = value === type
          return (
            <RadioGroup.Item
              key={type}
              value={type}
              className={cn(
                'flex items-center justify-between gap-4 rounded-lg border-2 px-4 py-3 text-start transition-colors duration-150',
                selected ? 'border-route bg-route-soft' : 'border-rule bg-surface hover:border-rule-strong',
              )}
            >
              <span className="flex flex-col">
                <span className={cn('font-medium', selected ? 'text-route' : 'text-ink')}>
                  {t(`business.${type}.name`)}
                </span>
                <span className="text-sm text-ink-soft">{t(`business.${type}.description`)}</span>
              </span>
              {selected && <Check aria-hidden className="size-5 shrink-0 text-route" />}
            </RadioGroup.Item>
          )
        })}
      </RadioGroup.Root>
      <div className="mt-8 flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={onBack}>
          <BackArrow aria-hidden className="size-4" />
          {t('common.back')}
        </Button>
        <Button size="lg" disabled={!value} onClick={onNext}>
          {t('common.next')}
          <NextArrow />
        </Button>
      </div>
    </>
  )
}

function StoreStep({
  initial,
  onBack,
  onNext,
}: {
  initial: StoreValues | null
  onBack: () => void
  onNext: (values: StoreValues) => void
}) {
  const { t } = useTranslation()
  const BackArrow = useBackArrow()
  const form = useForm<StoreValues, unknown, z.output<typeof storeStepSchema>>({
    resolver: zodResolver(storeStepSchema),
    mode: 'onTouched',
    defaultValues: initial ?? { name: '', phone: '', address: '', taxNumber: '' },
  })

  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit((values) => onNext(values as StoreValues))(event)}>
      <FormHeading title={t('onboarding.storeTitle')} body={t('onboarding.storeBody')} />
      <div className="flex flex-col gap-4">
        <TextField form={form} name="name" label={t('onboarding.fields.storeName')} autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            form={form}
            name="phone"
            dir="ltr"
            inputMode="tel"
            label={`${t('onboarding.fields.phone')} (${t('common.optional')})`}
          />
          <TextField
            form={form}
            name="taxNumber"
            dir="ltr"
            inputMode="numeric"
            label={`${t('onboarding.fields.taxNumber')} (${t('common.optional')})`}
            hint={t('onboarding.fields.taxHint')}
          />
        </div>
        <TextField
          form={form}
          name="address"
          label={`${t('onboarding.fields.address')} (${t('common.optional')})`}
        />
      </div>
      <div className="mt-8 flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={onBack}>
          <BackArrow aria-hidden className="size-4" />
          {t('common.back')}
        </Button>
        <SubmitButton form={form} size="lg">
          {t('common.next')}
          <NextArrow />
        </SubmitButton>
      </div>
    </form>
  )
}

function OwnerStep({
  businessType,
  store,
  onBack,
  onDone,
}: {
  businessType: BusinessType
  store: StoreValues
  onBack: () => void
  onDone: (result: OnboardingResult) => void
}) {
  const { t } = useTranslation()
  const BackArrow = useBackArrow()
  const { preferences } = usePreferences()
  const form = useForm<OwnerValues, unknown, z.output<typeof ownerStepSchema>>({
    resolver: zodResolver(ownerStepSchema),
    mode: 'onTouched',
    defaultValues: { fullName: '', username: '', password: '', passwordConfirm: '' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async ({ fullName, username, password }) => {
    const body = onboardingSchema.parse({
      locale: preferences.locale,
      store: { ...store, businessType },
      owner: { fullName, username, password },
    })
    await api(onboardingResultSchema, 'POST', '/onboarding', { body }).then(onDone).catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <FormHeading title={t('onboarding.ownerTitle')} body={t('onboarding.ownerBody')} />
      <div className="flex flex-col gap-4">
        <TextField form={form} name="fullName" label={t('onboarding.fields.fullName')} autoComplete="name" autoFocus />
        <TextField
          form={form}
          name="username"
          dir="ltr"
          label={t('onboarding.fields.username')}
          hint={t('onboarding.fields.usernameHint')}
          autoComplete="username"
        />
        <TextField
          form={form}
          name="password"
          type="password"
          dir="ltr"
          label={t('onboarding.fields.password')}
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
      <div className="mt-8 flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={onBack}>
          <BackArrow aria-hidden className="size-4" />
          {t('common.back')}
        </Button>
        <SubmitButton form={form} size="lg">
          {t('onboarding.finish')}
        </SubmitButton>
      </div>
    </form>
  )
}

function RecoveryStep({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useTranslation()
  const [confirmed, setConfirmed] = useState(false)

  return (
    <>
      <FormHeading title={t('onboarding.recoveryTitle')} body={t('onboarding.recoveryBody')} />
      <div className="flex flex-col gap-3 rounded-lg border-2 border-route bg-route-soft p-5">
        <bdi
          dir="ltr"
          data-testid="recovery-code"
          className="tabular block text-center text-xl font-semibold tracking-wide text-ink select-all"
        >
          {code}
        </bdi>
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => toast.success(t('common.copied')))
          }}
        >
          <Copy aria-hidden className="size-4" />
          {t('common.copy')}
        </Button>
      </div>
      <p className="mt-3 text-ink-soft">{t('onboarding.recoveryAdvice')}</p>
      <label className="mt-5 flex cursor-pointer items-center gap-3 font-medium text-ink">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="size-5 accent-route"
        />
        {t('onboarding.recoveryConfirm')}
      </label>
      <div className="mt-8 flex justify-end">
        <Button size="lg" disabled={!confirmed} onClick={onDone}>
          {t('onboarding.start')}
        </Button>
      </div>
    </>
  )
}

export function Onboarding({ onRestore }: { onRestore: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { signIn } = useSession()
  const [step, setStep] = useState<Step>('language')
  const [businessType, setBusinessType] = useState<BusinessType | null>(null)
  const [store, setStore] = useState<StoreValues | null>(null)
  const [result, setResult] = useState<OnboardingResult | null>(null)

  return (
    <PlateLayout
      sign={t('onboarding.welcome')}
      secondary={t('product.otherName')}
      plate={
        <Stops
          aria-label={t('onboarding.stops')}
          current={STEPS.indexOf(step)}
          steps={STEPS.map((id) => t(`onboarding.steps.${id}`))}
        />
      }
    >
      {step === 'language' && <LanguageStep onNext={() => setStep('business')} onRestore={onRestore} />}
      {step === 'business' && (
        <BusinessStep
          value={businessType}
          onChange={setBusinessType}
          onBack={() => setStep('language')}
          onNext={() => setStep('store')}
        />
      )}
      {step === 'store' && (
        <StoreStep
          initial={store}
          onBack={() => setStep('business')}
          onNext={(values) => {
            setStore(values)
            setStep('owner')
          }}
        />
      )}
      {step === 'owner' && businessType && store && (
        <OwnerStep
          businessType={businessType}
          store={store}
          onBack={() => setStep('store')}
          onDone={(next) => {
            setResult(next)
            setStep('recovery')
          }}
        />
      )}
      {step === 'recovery' && result && (
        <RecoveryStep
          code={result.recoveryCode}
          onDone={() => {
            signIn(result)
            void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
          }}
        />
      )}
    </PlateLayout>
  )
}

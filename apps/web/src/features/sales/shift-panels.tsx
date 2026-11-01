import { closeShiftSchema, cashMovementInputSchema, openShiftSchema, shiftSummarySchema, type ShiftSummary } from '@inv/contracts'
import { parseMoney } from '@inv/domain'
import { Button, Dialog } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SelectField, TextField } from '../../components/form'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'

const money = z.string().refine((value) => parseMoney(value) !== null, 'PRICE_INVALID')

const refreshShifts = (queryClient: ReturnType<typeof useQueryClient>) => queryClient.invalidateQueries({ queryKey: ['shifts'] })

export function OpenShiftForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<{ opening: string }>({
    resolver: zodResolver(z.object({ opening: money })),
    defaultValues: { opening: '' },
  })
  const report = useReportError(form, (path) => (path === 'openingCashMinor' ? 'opening' : path))

  const open = useMutation({
    mutationFn: ({ opening }: { opening: string }) =>
      api(shiftSummarySchema, 'POST', '/shifts', { body: openShiftSchema.parse({ openingCashMinor: parseMoney(opening) }) }),
    onSuccess: async (shift) => {
      toast.success(t('shifts.opened', { number: shift.number }))
      await refreshShifts(queryClient)
    },
    onError: report,
  })

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit((values) => open.mutate(values))(event)
      }}
      className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-rule bg-surface p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('shifts.openTitle')}</h2>
        <p className="text-ink-soft">{t('shifts.openBody')}</p>
      </div>
      <TextField form={form} name="opening" label={t('shifts.openingCash')} dir="ltr" inputMode="decimal" autoFocus />
      <Button type="submit" size="lg" loading={open.isPending}>
        {t('shifts.open')}
      </Button>
    </form>
  )
}

const cashSchema = z.object({
  kind: z.enum(['in', 'out']),
  amount: z.string().refine((value) => (parseMoney(value) ?? 0) > 0, 'PRICE_INVALID'),
  reason: z.string().trim().min(2, 'NAME_TOO_SHORT').max(160, 'TEXT_TOO_LONG'),
})

type CashValues = z.infer<typeof cashSchema>

export function CashDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<CashValues>({ resolver: zodResolver(cashSchema), defaultValues: { kind: 'out', amount: '', reason: '' } })
  const report = useReportError(form, (path) => (path === 'amountMinor' ? 'amount' : path))

  const move = useMutation({
    mutationFn: ({ amount, ...values }: CashValues) =>
      api(shiftSummarySchema, 'POST', '/shifts/current/cash', {
        body: cashMovementInputSchema.parse({ ...values, amountMinor: parseMoney(amount) }),
      }),
    onSuccess: async () => {
      toast.success(t('shifts.cashSaved'))
      await refreshShifts(queryClient)
      onClose()
    },
    onError: report,
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('shifts.cashTitle')}
      description={t('shifts.cashBody')}
      closeLabel={t('common.close')}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit((values) => move.mutate(values))(event)
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <SelectField form={form} name="kind" label={t('shifts.cashKind')}>
            <option value="out">{t('shifts.kinds.out')}</option>
            <option value="in">{t('shifts.kinds.in')}</option>
          </SelectField>
          <TextField form={form} name="amount" label={t('shifts.amount')} dir="ltr" inputMode="decimal" autoFocus />
        </div>
        <TextField form={form} name="reason" label={t('shifts.reason')} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={move.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const closeFormSchema = z.object({ counted: money, notes: z.string().max(240, 'TEXT_TOO_LONG') })

type CloseValues = z.infer<typeof closeFormSchema>

/** The expected figure stays out of sight until the count is in, so the count stays honest. */
export function CloseShiftDialog({
  shift,
  onClose,
  onClosed,
}: {
  shift: ShiftSummary
  onClose: () => void
  onClosed: (shift: ShiftSummary) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<CloseValues>({ resolver: zodResolver(closeFormSchema), defaultValues: { counted: '', notes: '' } })
  const report = useReportError(form, (path) => (path === 'countedCashMinor' ? 'counted' : path))

  const close = useMutation({
    mutationFn: ({ counted, notes }: CloseValues) =>
      api(shiftSummarySchema, 'POST', `/shifts/${shift.id}/close`, {
        body: closeShiftSchema.parse({ countedCashMinor: parseMoney(counted), notes }),
      }),
    onSuccess: async (closed) => {
      toast.success(t('shifts.closed'))
      await refreshShifts(queryClient)
      onClosed(closed)
    },
    onError: report,
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('shifts.closeTitle')}
      description={t('shifts.closeBody')}
      closeLabel={t('common.close')}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit((values) => close.mutate(values))(event)
        }}
        className="flex flex-col gap-4"
      >
        <TextField form={form} name="counted" label={t('shifts.counted')} dir="ltr" inputMode="decimal" autoFocus />
        <TextField form={form} name="notes" label={`${t('customers.notes')} (${t('common.optional')})`} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={close.isPending}>
            {t('shifts.close')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

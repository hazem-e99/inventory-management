import { customerInputSchema, customerSchema, type Customer } from '@inv/contracts'
import { moneyToText, parseMoney } from '@inv/domain'
import { Button, Dialog } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { TextField } from '../../components/form'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'

/** A negative opening balance is money the shop owes the customer. */
function parseSigned(text: string): number | null {
  const trimmed = text.trim()
  const negative = trimmed.startsWith('-')
  const amount = parseMoney(negative ? trimmed.slice(1) : trimmed)
  return amount === null ? null : negative ? -amount : amount
}

const optionalMoney = (value: string) => value.trim() === '' || parseMoney(value) !== null

const formSchema = z.object({
  name: z.string().trim().min(2, 'NAME_TOO_SHORT').max(160, 'TEXT_TOO_LONG'),
  phone: z.string().trim().regex(/^(\+?[0-9][0-9\s()-]{5,19})?$/, 'PHONE_INVALID'),
  address: z.string(),
  notes: z.string(),
  creditLimit: z.string().refine(optionalMoney, 'PRICE_INVALID'),
  opening: z.string().refine((value) => value.trim() === '' || parseSigned(value) !== null, 'PRICE_INVALID'),
})

type FormValues = z.infer<typeof formSchema>

export function CustomerDialog({
  customer,
  initialName = '',
  onClose,
  onSaved,
}: {
  customer: Customer | null
  initialName?: string
  onClose: () => void
  onSaved?: (customer: Customer) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: customer?.name ?? initialName,
      phone: customer?.phone ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
      creditLimit: customer?.creditLimitMinor === null || !customer ? '' : moneyToText(customer.creditLimitMinor),
      opening: '',
    },
  })
  const report = useReportError(form, (path) =>
    path === 'openingBalanceMinor' ? 'opening' : path === 'creditLimitMinor' ? 'creditLimit' : path,
  )

  const save = useMutation({
    mutationFn: ({ opening, creditLimit, ...fields }: FormValues) => {
      const body = customerInputSchema.parse({
        ...fields,
        creditLimitMinor: creditLimit.trim() ? parseMoney(creditLimit) : null,
        ...(customer ? {} : { openingBalanceMinor: parseSigned(opening) ?? 0 }),
      })
      return customer
        ? api(customerSchema, 'PUT', `/customers/${customer.id}`, { body })
        : api(customerSchema, 'POST', '/customers', { body })
    },
    onSuccess: async (saved) => {
      toast.success(t(customer ? 'customers.updated' : 'customers.created'))
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      onSaved?.(saved)
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
      title={t(customer ? 'customers.editTitle' : 'customers.addTitle')}
      closeLabel={t('common.close')}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit((values) => save.mutate(values))(event)
        }}
        className="flex flex-col gap-4"
      >
        <TextField form={form} name="name" label={t('customers.name')} autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <TextField form={form} name="phone" label={`${t('customers.phone')} (${t('common.optional')})`} dir="ltr" inputMode="tel" />
          <TextField
            form={form}
            name="creditLimit"
            label={`${t('customers.creditLimit')} (${t('common.optional')})`}
            hint={t('customers.creditLimitHint')}
            dir="ltr"
            inputMode="decimal"
          />
        </div>
        <TextField form={form} name="address" label={`${t('customers.address')} (${t('common.optional')})`} />
        <TextField form={form} name="notes" label={`${t('customers.notes')} (${t('common.optional')})`} />
        {!customer && (
          <TextField
            form={form}
            name="opening"
            label={`${t('customers.opening')} (${t('common.optional')})`}
            hint={t('customers.openingHint')}
            dir="ltr"
            inputMode="decimal"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

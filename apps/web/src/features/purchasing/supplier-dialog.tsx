import { supplierInputSchema, supplierSchema, type Supplier } from '@inv/contracts'
import { parseMoney } from '@inv/domain'
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

/** A negative opening balance is money the supplier owes the shop. */
function parseSigned(text: string): number | null {
  const trimmed = text.trim()
  const negative = trimmed.startsWith('-')
  const amount = parseMoney(negative ? trimmed.slice(1) : trimmed)
  return amount === null ? null : negative ? -amount : amount
}

const formSchema = z.object({
  name: z.string().trim().min(2, 'NAME_TOO_SHORT').max(160, 'TEXT_TOO_LONG'),
  phone: z.string().trim().regex(/^(\+?[0-9][0-9\s()-]{5,19})?$/, 'PHONE_INVALID'),
  address: z.string(),
  taxNumber: z.string().trim().regex(/^(\d{9})?$/, 'TAX_NUMBER_INVALID'),
  notes: z.string(),
  opening: z.string().refine((value) => value.trim() === '' || parseSigned(value) !== null, 'PRICE_INVALID'),
})

type FormValues = z.infer<typeof formSchema>

export function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      phone: supplier?.phone ?? '',
      address: supplier?.address ?? '',
      taxNumber: supplier?.taxNumber ?? '',
      notes: supplier?.notes ?? '',
      opening: '',
    },
  })
  const report = useReportError(form, (path) => (path === 'openingBalanceMinor' ? 'opening' : path))

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const { opening, ...fields } = values
      const body = supplierInputSchema.parse(
        supplier ? fields : { ...fields, openingBalanceMinor: parseSigned(opening) ?? 0 },
      )
      return supplier
        ? api(supplierSchema, 'PUT', `/suppliers/${supplier.id}`, { body })
        : api(supplierSchema, 'POST', '/suppliers', { body })
    },
    onSuccess: async () => {
      toast.success(t(supplier ? 'suppliers.updated' : 'suppliers.created'))
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] })
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
      title={t(supplier ? 'suppliers.editTitle' : 'suppliers.addTitle')}
      closeLabel={t('common.close')}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit((values) => save.mutate(values))(event)
        }}
        className="flex flex-col gap-4"
      >
        <TextField form={form} name="name" label={t('suppliers.name')} autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <TextField form={form} name="phone" label={`${t('suppliers.phone')} (${t('common.optional')})`} dir="ltr" inputMode="tel" />
          <TextField form={form} name="taxNumber" label={`${t('suppliers.taxNumber')} (${t('common.optional')})`} dir="ltr" inputMode="numeric" />
        </div>
        <TextField form={form} name="address" label={`${t('suppliers.address')} (${t('common.optional')})`} />
        <TextField form={form} name="notes" label={`${t('suppliers.notes')} (${t('common.optional')})`} />
        {!supplier && (
          <TextField
            form={form}
            name="opening"
            label={`${t('suppliers.opening')} (${t('common.optional')})`}
            hint={t('suppliers.openingHint')}
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

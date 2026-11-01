import {
  okSchema,
  orderInputSchema,
  orderSchema,
  type Order,
  type Reference,
  type StockPickRow,
} from '@inv/contracts'
import { moneyToText, parseMoney, parseQuantity, quantityToText, receiptValue } from '@inv/domain'
import { Button, Dialog, FormSkeleton, Input, Select, Sign, StatusLine } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { PackageCheck, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SelectField, TextField, UnsavedGuard } from '../../components/form'
import { ErrorState } from '../../components/states'
import { api } from '../../lib/api'
import { useErrorText, useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { referenceQuery, useReferenceName } from '../catalog/queries'
import { ItemPicker } from '../stock/item-picker'
import { SupplierPicker } from './supplier-picker'

const lineSchema = z.object({
  variantId: z.string(),
  productName: z.string(),
  variantLabel: z.string(),
  baseUnitId: z.string(),
  unitId: z.string(),
  qty: z.string().refine((value) => (parseQuantity(value) ?? 0) > 0, 'QUANTITY_INVALID'),
  cost: z.string().refine((value) => parseMoney(value) !== null, 'PRICE_INVALID'),
  orderedBaseMilli: z.number(),
  receivedBaseMilli: z.number(),
})

const formSchema = z.object({
  supplierId: z.string().min(1, 'REQUIRED'),
  supplierName: z.string(),
  warehouseId: z.string().min(1, 'REQUIRED'),
  expectedDate: z.string(),
  notes: z.string().max(500, 'TEXT_TOO_LONG'),
  lines: z.array(lineSchema),
})

type FormValues = z.infer<typeof formSchema>
type OrderForm = UseFormReturn<FormValues>

function toValues(order: Order | null): FormValues {
  if (!order) return { supplierId: '', supplierName: '', warehouseId: 'main', expectedDate: '', notes: '', lines: [] }

  return {
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    warehouseId: order.warehouseId,
    expectedDate: order.expectedDate ?? '',
    notes: order.notes ?? '',
    lines: order.lines.map((line) => ({
      variantId: line.variantId,
      productName: line.productName,
      variantLabel: line.variantLabel ?? '',
      baseUnitId: line.baseUnitId,
      unitId: line.unitId,
      qty: quantityToText(line.qtyMilli),
      cost: moneyToText(line.unitCostMinor),
      orderedBaseMilli: line.orderedBaseMilli,
      receivedBaseMilli: line.receivedBaseMilli,
    })),
  }
}

function toBody(values: FormValues) {
  return orderInputSchema.parse({
    supplierId: values.supplierId,
    warehouseId: values.warehouseId,
    expectedDate: values.expectedDate || null,
    notes: values.notes,
    lines: values.lines.map((line) => ({
      variantId: line.variantId,
      unitId: line.unitId,
      qtyMilli: parseQuantity(line.qty) ?? 0,
      unitCostMinor: parseMoney(line.cost) ?? 0,
    })),
  })
}

const mapFieldPath = (path: string): string | null =>
  path.replace(/\.qtyMilli$/, '.qty').replace(/\.unitCostMinor$/, '.cost').replace(/\.variantId$/, '.qty')

function LineError({ form, path }: { form: OrderForm; path: `lines.${number}.${'qty' | 'cost' | 'unitId'}` }) {
  const errorText = useErrorText()
  const error = form.getFieldState(path, form.formState).error
  return error ? <p className="mt-1 text-sm text-danger">{errorText(error.message)}</p> : null
}

function LineRow({
  form,
  index,
  units,
  pick,
  locked,
  onRemove,
}: {
  form: OrderForm
  index: number
  units: Reference[]
  pick: StockPickRow | undefined
  locked: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const unitName = useReferenceName('units')
  const qty = useWatch({ control: form.control, name: `lines.${index}.qty` })
  const cost = useWatch({ control: form.control, name: `lines.${index}.cost` })
  const line = form.getValues(`lines.${index}`)

  const unitIds = [line.baseUnitId, ...(pick?.units.map(({ unitId }) => unitId) ?? [])]
  const lineUnits = unitIds.includes(line.unitId) ? unitIds : [...unitIds, line.unitId]
  const total = receiptValue(parseQuantity(qty) ?? 0, parseMoney(cost) ?? 0)

  return (
    <tr>
      <td className="min-w-44 border-b border-rule px-2 py-2 align-top">
        <p className="font-medium text-ink">{line.productName}</p>
        {line.variantLabel && <p className="text-sm text-ink-faint">{line.variantLabel}</p>}
      </td>
      <td className="w-28 border-b border-rule px-2 py-2 align-top">
        <Input dir="ltr" inputMode="decimal" aria-label={t('orders.quantity')} disabled={locked} {...form.register(`lines.${index}.qty`)} />
        <LineError form={form} path={`lines.${index}.qty`} />
      </td>
      <td className="w-32 border-b border-rule px-2 py-2 align-top">
        <Select aria-label={t('orders.unit')} disabled={locked} {...form.register(`lines.${index}.unitId`)}>
          {lineUnits.map((id) => {
            const unit = units.find((row) => row.id === id)
            return (
              <option key={id} value={id}>
                {unit ? unitName(unit) : id}
              </option>
            )
          })}
        </Select>
        <LineError form={form} path={`lines.${index}.unitId`} />
      </td>
      <td className="w-32 border-b border-rule px-2 py-2 align-top">
        <Input dir="ltr" inputMode="decimal" aria-label={t('orders.cost')} disabled={locked} {...form.register(`lines.${index}.cost`)} />
        <LineError form={form} path={`lines.${index}.cost`} />
      </td>
      {locked && (
        <td className="tabular w-32 border-b border-rule px-2 py-4 align-top text-ink-soft">
          {format.quantity(line.receivedBaseMilli)} / {format.quantity(line.orderedBaseMilli)}
        </td>
      )}
      <td className="tabular w-32 border-b border-rule px-2 py-4 text-end align-top font-medium text-ink">{format.money(total)}</td>
      {!locked && (
        <td className="w-10 border-b border-rule px-2 py-2 align-top">
          <Button variant="ghost" size="icon" aria-label={t('purchases.removeLine')} onClick={onRemove}>
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </td>
      )}
    </tr>
  )
}

type Confirming = 'open' | 'cancel' | 'delete' | null

const CONFIRM_TEXT = {
  open: { title: 'orders.openTitle', body: 'orders.openBody', action: 'orders.open' },
  cancel: { title: 'orders.cancelTitle', body: 'orders.cancelBody', action: 'orders.cancel' },
  delete: { title: 'orders.deleteTitle', body: 'orders.deleteBody', action: 'orders.deleteDraft' },
} as const

function OrderEditor({ order, warehouses, units }: { order: Order | null; warehouses: Reference[]; units: Reference[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const format = useFormat()
  const warehouseName = useReferenceName('warehouses')
  const errorText = useErrorText()
  const canManage = useCan('purchases.manage')
  const [picks, setPicks] = useState<ReadonlyMap<string, StockPickRow>>(new Map())
  const [confirming, setConfirming] = useState<Confirming>(null)
  const done = useRef(false)
  // Survives a failed open: the retry must update the same draft, not create a second one.
  const savedId = useRef(order?.id ?? null)

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: toValues(order) })
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const report = useReportError(form, mapFieldPath)
  const warehouseId = useWatch({ control: form.control, name: 'warehouseId' })
  const supplierId = useWatch({ control: form.control, name: 'supplierId' })
  const supplierName = useWatch({ control: form.control, name: 'supplierName' })
  const watched = useWatch({ control: form.control, name: 'lines' })
  const { isDirty, errors } = form.formState

  const status = order?.status ?? 'draft'
  const locked = status !== 'draft' || !canManage
  const receivable = status === 'open' || status === 'partial'
  const total = watched.reduce((sum, line) => sum + receiptValue(parseQuantity(line.qty) ?? 0, parseMoney(line.cost) ?? 0), 0)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['purchases'] })

  const leave = async () => {
    done.current = true
    await refresh()
    await navigate({ to: '/orders' })
  }

  const saveDraft = async (values: FormValues) => {
    const body = toBody(values)
    const saved = savedId.current
      ? await api(orderSchema, 'PUT', `/purchase-orders/${savedId.current}`, { body })
      : await api(orderSchema, 'POST', '/purchase-orders', { body })
    savedId.current = saved.id
    return saved
  }

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: async (saved) => {
      toast.success(t('orders.saved'))
      form.reset(toValues(saved))
      done.current = true
      await refresh()
      await navigate({ to: '/orders/$id', params: { id: saved.id } })
      done.current = false
    },
    onError: report,
  })

  const stopConfirming = (error: unknown) => {
    setConfirming(null)
    report(error)
  }

  const open = useMutation({
    mutationFn: async (values: FormValues) => {
      const saved = await saveDraft(values)
      return api(orderSchema, 'POST', `/purchase-orders/${saved.id}/open`)
    },
    onSuccess: async () => {
      toast.success(t('orders.opened'))
      await leave()
    },
    onError: stopConfirming,
  })

  const cancel = useMutation({
    mutationFn: () => api(orderSchema, 'POST', `/purchase-orders/${order!.id}/cancel`),
    onSuccess: async () => {
      toast.success(t('orders.cancelled'))
      await leave()
    },
    onError: stopConfirming,
  })

  const remove = useMutation({
    mutationFn: () => api(okSchema, 'DELETE', `/purchase-orders/${order!.id}`),
    onSuccess: async () => {
      toast.success(t('orders.deleted'))
      await leave()
    },
    onError: stopConfirming,
  })

  const addLine = (row: StockPickRow) => {
    setPicks((current) => new Map(current).set(row.variantId, row))
    const factor = row.units.find(({ unitId }) => unitId === row.unitId)?.factorMilli ?? 1000
    lines.append({
      variantId: row.variantId,
      productName: row.productName,
      variantLabel: row.variantLabel ?? '',
      baseUnitId: row.baseUnitId,
      unitId: row.unitId,
      qty: '1',
      cost: moneyToText(Math.round((row.costMinor * factor) / 1000)),
      orderedBaseMilli: 0,
      receivedBaseMilli: 0,
    })
  }

  const confirm = () => {
    if (confirming === 'open') void form.handleSubmit((values) => open.mutate(values), () => setConfirming(null))()
    if (confirming === 'cancel') cancel.mutate()
    if (confirming === 'delete') remove.mutate()
  }

  const stops = (status === 'cancelled' ? ['draft', 'open', 'cancelled'] : ['draft', 'open', 'partial', 'received']) as Array<
    NonNullable<Order['status']>
  >
  const hasLines = lines.fields.length > 0

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit((values) => save.mutate(values))(event)
      }}
      className="flex flex-col gap-5"
    >
      <UnsavedGuard when={() => isDirty && !done.current} />

      <StatusLine
        aria-label={t('orders.stopsLabel')}
        steps={stops.map((stop) => t(`orders.statuses.${stop}`))}
        current={stops.indexOf(status)}
      />

      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <SupplierPicker
          value={supplierId ? { id: supplierId, name: supplierName } : null}
          disabled={locked}
          error={errors.supplierId ? errorText(errors.supplierId.message) : undefined}
          onChange={(supplier) => {
            form.setValue('supplierId', supplier?.id ?? '', { shouldDirty: true, shouldValidate: Boolean(supplier) })
            form.setValue('supplierName', supplier?.name ?? '')
          }}
        />
        <fieldset disabled={locked} className="contents">
          <SelectField form={form} name="warehouseId" label={t('orders.warehouse')}>
            {warehouses
              .filter((row) => !row.archived)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {warehouseName(row)}
                </option>
              ))}
          </SelectField>
          <TextField form={form} name="expectedDate" type="date" dir="ltr" label={`${t('orders.expectedDate')} (${t('common.optional')})`} />
          <TextField form={form} name="notes" label={`${t('orders.notes')} (${t('common.optional')})`} />
        </fieldset>
      </div>

      {!locked && <ItemPicker warehouseId={warehouseId} onPick={addLine} />}

      {hasLines ? (
        <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sunken text-sm text-ink-soft">
                <th className="px-2 py-2.5 text-start font-medium">{t('orders.item')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('orders.quantity')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('orders.unit')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('orders.cost')}</th>
                {locked && <th className="px-2 py-2.5 text-start font-medium">{t('orders.received')}</th>}
                <th className="px-2 py-2.5 text-end font-medium">{t('orders.lineTotal')}</th>
                {!locked && <th aria-label={t('purchases.removeLine')} />}
              </tr>
            </thead>
            <tbody>
              {lines.fields.map((field, index) => (
                <LineRow
                  key={field.id}
                  form={form}
                  index={index}
                  units={units}
                  pick={picks.get(field.variantId)}
                  locked={locked}
                  onRemove={() => lines.remove(index)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-rule-strong bg-surface px-6 py-8 text-ink-soft">{t('purchases.noLines')}</p>
      )}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 bg-ground px-1 py-3">
        <div className="flex items-center gap-4">
          {status === 'draft' && order && canManage && (
            <Button variant="ghost" onClick={() => setConfirming('delete')}>
              <Trash2 aria-hidden className="size-4" />
              {t('orders.deleteDraft')}
            </Button>
          )}
          {receivable && canManage && (
            <Button variant="danger" onClick={() => setConfirming('cancel')}>
              {t('orders.cancel')}
            </Button>
          )}
          <p className="text-ink-soft">
            {t('orders.total')}: <span className="tabular font-semibold text-ink">{format.money(total)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {!locked && (
            <>
              <Button type="submit" variant="secondary" loading={save.isPending}>
                {t('orders.saveDraft')}
              </Button>
              <Button size="lg" disabled={!hasLines} onClick={() => setConfirming('open')}>
                {t('orders.open')}
              </Button>
            </>
          )}
          {receivable && canManage && (
            <Link to="/purchases/receive/$orderId" params={{ orderId: order!.id }}>
              <Button size="lg" tabIndex={-1}>
                <PackageCheck aria-hidden className="size-4" />
                {t('orders.receive')}
              </Button>
            </Link>
          )}
        </div>
      </div>

      <Dialog
        open={confirming !== null}
        onOpenChange={(value) => {
          if (!value) setConfirming(null)
        }}
        title={confirming ? t(CONFIRM_TEXT[confirming].title) : ''}
        description={confirming ? t(CONFIRM_TEXT[confirming].body) : ''}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={confirming === 'open' ? 'primary' : 'danger'}
            loading={open.isPending || cancel.isPending || remove.isPending}
            onClick={confirm}
          >
            {confirming ? t(CONFIRM_TEXT[confirming].action) : ''}
          </Button>
        </div>
      </Dialog>
    </form>
  )
}

export function OrderPage() {
  const { t } = useTranslation()
  const { id } = useParams({ strict: false })

  const order = useQuery({
    queryKey: ['purchases', 'order', id],
    queryFn: () => api(orderSchema, 'GET', `/purchase-orders/${id}`),
    enabled: Boolean(id),
    gcTime: 0,
  })
  const warehouses = useQuery(referenceQuery('warehouses'))
  const units = useQuery(referenceQuery('units'))

  const queries = [warehouses, units, ...(id ? [order] : [])]
  const failed = queries.find((query) => query.isError)
  const ready = queries.every((query) => query.data !== undefined)

  return (
    <div className="flex flex-col gap-5">
      <Sign
        title={order.data?.number ? t('orders.title', { number: order.data.number }) : t('orders.newTitle')}
        secondary={t('nav.orders.label')}
      />
      {failed ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : !ready ? (
        <FormSkeleton fields={3} />
      ) : (
        <OrderEditor
          key={order.data ? `${order.data.id}-${order.data.status}` : 'new'}
          order={order.data ?? null}
          warehouses={warehouses.data!.items}
          units={units.data!.items}
        />
      )}
    </div>
  )
}

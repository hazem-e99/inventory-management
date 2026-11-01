import {
  PAYMENT_METHODS,
  okSchema,
  orderSchema,
  purchaseInputSchema,
  purchaseSchema,
  type Order,
  type Purchase,
  type PurchaseKind,
  type Reference,
  type StockPickRow,
} from '@inv/contracts'
import { moneyToText, parseMoney, parseQuantity, purchaseDocumentTotals, purchaseLineTotals, quantityToText } from '@inv/domain'
import { Button, Dialog, FormSkeleton, Input, Select, Sign, StatusLine } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { Fragment, useRef, useState, type ReactNode } from 'react'
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

const parsePercent = (text: string): number | null => {
  const value = parseMoney(text)
  return value === null || value > 10_000 ? null : value
}

const percentText = (basisPoints: number): string => (basisPoints === 0 ? '0' : moneyToText(basisPoints))

const optionalMoney = (value: string) => value.trim() === '' || parseMoney(value) !== null

const lineSchema = z.object({
  variantId: z.string(),
  productName: z.string(),
  variantLabel: z.string(),
  baseUnitId: z.string(),
  trackLots: z.boolean(),
  trackSerials: z.boolean(),
  unitId: z.string(),
  qty: z.string().refine((value) => (parseQuantity(value) ?? 0) > 0, 'QUANTITY_INVALID'),
  cost: z.string().refine((value) => parseMoney(value) !== null, 'PRICE_INVALID'),
  discount: z.string().refine(optionalMoney, 'PRICE_INVALID'),
  tax: z.string().refine((value) => value.trim() === '' || parsePercent(value) !== null, 'INVALID_VALUE'),
  lotId: z.string(),
  lotLabel: z.string(),
  lotNo: z.string(),
  expiryDate: z.string(),
  serials: z.string(),
  orderLineId: z.string(),
  remainingBaseMilli: z.number().nullable(),
})

const formSchema = z.object({
  supplierId: z.string().min(1, 'REQUIRED'),
  supplierName: z.string(),
  warehouseId: z.string().min(1, 'REQUIRED'),
  orderId: z.string(),
  supplierReference: z.string().max(80, 'TEXT_TOO_LONG'),
  notes: z.string().max(500, 'TEXT_TOO_LONG'),
  paid: z.string().refine(optionalMoney, 'PRICE_INVALID'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  lines: z.array(lineSchema),
})

type FormValues = z.infer<typeof formSchema>
type LineValues = FormValues['lines'][number]
type PurchaseForm = UseFormReturn<FormValues>

const splitSerials = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean)

function toValues(purchase: Purchase | null): FormValues {
  if (!purchase) {
    return {
      supplierId: '',
      supplierName: '',
      warehouseId: 'main',
      orderId: '',
      supplierReference: '',
      notes: '',
      paid: '',
      paymentMethod: 'cash',
      lines: [],
    }
  }

  return {
    supplierId: purchase.supplierId,
    supplierName: purchase.supplierName,
    warehouseId: purchase.warehouseId,
    orderId: purchase.orderId ?? '',
    supplierReference: purchase.supplierReference ?? '',
    notes: purchase.notes ?? '',
    paid: purchase.paidMinor ? moneyToText(purchase.paidMinor) : '',
    paymentMethod: purchase.paymentMethod ?? 'cash',
    lines: purchase.lines.map((line) => ({
      variantId: line.variantId,
      productName: line.productName,
      variantLabel: line.variantLabel ?? '',
      baseUnitId: line.baseUnitId,
      trackLots: line.trackLots,
      trackSerials: line.trackSerials,
      unitId: line.unitId,
      qty: quantityToText(line.qtyMilli),
      cost: moneyToText(line.unitCostMinor),
      discount: line.discountMinor ? moneyToText(line.discountMinor) : '',
      tax: percentText(line.taxRateBp),
      lotId: line.lotId ?? '',
      lotLabel: line.lotId ? (line.lotNo ?? '') : '',
      lotNo: line.lotId ? '' : (line.lotNo ?? ''),
      expiryDate: line.expiryDate ?? '',
      serials: line.serials.join('\n'),
      orderLineId: line.orderLineId ?? '',
      remainingBaseMilli: null,
    })),
  }
}

/** A receipt starts with what the order still expects, in the unit it was ordered in. */
function fromOrder(order: Order): FormValues {
  const lines = order.lines.flatMap((line): LineValues[] => {
    const remaining = line.orderedBaseMilli - line.receivedBaseMilli
    if (remaining <= 0) return []
    return [
      {
        variantId: line.variantId,
        productName: line.productName,
        variantLabel: line.variantLabel ?? '',
        baseUnitId: line.baseUnitId,
        trackLots: line.trackLots,
        trackSerials: line.trackSerials,
        unitId: line.unitId,
        qty: quantityToText(Math.round((remaining * line.qtyMilli) / line.orderedBaseMilli)),
        cost: moneyToText(line.unitCostMinor),
        discount: '',
        tax: percentText(line.taxRateBp),
        lotId: '',
        lotLabel: '',
        lotNo: '',
        expiryDate: '',
        serials: '',
        orderLineId: line.id,
        remainingBaseMilli: remaining,
      },
    ]
  })

  return {
    ...toValues(null),
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    warehouseId: order.warehouseId,
    orderId: order.id,
    lines,
  }
}

const amountsOf = (line: Pick<LineValues, 'qty' | 'cost' | 'discount' | 'tax'>) => ({
  qtyMilli: parseQuantity(line.qty) ?? 0,
  unitCostMinor: parseMoney(line.cost) ?? 0,
  discountMinor: parseMoney(line.discount) ?? 0,
  taxRateBp: parsePercent(line.tax) ?? 0,
})

function toBody(values: FormValues, kind: PurchaseKind) {
  return purchaseInputSchema.parse({
    kind,
    supplierId: values.supplierId,
    warehouseId: values.warehouseId,
    orderId: values.orderId || null,
    supplierReference: values.supplierReference,
    notes: values.notes,
    paidMinor: kind === 'invoice' ? (parseMoney(values.paid) ?? 0) : 0,
    paymentMethod: values.paymentMethod,
    lines: values.lines.map((line) => ({
      ...amountsOf(line),
      variantId: line.variantId,
      unitId: line.unitId,
      lotId: line.lotId || null,
      lotNo: line.lotNo,
      expiryDate: line.expiryDate || null,
      serials: splitSerials(line.serials),
      orderLineId: line.orderLineId || null,
    })),
  })
}

const mapFieldPath = (path: string): string | null =>
  path
    .replace(/\.qtyMilli$/, '.qty')
    .replace(/\.unitCostMinor$/, '.cost')
    .replace(/\.discountMinor$/, '.discount')
    .replace(/\.taxRateBp$/, '.tax')
    .replace(/\.variantId$/, '.qty')
    .replace(/\.orderLineId$/, '.qty')
    .replace(/^paidMinor$/, 'paid')

function LineError({ form, path }: { form: PurchaseForm; path: `lines.${number}.${keyof LineValues & string}` }) {
  const errorText = useErrorText()
  const error = form.getFieldState(path, form.formState).error
  return error ? <p className="mt-1 text-sm text-danger">{errorText(error.message)}</p> : null
}

function Cell({ className = '', children }: { className?: string; children: ReactNode }) {
  return <td className={`border-b border-rule px-2 py-2 align-top ${className}`}>{children}</td>
}

function LotCell({
  form,
  index,
  incoming,
  pick,
}: {
  form: PurchaseForm
  index: number
  incoming: boolean
  pick: StockPickRow | undefined
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const line = form.getValues(`lines.${index}`)

  if (!line.trackLots) return <span className="text-ink-faint">-</span>
  if (line.lotLabel) return <bdi dir="ltr">{line.lotLabel}</bdi>

  if (incoming) {
    return (
      <div className="flex flex-col gap-1">
        <Input dir="ltr" aria-label={t('purchases.lot')} placeholder={t('purchases.lot')} {...form.register(`lines.${index}.lotNo`)} />
        <LineError form={form} path={`lines.${index}.lotNo`} />
        <Input type="date" dir="ltr" aria-label={t('purchases.expiry')} {...form.register(`lines.${index}.expiryDate`)} />
        <LineError form={form} path={`lines.${index}.expiryDate`} />
      </div>
    )
  }

  return (
    <Select aria-label={t('purchases.lot')} {...form.register(`lines.${index}.lotId`)}>
      <option value="">{t('stock.lotAuto')}</option>
      {pick?.lots
        .filter((lot) => lot.availableMilli > 0)
        .map((lot) => (
          <option key={lot.lotId} value={lot.lotId}>
            {lot.lotNo} ({lot.expiryDate ?? '-'}) - {format.quantity(lot.availableMilli)}
          </option>
        ))}
    </Select>
  )
}

function LineRow({
  form,
  index,
  kind,
  units,
  pick,
  locked,
  onRemove,
}: {
  form: PurchaseForm
  index: number
  kind: PurchaseKind
  units: Reference[]
  pick: StockPickRow | undefined
  locked: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const unitName = useReferenceName('units')
  const watched = useWatch({ control: form.control, name: `lines.${index}` })
  const line = form.getValues(`lines.${index}`)

  const unitIds = [line.baseUnitId, ...(pick?.units.map(({ unitId }) => unitId) ?? [])]
  const lineUnits = unitIds.includes(line.unitId) ? unitIds : [...unitIds, line.unitId]
  const { totalMinor } = purchaseLineTotals(amountsOf(watched))
  const columns = locked ? 8 : 9

  return (
    <Fragment>
      <tr>
        <Cell className="min-w-40">
          <p className="font-medium text-ink">{line.productName}</p>
          {line.variantLabel && <p className="text-sm text-ink-faint">{line.variantLabel}</p>}
          {line.remainingBaseMilli !== null && (
            <p className="text-sm text-ink-faint">{t('purchases.remaining', { value: format.quantity(line.remainingBaseMilli) })}</p>
          )}
        </Cell>
        <Cell className="w-24">
          <Input dir="ltr" inputMode="decimal" aria-label={t('purchases.quantity')} disabled={locked} {...form.register(`lines.${index}.qty`)} />
          <LineError form={form} path={`lines.${index}.qty`} />
        </Cell>
        <Cell className="w-28">
          <Select aria-label={t('purchases.unit')} disabled={locked || Boolean(line.orderLineId)} {...form.register(`lines.${index}.unitId`)}>
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
        </Cell>
        <Cell className="w-28">
          <Input dir="ltr" inputMode="decimal" aria-label={t('purchases.cost')} disabled={locked} {...form.register(`lines.${index}.cost`)} />
          <LineError form={form} path={`lines.${index}.cost`} />
        </Cell>
        <Cell className="w-24">
          <Input dir="ltr" inputMode="decimal" aria-label={t('purchases.discount')} disabled={locked} {...form.register(`lines.${index}.discount`)} />
          <LineError form={form} path={`lines.${index}.discount`} />
        </Cell>
        <Cell className="w-20">
          <Input dir="ltr" inputMode="decimal" aria-label={t('purchases.tax')} disabled={locked} {...form.register(`lines.${index}.tax`)} />
          <LineError form={form} path={`lines.${index}.tax`} />
        </Cell>
        <Cell className="min-w-48">
          {locked ? (
            <bdi dir="ltr">{line.lotLabel || line.lotNo || '-'}</bdi>
          ) : (
            <LotCell form={form} index={index} incoming={kind === 'invoice'} pick={pick} />
          )}
        </Cell>
        <Cell className="tabular w-28 pt-4 text-end font-medium text-ink">{format.money(totalMinor)}</Cell>
        {!locked && (
          <Cell className="w-10">
            <Button variant="ghost" size="icon" aria-label={t('purchases.removeLine')} onClick={onRemove}>
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </Cell>
        )}
      </tr>
      {line.trackSerials && (
        <tr>
          <td colSpan={columns} className="border-b border-rule bg-sunken px-2 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              {t('purchases.serials')}
              <textarea
                dir="ltr"
                rows={3}
                disabled={locked}
                className="w-full rounded-md border border-rule-strong bg-surface px-3 py-2 font-normal text-ink disabled:bg-sunken"
                {...form.register(`lines.${index}.serials`)}
              />
            </label>
            <p className="mt-1 text-sm text-ink-faint">
              {t('purchases.serialsHint', { count: format.quantity(parseQuantity(watched.qty) ?? 0) })}
            </p>
            <LineError form={form} path={`lines.${index}.serials`} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function Summary({ form, kind, locked }: { form: PurchaseForm; kind: PurchaseKind; locked: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const lines = useWatch({ control: form.control, name: 'lines' })
  const paid = useWatch({ control: form.control, name: 'paid' })
  const totals = purchaseDocumentTotals(lines.map(amountsOf))
  const left = totals.totalMinor - (parseMoney(paid) ?? 0)

  const row = (label: string, value: number, strong = false) => (
    <div className={`flex justify-between gap-6 ${strong ? 'border-t border-rule pt-2 text-lg font-semibold text-ink' : 'text-ink-soft'}`}>
      <dt>{label}</dt>
      <dd className="tabular">{format.money(value)}</dd>
    </div>
  )

  return (
    <section aria-label={t('purchases.summary')} className="grid grid-cols-[1fr_20rem] gap-6">
      {kind === 'invoice' ? (
        <fieldset disabled={locked} className="grid max-w-md grid-cols-2 content-start gap-4">
          <TextField form={form} name="paid" label={`${t('purchases.paidNow')} (${t('common.optional')})`} dir="ltr" inputMode="decimal" />
          <SelectField form={form} name="paymentMethod" label={t('purchases.method')}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`suppliers.methods.${method}`)}
              </option>
            ))}
          </SelectField>
        </fieldset>
      ) : (
        <span />
      )}
      <dl className="flex flex-col gap-1.5 rounded-lg border border-rule bg-surface px-4 py-3">
        {row(t('purchases.gross'), totals.grossMinor)}
        {row(t('purchases.discount'), totals.discountMinor)}
        {row(t('purchases.net'), totals.netMinor)}
        {row(t('purchases.taxAmount'), totals.taxMinor)}
        {row(t(kind === 'invoice' ? 'purchases.grandTotal' : 'purchases.returnTotal'), totals.totalMinor, true)}
        {kind === 'invoice' && row(t('purchases.balanceDue'), left)}
      </dl>
    </section>
  )
}

function BarTotal({ form, kind }: { form: PurchaseForm; kind: PurchaseKind }) {
  const { t } = useTranslation()
  const format = useFormat()
  const lines = useWatch({ control: form.control, name: 'lines' })

  return (
    <p className="text-ink-soft">
      {t(kind === 'invoice' ? 'purchases.grandTotal' : 'purchases.returnTotal')}:{' '}
      <span className="tabular text-lg font-semibold text-ink">{format.money(purchaseDocumentTotals(lines.map(amountsOf)).totalMinor)}</span>
    </p>
  )
}

type Confirming = 'post' | 'void' | 'delete' | null

function PurchaseEditor({
  purchase,
  initial,
  kind,
  warehouses,
  units,
}: {
  purchase: Purchase | null
  initial: FormValues
  kind: PurchaseKind
  warehouses: Reference[]
  units: Reference[]
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const warehouseName = useReferenceName('warehouses')
  const errorText = useErrorText()
  const canManage = useCan('purchases.manage')
  const canVoid = useCan('purchases.void')
  const [picks, setPicks] = useState<ReadonlyMap<string, StockPickRow>>(new Map())
  const [confirming, setConfirming] = useState<Confirming>(null)
  const done = useRef(false)
  // Survives a failed post: the retry must update the same draft, not create a second one.
  const savedId = useRef(purchase?.id ?? null)

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: initial })
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const report = useReportError(form, mapFieldPath)
  const warehouseId = useWatch({ control: form.control, name: 'warehouseId' })
  const supplierId = useWatch({ control: form.control, name: 'supplierId' })
  const supplierName = useWatch({ control: form.control, name: 'supplierName' })
  const orderId = useWatch({ control: form.control, name: 'orderId' })
  const { isDirty, errors } = form.formState

  const status = purchase?.status ?? 'draft'
  const locked = status !== 'draft' || !canManage
  const fromAnOrder = Boolean(orderId)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['purchases'] })
    await queryClient.invalidateQueries({ queryKey: ['suppliers'] })
    await queryClient.invalidateQueries({ queryKey: ['stock'] })
    await queryClient.invalidateQueries({ queryKey: ['products'] })
  }

  const leave = async () => {
    done.current = true
    await refresh()
    await navigate({ to: '/purchases' })
  }

  const saveDraft = async (values: FormValues) => {
    const body = toBody(values, kind)
    const saved = savedId.current
      ? await api(purchaseSchema, 'PUT', `/purchases/${savedId.current}`, { body })
      : await api(purchaseSchema, 'POST', '/purchases', { body })
    savedId.current = saved.id
    return saved
  }

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: async (saved) => {
      toast.success(t('purchases.saved'))
      form.reset(toValues(saved))
      done.current = true
      await refresh()
      await navigate({ to: '/purchases/$id', params: { id: saved.id } })
      done.current = false
    },
    onError: report,
  })

  const stopConfirming = (error: unknown) => {
    setConfirming(null)
    report(error)
  }

  const post = useMutation({
    mutationFn: async (values: FormValues) => {
      const saved = await saveDraft(values)
      return api(purchaseSchema, 'POST', `/purchases/${saved.id}/post`)
    },
    onSuccess: async () => {
      toast.success(t('purchases.posted'))
      await leave()
    },
    onError: stopConfirming,
  })

  const voidPurchase = useMutation({
    mutationFn: () => api(purchaseSchema, 'POST', `/purchases/${purchase!.id}/void`),
    onSuccess: async () => {
      toast.success(t('purchases.voided'))
      await leave()
    },
    onError: stopConfirming,
  })

  const remove = useMutation({
    mutationFn: () => api(okSchema, 'DELETE', `/purchases/${purchase!.id}`),
    onSuccess: async () => {
      toast.success(t('purchases.deleted'))
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
      trackLots: row.trackLots,
      trackSerials: row.trackSerials,
      unitId: row.unitId,
      qty: '1',
      cost: moneyToText(Math.round((row.costMinor * factor) / 1000)),
      discount: '',
      tax: percentText(row.taxRateBp),
      lotId: '',
      lotLabel: '',
      lotNo: '',
      expiryDate: '',
      serials: '',
      orderLineId: '',
      remainingBaseMilli: null,
    })
  }

  const hasLines = lines.fields.length > 0
  const stopLabels =
    status === 'voided'
      ? [t('purchases.statuses.draft'), t('purchases.statuses.posted'), t('purchases.statuses.voided')]
      : [t('purchases.statuses.draft'), t('purchases.statuses.posted')]
  const stopIndex = status === 'draft' ? 0 : status === 'posted' ? 1 : 2

  const confirmText = {
    post: {
      title: t('purchases.postTitle'),
      body: t(kind === 'invoice' ? 'purchases.postBodyInvoice' : 'purchases.postBodyReturn'),
      action: t('purchases.post'),
    },
    void: { title: t('purchases.voidTitle'), body: t('purchases.voidBody'), action: t('purchases.void') },
    delete: { title: t('purchases.deleteTitle'), body: t('purchases.deleteBody'), action: t('purchases.deleteDraft') },
  }

  const confirm = () => {
    if (confirming === 'post') void form.handleSubmit((values) => post.mutate(values), () => setConfirming(null))()
    if (confirming === 'void') voidPurchase.mutate()
    if (confirming === 'delete') remove.mutate()
  }

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusLine aria-label={t('purchases.stopsLabel')} steps={stopLabels} current={stopIndex} />
        {purchase?.orderId && (
          <p className="text-sm text-ink-soft">
            {t('purchases.fromOrder')}:{' '}
            <Link to="/orders/$id" params={{ id: purchase.orderId }} className="text-route hover:underline">
              <bdi dir="ltr">{purchase.orderNumber}</bdi>
            </Link>
          </p>
        )}
      </div>

      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <SupplierPicker
          value={supplierId ? { id: supplierId, name: supplierName } : null}
          disabled={locked || fromAnOrder}
          error={errors.supplierId ? errorText(errors.supplierId.message) : undefined}
          onChange={(supplier) => {
            form.setValue('supplierId', supplier?.id ?? '', { shouldDirty: true, shouldValidate: Boolean(supplier) })
            form.setValue('supplierName', supplier?.name ?? '')
          }}
        />
        <fieldset disabled={locked || fromAnOrder} className="contents">
          <SelectField form={form} name="warehouseId" label={t('purchases.warehouse')}>
            {warehouses
              .filter((row) => !row.archived)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {warehouseName(row)}
                </option>
              ))}
          </SelectField>
        </fieldset>
        <fieldset disabled={locked} className="contents">
          <TextField form={form} name="supplierReference" dir="ltr" label={`${t('purchases.supplierReference')} (${t('common.optional')})`} />
          <TextField form={form} name="notes" label={`${t('purchases.notes')} (${t('common.optional')})`} />
        </fieldset>
      </div>

      {!locked && !fromAnOrder && <ItemPicker warehouseId={warehouseId} onPick={addLine} />}

      {hasLines ? (
        <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sunken text-sm text-ink-soft">
                <th className="px-2 py-2.5 text-start font-medium">{t('purchases.item')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('purchases.quantity')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('purchases.unit')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('purchases.cost')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('purchases.discount')}</th>
                <th className="px-2 py-2.5 text-start font-medium whitespace-nowrap">{t('purchases.tax')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('purchases.lot')}</th>
                <th className="px-2 py-2.5 text-end font-medium">{t('purchases.lineTotal')}</th>
                {!locked && <th aria-label={t('purchases.removeLine')} />}
              </tr>
            </thead>
            <tbody>
              {lines.fields.map((field, index) => (
                <LineRow
                  key={field.id}
                  form={form}
                  index={index}
                  kind={kind}
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

      <Summary form={form} kind={kind} locked={locked} />

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 bg-ground px-1 py-3">
        <div className="flex items-center gap-4">
          {status === 'draft' && purchase && canManage && (
            <Button variant="ghost" onClick={() => setConfirming('delete')}>
              <Trash2 aria-hidden className="size-4" />
              {t('purchases.deleteDraft')}
            </Button>
          )}
          {status === 'posted' && canVoid && (
            <Button variant="danger" onClick={() => setConfirming('void')}>
              {t('purchases.void')}
            </Button>
          )}
          <BarTotal form={form} kind={kind} />
        </div>
        {!locked && (
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" loading={save.isPending}>
              {t('purchases.saveDraft')}
            </Button>
            <Button size="lg" disabled={!hasLines} onClick={() => setConfirming('post')}>
              {t('purchases.post')}
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={confirming ? confirmText[confirming].title : ''}
        description={confirming ? confirmText[confirming].body : ''}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={confirming === 'post' ? 'primary' : 'danger'}
            loading={post.isPending || voidPurchase.isPending || remove.isPending}
            onClick={confirm}
          >
            {confirming ? confirmText[confirming].action : ''}
          </Button>
        </div>
      </Dialog>
    </form>
  )
}

export function PurchasePage() {
  const { t } = useTranslation()
  const { id, kind: kindParam, orderId } = useParams({ strict: false })

  const purchase = useQuery({
    queryKey: ['purchases', 'document', id],
    queryFn: () => api(purchaseSchema, 'GET', `/purchases/${id}`),
    enabled: Boolean(id),
    gcTime: 0,
  })
  const order = useQuery({
    queryKey: ['purchases', 'order', orderId],
    queryFn: () => api(orderSchema, 'GET', `/purchase-orders/${orderId}`),
    enabled: Boolean(orderId),
    gcTime: 0,
  })
  const warehouses = useQuery(referenceQuery('warehouses'))
  const units = useQuery(referenceQuery('units'))

  const kind = (purchase.data?.kind ?? kindParam ?? 'invoice') as PurchaseKind
  const queries = [warehouses, units, ...(id ? [purchase] : []), ...(orderId ? [order] : [])]
  const failed = queries.find((query) => query.isError)
  const ready = queries.every((query) => query.data !== undefined)

  const title = purchase.data?.number
    ? `${t(`purchases.kinds.${kind}`)} ${purchase.data.number}`
    : order.data
      ? t('purchases.receiveTitle', { number: order.data.number ?? '' })
      : t('purchases.newTitle', { kind: t(`purchases.kinds.${kind}`) })

  return (
    <div className="flex flex-col gap-5">
      <Sign title={title} secondary={t('nav.purchases.label')} />
      {failed ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : !ready ? (
        <FormSkeleton fields={4} />
      ) : (
        <PurchaseEditor
          key={purchase.data ? `${purchase.data.id}-${purchase.data.status}` : (order.data?.id ?? kind)}
          purchase={purchase.data ?? null}
          initial={order.data ? fromOrder(order.data) : toValues(purchase.data ?? null)}
          kind={kind}
          warehouses={warehouses.data!.items}
          units={units.data!.items}
        />
      )}
    </div>
  )
}

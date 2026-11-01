import {
  ADJUSTMENT_REASONS,
  okSchema,
  stockDocumentInputSchema,
  stockDocumentSchema,
  type AdjustmentReason,
  type Reference,
  type StockDocument,
  type StockDocumentKind,
  type StockPickRow,
} from '@inv/contracts'
import { moneyToText, parseMoney, parseQuantity, quantityToText } from '@inv/domain'
import { Badge, Button, Dialog, FormSkeleton, Input, Select, Sign, StatusLine, cn } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { ItemPicker } from './item-picker'

const DEDUCTING_REASONS: readonly AdjustmentReason[] = ['damage', 'expired', 'theft', 'gift']

const lineSchema = z.object({
  variantId: z.string(),
  productName: z.string(),
  variantLabel: z.string(),
  baseUnitId: z.string(),
  trackLots: z.boolean(),
  unitId: z.string(),
  direction: z.enum(['add', 'deduct']),
  qty: z.string().refine((value) => parseQuantity(value) !== null, 'QUANTITY_INVALID'),
  lotId: z.string(),
  lotLabel: z.string(),
  lotNo: z.string(),
  expiryDate: z.string(),
  cost: z.string().refine((value) => value.trim() === '' || parseMoney(value) !== null, 'PRICE_INVALID'),
  expectedMilli: z.number().nullable(),
})

const formSchema = z.object({
  warehouseId: z.string().min(1, 'REQUIRED'),
  toWarehouseId: z.string(),
  reason: z.string(),
  notes: z.string().max(500, 'TEXT_TOO_LONG'),
  lines: z.array(lineSchema),
})

type FormValues = z.infer<typeof formSchema>
type LineValues = FormValues['lines'][number]
type DocumentForm = UseFormReturn<FormValues>

function toValues(document: StockDocument | null): FormValues {
  if (!document) return { warehouseId: 'main', toWarehouseId: '', reason: '', notes: '', lines: [] }

  return {
    warehouseId: document.warehouseId,
    toWarehouseId: document.toWarehouseId ?? '',
    reason: document.reason ?? '',
    notes: document.notes ?? '',
    lines: document.lines.map((line) => ({
      variantId: line.variantId,
      productName: line.productName,
      variantLabel: line.variantLabel ?? '',
      baseUnitId: line.baseUnitId,
      trackLots: line.trackLots,
      unitId: line.unitId,
      direction: line.qtyMilli < 0 ? 'deduct' : 'add',
      qty: quantityToText(Math.abs(line.qtyMilli)),
      lotId: line.lotId ?? '',
      lotLabel: line.lotId ? (line.lotNo ?? '') : '',
      lotNo: line.lotId ? '' : (line.lotNo ?? ''),
      expiryDate: line.expiryDate ?? '',
      cost: line.unitCostMinor === null ? '' : moneyToText(line.unitCostMinor),
      expectedMilli: line.expectedMilli,
    })),
  }
}

function toBody(values: FormValues, kind: StockDocumentKind) {
  const reason = values.reason as AdjustmentReason | ''
  const fixedDeduct = reason !== '' && DEDUCTING_REASONS.includes(reason)
  const fixedAdd = reason === 'opening'

  return stockDocumentInputSchema.parse({
    kind,
    warehouseId: values.warehouseId,
    toWarehouseId: values.toWarehouseId || null,
    reason: kind === 'adjustment' ? reason || null : null,
    notes: values.notes,
    lines: values.lines.map((line) => {
      const qty = parseQuantity(line.qty) ?? 0
      const deducts = kind === 'adjustment' && (fixedDeduct || (!fixedAdd && line.direction === 'deduct'))
      return {
        variantId: line.variantId,
        unitId: line.unitId,
        qtyMilli: deducts ? -qty : qty,
        lotId: line.lotId || null,
        lotNo: line.lotNo,
        expiryDate: line.expiryDate || null,
        unitCostMinor: line.cost.trim() ? parseMoney(line.cost) : null,
      }
    }),
  })
}

const mapFieldPath = (path: string): string | null =>
  path.replace(/\.qtyMilli$/, '.qty').replace(/\.unitCostMinor$/, '.cost').replace(/\.variantId$/, '.qty')

function LineError({ form, path }: { form: DocumentForm; path: `lines.${number}.${keyof LineValues & string}` }) {
  const errorText = useErrorText()
  const error = form.getFieldState(path, form.formState).error
  return error ? <p className="mt-1 text-sm text-danger">{errorText(error.message)}</p> : null
}

function Cell({ className, children }: { className?: string; children: ReactNode }) {
  return <td className={cn('border-b border-rule px-2 py-2 align-top', className)}>{children}</td>
}

function LotCell({
  form,
  index,
  incoming,
  pick,
}: {
  form: DocumentForm
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
        <Input dir="ltr" aria-label={t('stock.lot')} placeholder={t('stock.lot')} {...form.register(`lines.${index}.lotNo`)} />
        <LineError form={form} path={`lines.${index}.lotNo`} />
        <Input type="date" dir="ltr" aria-label={t('stock.expiry')} {...form.register(`lines.${index}.expiryDate`)} />
        <LineError form={form} path={`lines.${index}.expiryDate`} />
      </div>
    )
  }

  return (
    <Select aria-label={t('stock.lot')} {...form.register(`lines.${index}.lotId`)}>
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
  form: DocumentForm
  index: number
  kind: StockDocumentKind
  units: Reference[]
  pick: StockPickRow | undefined
  locked: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const unitName = useReferenceName('units')
  const reason = useWatch({ control: form.control, name: 'reason' }) as AdjustmentReason | ''
  const direction = useWatch({ control: form.control, name: `lines.${index}.direction` })
  const qty = useWatch({ control: form.control, name: `lines.${index}.qty` })
  const line = form.getValues(`lines.${index}`)

  const fixed = reason === 'opening' || (reason !== '' && DEDUCTING_REASONS.includes(reason))
  const deducting = reason !== '' && DEDUCTING_REASONS.includes(reason) ? true : reason === 'opening' ? false : direction === 'deduct'
  const incoming = kind === 'count' ? line.expectedMilli === null : kind === 'adjustment' && !deducting
  const unitIds = [line.baseUnitId, ...(pick?.units.map(({ unitId }) => unitId) ?? [])]
  const lineUnits = unitIds.includes(line.unitId) ? unitIds : [...unitIds, line.unitId]
  const counted = parseQuantity(qty)
  const difference = kind === 'count' && line.expectedMilli !== null && counted !== null ? counted - line.expectedMilli : null

  return (
    <tr className="[contain-intrinsic-size:auto_56px] [content-visibility:auto]">
      <Cell className="min-w-44">
        <p className="font-medium text-ink">{line.productName}</p>
        {line.variantLabel && <p className="text-sm text-ink-faint">{line.variantLabel}</p>}
      </Cell>
      {kind === 'adjustment' && !fixed && (
        <Cell className="w-24">
          <Select aria-label={t('stock.direction')} disabled={locked} {...form.register(`lines.${index}.direction`)}>
            <option value="add">{t('stock.add')}</option>
            <option value="deduct">{t('stock.deduct')}</option>
          </Select>
        </Cell>
      )}
      {kind === 'count' && (
        <Cell className="tabular w-24 pt-4 text-ink-soft">
          {line.expectedMilli === null ? '-' : format.quantity(line.expectedMilli)}
        </Cell>
      )}
      <Cell className="w-28">
        <Input
          dir="ltr"
          inputMode="decimal"
          aria-label={kind === 'count' ? t('stock.counted') : t('stock.quantity')}
          aria-invalid={form.getFieldState(`lines.${index}.qty`, form.formState).error ? true : undefined}
          disabled={locked}
          {...form.register(`lines.${index}.qty`)}
        />
        <LineError form={form} path={`lines.${index}.qty`} />
      </Cell>
      {kind === 'count' && (
        <Cell className="tabular w-20 pt-4">
          {difference !== null && difference !== 0 && (
            <bdi dir="ltr" className={difference > 0 ? 'text-ok' : 'text-danger'}>
              {difference > 0 ? '+' : ''}
              {format.quantity(difference)}
            </bdi>
          )}
        </Cell>
      )}
      <Cell className="w-32">
        <Select aria-label={t('stock.unit')} disabled={locked || kind === 'count'} {...form.register(`lines.${index}.unitId`)}>
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
      <Cell className="min-w-44">
        {locked ? (
          <bdi dir="ltr">{line.lotLabel || line.lotNo || '-'}</bdi>
        ) : (
          <LotCell form={form} index={index} incoming={incoming} pick={pick} />
        )}
      </Cell>
      {kind === 'adjustment' && (
        <Cell className="w-28">
          {!deducting && (
            <>
              <Input dir="ltr" inputMode="decimal" aria-label={t('stock.cost')} disabled={locked} {...form.register(`lines.${index}.cost`)} />
              <LineError form={form} path={`lines.${index}.cost`} />
            </>
          )}
        </Cell>
      )}
      {!locked && (
        <Cell className="w-10">
          <Button variant="ghost" size="icon" aria-label={t('stock.removeLine')} onClick={onRemove}>
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </Cell>
      )}
    </tr>
  )
}

type Confirming = 'post' | 'void' | 'delete' | null

const CONFIRM_TEXT = {
  post: { title: 'stock.postTitle', body: 'stock.postBody', action: 'stock.post' },
  void: { title: 'stock.voidTitle', body: 'stock.voidBody', action: 'stock.void' },
  delete: { title: 'stock.deleteTitle', body: 'stock.deleteBody', action: 'stock.deleteDraft' },
} as const

function DocumentEditor({
  document,
  kind,
  warehouses,
  units,
}: {
  document: StockDocument | null
  kind: StockDocumentKind
  warehouses: Reference[]
  units: Reference[]
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const warehouseName = useReferenceName('warehouses')
  const canManage = useCan('stock.manage')
  const canVoid = useCan('stock.void')
  const [picks, setPicks] = useState<ReadonlyMap<string, StockPickRow>>(new Map())
  const [confirming, setConfirming] = useState<Confirming>(null)
  const done = useRef(false)
  // Survives a failed post: the retry must update the same draft, not create a second one.
  const savedId = useRef(document?.id ?? null)

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: toValues(document) })
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const report = useReportError(form, mapFieldPath)
  const warehouseId = useWatch({ control: form.control, name: 'warehouseId' })
  const { isDirty } = form.formState

  const status = document?.status ?? 'draft'
  const locked = status !== 'draft' || !canManage

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['stock'] })
    await queryClient.invalidateQueries({ queryKey: ['products'] })
  }

  const leave = async () => {
    done.current = true
    await refresh()
    await navigate({ to: '/stock' })
  }

  const saveDraft = async (values: FormValues) => {
    const body = toBody(values, kind)
    const saved = savedId.current
      ? await api(stockDocumentSchema, 'PUT', `/stock/documents/${savedId.current}`, { body })
      : await api(stockDocumentSchema, 'POST', '/stock/documents', { body })
    savedId.current = saved.id
    return saved
  }

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: async (saved) => {
      toast.success(t('stock.saved'))
      form.reset(toValues(saved))
      done.current = true
      await refresh()
      await navigate({ to: '/stock/$id', params: { id: saved.id } })
      done.current = false
    },
    onError: report,
  })

  const post = useMutation({
    mutationFn: async (values: FormValues) => {
      const saved = await saveDraft(values)
      return api(stockDocumentSchema, 'POST', `/stock/documents/${saved.id}/post`)
    },
    onSuccess: async () => {
      toast.success(t('stock.posted'))
      await leave()
    },
    onError: (error) => {
      setConfirming(null)
      report(error)
    },
  })

  const voidDocument = useMutation({
    mutationFn: () => api(stockDocumentSchema, 'POST', `/stock/documents/${document!.id}/void`),
    onSuccess: async () => {
      toast.success(t('stock.voided'))
      await leave()
    },
    onError: (error) => {
      setConfirming(null)
      report(error)
    },
  })

  const remove = useMutation({
    mutationFn: () => api(okSchema, 'DELETE', `/stock/documents/${document!.id}`),
    onSuccess: async () => {
      toast.success(t('stock.deleted'))
      await leave()
    },
    onError: (error) => {
      setConfirming(null)
      report(error)
    },
  })

  const addLine = (row: StockPickRow) => {
    setPicks((current) => new Map(current).set(row.variantId, row))
    lines.append({
      variantId: row.variantId,
      productName: row.productName,
      variantLabel: row.variantLabel ?? '',
      baseUnitId: row.baseUnitId,
      trackLots: row.trackLots,
      unitId: row.unitId,
      direction: 'add',
      qty: '1',
      lotId: '',
      lotLabel: '',
      lotNo: '',
      expiryDate: '',
      cost: '',
      expectedMilli: null,
    })
  }

  const usableWarehouses = warehouses.filter((row) => !row.archived)
  const hasLines = lines.fields.length > 0
  const stopLabels =
    status === 'voided'
      ? [t('stock.statuses.draft'), t('stock.statuses.posted'), t('stock.statuses.voided')]
      : [t('stock.statuses.draft'), t('stock.statuses.posted')]
  const stopIndex = status === 'draft' ? 0 : status === 'posted' ? 1 : 2

  const confirm = () => {
    if (confirming === 'post') void form.handleSubmit((values) => post.mutate(values))()
    if (confirming === 'void') voidDocument.mutate()
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
        <StatusLine aria-label={t('stock.stopsLabel')} steps={stopLabels} current={stopIndex} />
        {document?.createdBy && (
          <p className="text-sm text-ink-faint">
            {t('stock.createdBy')}: {document.createdBy}
          </p>
        )}
      </div>

      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <fieldset disabled={locked} className="contents">
          <SelectField
            form={form}
            name="warehouseId"
            label={kind === 'transfer' ? t('stock.fromWarehouse') : t('stock.warehouse')}
          >
            {usableWarehouses.map((row) => (
              <option key={row.id} value={row.id}>
                {warehouseName(row)}
              </option>
            ))}
          </SelectField>
          {kind === 'transfer' && (
            <SelectField form={form} name="toWarehouseId" label={t('stock.toWarehouse')}>
              <option value="">-</option>
              {usableWarehouses.map((row) => (
                <option key={row.id} value={row.id}>
                  {warehouseName(row)}
                </option>
              ))}
            </SelectField>
          )}
          {kind === 'adjustment' && (
            <SelectField form={form} name="reason" label={t('stock.reason')}>
              <option value="">{t('stock.chooseReason')}</option>
              {ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`stock.reasons.${reason}`)}
                </option>
              ))}
            </SelectField>
          )}
          <TextField form={form} name="notes" label={`${t('stock.notes')} (${t('common.optional')})`} className="col-span-2" />
        </fieldset>
      </div>

      {!locked && kind !== 'count' && <ItemPicker warehouseId={warehouseId} onPick={addLine} />}
      {!locked && kind === 'count' && <p className="text-ink-soft">{t('stock.countHint')}</p>}

      {hasLines ? (
        <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sunken text-start text-sm text-ink-soft">
                <th className="px-2 py-2.5 text-start font-medium">{t('stock.item')}</th>
                {kind === 'adjustment' && !['opening', ...DEDUCTING_REASONS].includes(form.getValues('reason')) && (
                  <th className="px-2 py-2.5 text-start font-medium">{t('stock.direction')}</th>
                )}
                {kind === 'count' && <th className="px-2 py-2.5 text-start font-medium">{t('stock.expected')}</th>}
                <th className="px-2 py-2.5 text-start font-medium">
                  {kind === 'count' ? t('stock.counted') : t('stock.quantity')}
                </th>
                {kind === 'count' && <th className="px-2 py-2.5 text-start font-medium">{t('stock.difference')}</th>}
                <th className="px-2 py-2.5 text-start font-medium">{t('stock.unit')}</th>
                <th className="px-2 py-2.5 text-start font-medium">{t('stock.lot')}</th>
                {kind === 'adjustment' && <th className="px-2 py-2.5 text-start font-medium">{t('stock.cost')}</th>}
                {!locked && <th aria-label={t('stock.removeLine')} />}
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
        <p className="rounded-lg border border-dashed border-rule-strong bg-surface px-6 py-8 text-ink-soft">{t('stock.noLines')}</p>
      )}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 bg-ground px-1 py-3">
        <div>
          {status === 'draft' && document && canManage && (
            <Button variant="ghost" onClick={() => setConfirming('delete')}>
              <Trash2 aria-hidden className="size-4" />
              {t('stock.deleteDraft')}
            </Button>
          )}
          {status === 'posted' && canVoid && (
            <Button variant="danger" onClick={() => setConfirming('void')}>
              {t('stock.void')}
            </Button>
          )}
        </div>
        {!locked && (
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" loading={save.isPending}>
              {t('stock.saveDraft')}
            </Button>
            <Button size="lg" disabled={!hasLines} onClick={() => setConfirming('post')}>
              {t('stock.post')}
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
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
            variant={confirming === 'post' ? 'primary' : 'danger'}
            loading={post.isPending || voidDocument.isPending || remove.isPending}
            onClick={confirm}
          >
            {confirming ? t(CONFIRM_TEXT[confirming].action) : ''}
          </Button>
        </div>
      </Dialog>
    </form>
  )
}

export function DocumentPage() {
  const { t } = useTranslation()
  const { id, kind: kindParam } = useParams({ strict: false })

  const document = useQuery({
    queryKey: ['stock', 'document', id],
    queryFn: () => api(stockDocumentSchema, 'GET', `/stock/documents/${id}`),
    enabled: Boolean(id),
    gcTime: 0,
  })
  const warehouses = useQuery(referenceQuery('warehouses'))
  const units = useQuery(referenceQuery('units'))

  const kind = (document.data?.kind ?? kindParam ?? 'adjustment') as StockDocumentKind
  const queries = [warehouses, units, ...(id ? [document] : [])]
  const failed = queries.find((query) => query.isError)
  const ready = queries.every((query) => query.data !== undefined)

  const title = document.data?.number
    ? `${t(`stock.kinds.${kind}`)} ${document.data.number}`
    : t('stock.newTitle', { kind: t(`stock.kinds.${kind}`) })

  return (
    <div className="flex flex-col gap-5">
      <Sign
        title={title}
        secondary={t('nav.stock.label')}
        actions={document.data?.reason && <Badge>{t(`stock.reasons.${document.data.reason}`)}</Badge>}
      />
      {failed ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : !ready ? (
        <FormSkeleton fields={3} />
      ) : (
        <DocumentEditor
          key={document.data ? `${document.data.id}-${document.data.status}` : 'new'}
          document={document.data ?? null}
          kind={kind}
          warehouses={warehouses.data!.items}
          units={units.data!.items}
        />
      )}
    </div>
  )
}

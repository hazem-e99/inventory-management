import {
  generatedBarcodeSchema,
  productInputSchema,
  productSchema,
  type Attribute,
  type Features,
  type Product,
  type Reference,
} from '@inv/contracts'
import { moneyToText, parseMoney, parseQuantity, quantityToText } from '@inv/domain'
import { Button, Field, FormSkeleton, Input, Sign } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Barcode, Plus, Trash2, WandSparkles } from 'lucide-react'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SelectField, SubmitButton, TextField, UnsavedGuard } from '../../components/form'
import { ErrorState } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { settingsQuery } from '../settings/queries'
import { AttributeMatrix } from './attribute-matrix'
import { attributesQuery, referenceQuery, useReferenceName } from './queries'

const moneyText = z.string().refine((value) => value.trim() === '' || parseMoney(value) !== null, 'PRICE_INVALID')

const barcodeRow = z.object({
  code: z.string().trim().min(1, 'REQUIRED').max(32, 'BARCODE_INVALID'),
  unitId: z.string(),
})

const formSchema = z.object({
  name: z.string().trim().min(1, 'REQUIRED').max(120, 'TEXT_TOO_LONG'),
  nameEn: z.string().max(120, 'TEXT_TOO_LONG'),
  genericName: z.string().max(160, 'TEXT_TOO_LONG'),
  description: z.string().max(1000, 'TEXT_TOO_LONG'),
  categoryId: z.string(),
  brandId: z.string(),
  taxRateId: z.string(),
  baseUnitId: z.string().min(1, 'REQUIRED'),
  prescriptionRequired: z.boolean(),
  trackLots: z.boolean(),
  trackSerials: z.boolean(),
  conversions: z.array(
    z.object({
      unitId: z.string().min(1, 'REQUIRED'),
      factor: z.string().refine((value) => (parseQuantity(value) ?? 0) > 0, 'FACTOR_INVALID'),
    }),
  ),
  variants: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().max(120, 'TEXT_TOO_LONG'),
        sku: z.string().max(40, 'TEXT_TOO_LONG'),
        cost: moneyText,
        reorder: z.string().refine((value) => value.trim() === '' || parseQuantity(value) !== null, 'QUANTITY_INVALID'),
        barcodes: z.array(barcodeRow),
        prices: z.record(z.string(), moneyText),
        attributeValueIds: z.array(z.string()),
      }),
    )
    .min(1, 'VARIANT_REQUIRED'),
})

type FormValues = z.infer<typeof formSchema>
type ProductForm = UseFormReturn<FormValues>
export type VariantValues = FormValues['variants'][number]

const priceKey = (priceListId: string, unitId: string) => `${priceListId}__${unitId}`

export const emptyVariant = (label = '', attributeValueIds: string[] = []): VariantValues => ({
  label,
  sku: '',
  cost: '',
  reorder: '',
  barcodes: [],
  prices: {},
  attributeValueIds,
})

function toValues(product: Product | null, features: Features): FormValues {
  if (!product) {
    return {
      name: '',
      nameEn: '',
      genericName: '',
      description: '',
      categoryId: '',
      brandId: '',
      taxRateId: 'vat',
      baseUnitId: features.fractionalQuantities ? 'kilogram' : 'piece',
      prescriptionRequired: false,
      trackLots: features.lots,
      trackSerials: features.serialNumbers,
      conversions: [],
      variants: [emptyVariant()],
    }
  }

  return {
    name: product.name,
    nameEn: product.nameEn ?? '',
    genericName: product.genericName ?? '',
    description: product.description ?? '',
    categoryId: product.categoryId ?? '',
    brandId: product.brandId ?? '',
    taxRateId: product.taxRateId ?? '',
    baseUnitId: product.baseUnitId,
    prescriptionRequired: product.prescriptionRequired,
    trackLots: product.trackLots,
    trackSerials: product.trackSerials,
    conversions: product.conversions.map(({ unitId, factorMilli }) => ({
      unitId,
      factor: quantityToText(factorMilli),
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      label: variant.label ?? '',
      sku: variant.sku,
      cost: variant.costMinor ? moneyToText(variant.costMinor) : '',
      reorder: variant.reorderLevelMilli === null ? '' : quantityToText(variant.reorderLevelMilli),
      barcodes: variant.barcodes,
      prices: Object.fromEntries(
        variant.prices.map(({ priceListId, unitId, amountMinor }) => [
          priceKey(priceListId, unitId),
          moneyToText(amountMinor),
        ]),
      ),
      attributeValueIds: variant.attributeValueIds,
    })),
  }
}

function toBody(values: FormValues) {
  return productInputSchema.parse({
    name: values.name,
    nameEn: values.nameEn,
    genericName: values.genericName,
    description: values.description,
    categoryId: values.categoryId || null,
    brandId: values.brandId || null,
    taxRateId: values.taxRateId || null,
    baseUnitId: values.baseUnitId,
    prescriptionRequired: values.prescriptionRequired,
    trackLots: values.trackLots,
    trackSerials: values.trackSerials,
    conversions: values.conversions.map(({ unitId, factor }) => ({ unitId, factorMilli: parseQuantity(factor) })),
    variants: values.variants.map((variant) => ({
      ...(variant.id ? { id: variant.id } : {}),
      label: variant.label,
      ...(variant.sku.trim() ? { sku: variant.sku } : {}),
      costMinor: parseMoney(variant.cost) ?? 0,
      reorderLevelMilli: variant.reorder.trim() ? parseQuantity(variant.reorder) : null,
      barcodes: variant.barcodes,
      prices: Object.entries(variant.prices).flatMap(([key, text]) => {
        const amountMinor = parseMoney(text)
        const [priceListId, unitId] = key.split('__')
        return amountMinor === null ? [] : [{ priceListId, unitId, amountMinor }]
      }),
      attributeValueIds: variant.attributeValueIds,
    })),
  })
}

/** API field paths that differ from the form's text inputs. */
function mapFieldPath(path: string): string | null {
  if (path.includes('.prices.')) return null
  return path.replace(/\.costMinor$/, '.cost').replace(/\.factorMilli$/, '.factor')
}

function Section({ title, body, children }: { title: ReactNode; body?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b border-rule pb-6 last:border-b-0">
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {body && <p className="text-ink-soft">{body}</p>}
      </div>
      {children}
    </section>
  )
}

function Checkbox({ form, name, label }: { form: ProductForm; name: 'prescriptionRequired' | 'trackLots' | 'trackSerials'; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-ink">
      <input type="checkbox" className="size-4 accent-route" {...form.register(name)} />
      {label}
    </label>
  )
}

interface References {
  units: Reference[]
  categories: Reference[]
  brands: Reference[]
  taxRates: Reference[]
  priceLists: Reference[]
}

function BasicsSection({ form, references, features }: { form: ProductForm; references: References; features: Features }) {
  const { t } = useTranslation()
  const taxName = useReferenceName('tax-rates')
  const usable = (rows: Reference[], current: string) => rows.filter((row) => !row.archived || row.id === current)
  const values = form.getValues()

  return (
    <Section title={t('product.basics')}>
      <TextField form={form} name="name" label={t('product.name')} autoFocus />
      <div className="grid grid-cols-2 gap-4">
        <TextField form={form} name="nameEn" dir="ltr" label={`${t('product.nameEn')} (${t('common.optional')})`} />
        <TextField
          form={form}
          name="genericName"
          label={`${t('product.genericName')} (${t('common.optional')})`}
          hint={t('product.genericHint')}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <SelectField form={form} name="categoryId" label={t('product.category')}>
          <option value="">{t('product.none')}</option>
          {usable(references.categories, values.categoryId).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </SelectField>
        <SelectField form={form} name="brandId" label={t('product.brand')}>
          <option value="">{t('product.none')}</option>
          {usable(references.brands, values.brandId).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </SelectField>
        <SelectField form={form} name="taxRateId" label={t('product.tax')}>
          <option value="">{t('product.none')}</option>
          {usable(references.taxRates, values.taxRateId).map((row) => (
            <option key={row.id} value={row.id}>
              {taxName(row)}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {features.expiryRequired && <Checkbox form={form} name="prescriptionRequired" label={t('product.prescription')} />}
        <Checkbox form={form} name="trackLots" label={t('product.trackLots')} />
        <Checkbox form={form} name="trackSerials" label={t('product.trackSerials')} />
      </div>
    </Section>
  )
}

function UnitsSection({ form, units }: { form: ProductForm; units: Reference[] }) {
  const { t } = useTranslation()
  const unitName = useReferenceName('units')
  const conversions = useFieldArray({ control: form.control, name: 'conversions' })
  const baseUnitId = useWatch({ control: form.control, name: 'baseUnitId' })
  const baseUnit = units.find((unit) => unit.id === baseUnitId)
  const options = units.filter((unit) => !unit.archived)

  return (
    <Section title={t('product.units')} body={t('product.unitsBody')}>
      <div className="max-w-xs">
        <SelectField form={form} name="baseUnitId" label={t('product.baseUnit')}>
          {options.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unitName(unit)}
            </option>
          ))}
        </SelectField>
      </div>

      {conversions.fields.map((field, index) => (
        <div key={field.id} className="grid max-w-xl grid-cols-[1fr_1fr_auto] items-start gap-3">
          <SelectField form={form} name={`conversions.${index}.unitId`} label={t('product.unit')}>
            <option value="">-</option>
            {options
              .filter((unit) => unit.id !== baseUnitId)
              .map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unitName(unit)}
                </option>
              ))}
          </SelectField>
          <TextField
            form={form}
            name={`conversions.${index}.factor`}
            dir="ltr"
            inputMode="decimal"
            label={t('product.factor', { unit: baseUnit ? unitName(baseUnit) : '' })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="mt-7"
            aria-label={t('product.remove')}
            onClick={() => conversions.remove(index)}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      ))}

      <div>
        <Button variant="secondary" size="sm" onClick={() => conversions.append({ unitId: '', factor: '' })}>
          <Plus aria-hidden className="size-4" />
          {t('product.addUnit')}
        </Button>
      </div>
    </Section>
  )
}

function PriceInput({
  form,
  variantIndex,
  priceListId,
  unitId,
  label,
}: {
  form: ProductForm
  variantIndex: number
  priceListId: string
  unitId: string
  label: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const name = `variants.${variantIndex}.prices.${priceKey(priceListId, unitId)}` as const
  const error = form.getFieldState(name, form.formState).error

  return (
    <Field id={id} label={label} error={error ? t('errors.PRICE_INVALID') : undefined}>
      <Input id={id} dir="ltr" inputMode="decimal" aria-invalid={error ? true : undefined} {...form.register(name)} />
    </Field>
  )
}

function VariantEditor({
  form,
  index,
  references,
  showLabel,
  onRemove,
}: {
  form: ProductForm
  index: number
  references: References
  showLabel: boolean
  onRemove?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const unitName = useReferenceName('units')
  const priceListName = useReferenceName('price-lists')
  const report = useReportError()
  const [generating, setGenerating] = useState(false)
  const barcodes = useFieldArray({ control: form.control, name: `variants.${index}.barcodes` })
  const baseUnitId = useWatch({ control: form.control, name: 'baseUnitId' })
  const conversions = useWatch({ control: form.control, name: 'conversions' })

  const activeUnits = useMemo(() => {
    const ids = [baseUnitId, ...conversions.map(({ unitId }) => unitId).filter(Boolean)]
    return ids.flatMap((id) => references.units.filter((unit) => unit.id === id))
  }, [baseUnitId, conversions, references.units])

  const priceLists = references.priceLists.filter((list) => !list.archived)

  const generate = async () => {
    setGenerating(true)
    await api(generatedBarcodeSchema, 'POST', '/catalog/barcodes/generate')
      .then(({ code }) => barcodes.append({ code, unitId: baseUnitId }))
      .catch(report)
      .finally(() => setGenerating(false))
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-rule bg-surface p-4">
      {showLabel && (
        <div className="flex items-start gap-3">
          <TextField form={form} name={`variants.${index}.label`} label={t('product.variantLabel')} className="flex-1" />
          {onRemove && (
            <Button variant="ghost" size="icon" className="mt-7" aria-label={t('product.removeVariant')} onClick={onRemove}>
              <Trash2 aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <TextField form={form} name={`variants.${index}.sku`} dir="ltr" label={t('product.sku')} hint={t('product.skuHint')} />
        <TextField form={form} name={`variants.${index}.cost`} dir="ltr" inputMode="decimal" label={t('product.cost')} />
        <TextField
          form={form}
          name={`variants.${index}.reorder`}
          dir="ltr"
          inputMode="decimal"
          label={t('product.reorderLevel')}
          hint={t('product.reorderHint')}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        {priceLists.flatMap((list) =>
          activeUnits.map((unit) => (
            <PriceInput
              key={`${list.id}-${unit.id}`}
              form={form}
              variantIndex={index}
              priceListId={list.id}
              unitId={unit.id}
              label={`${priceListName(list)} / ${unitName(unit)}`}
            />
          )),
        )}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink">{t('product.barcodes')}</p>
        {barcodes.fields.map((field, barcodeIndex) => (
          <div key={field.id} className="grid max-w-xl grid-cols-[1fr_11rem_auto] items-start gap-3">
            <TextField
              form={form}
              name={`variants.${index}.barcodes.${barcodeIndex}.code`}
              dir="ltr"
              label={t('product.barcode')}
              autoComplete="off"
            />
            <SelectField form={form} name={`variants.${index}.barcodes.${barcodeIndex}.unitId`} label={t('product.unit')}>
              {activeUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unitName(unit)}
                </option>
              ))}
            </SelectField>
            <Button
              variant="ghost"
              size="icon"
              className="mt-7"
              aria-label={t('product.remove')}
              onClick={() => barcodes.remove(barcodeIndex)}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => barcodes.append({ code: '', unitId: baseUnitId })}>
            <Barcode aria-hidden className="size-4" />
            {t('product.addBarcode')}
          </Button>
          <Button variant="ghost" size="sm" loading={generating} onClick={() => void generate()}>
            <WandSparkles aria-hidden className="size-4" />
            {t('product.generate')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function PricingSection({
  form,
  references,
  attributes,
  features,
}: {
  form: ProductForm
  references: References
  attributes: Attribute[]
  features: Features
}) {
  const { t } = useTranslation()
  const variants = useFieldArray({ control: form.control, name: 'variants' })
  const multiple = features.variantsMatrix || variants.fields.length > 1

  return (
    <Section title={multiple ? t('product.variantsTitle') : t('product.pricing')}>
      {features.variantsMatrix && (
        <AttributeMatrix
          attributes={attributes}
          onBuild={(combos) => {
            const current = form.getValues('variants')
            const hasLabels = current.some((variant) => variant.label)
            const kept = hasLabels ? current : []
            const known = new Set(kept.map((variant) => variant.label))
            variants.replace([
              ...kept,
              ...combos.filter(({ label }) => !known.has(label)).map(({ label, valueIds }) => emptyVariant(label, valueIds)),
            ])
          }}
        />
      )}

      {variants.fields.map((field, index) => (
        <VariantEditor
          key={field.id}
          form={form}
          index={index}
          references={references}
          showLabel={multiple}
          onRemove={variants.fields.length > 1 ? () => variants.remove(index) : undefined}
        />
      ))}

      {features.variantsMatrix && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => variants.append(emptyVariant())}>
            <Plus aria-hidden className="size-4" />
            {t('product.addVariant')}
          </Button>
        </div>
      )}
    </Section>
  )
}

function ProductEditor({
  product,
  references,
  attributes,
  features,
}: {
  product: Product | null
  references: References
  attributes: Attribute[]
  features: Features
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const saved = useRef(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onTouched',
    defaultValues: toValues(product, features),
  })
  const report = useReportError(form, mapFieldPath)
  const { isDirty } = form.formState

  const submit = form.handleSubmit(async (values) => {
    const body = toBody(values)
    const request = product
      ? api(productSchema, 'PUT', `/products/${product.id}`, { body })
      : api(productSchema, 'POST', '/products', { body })

    await request
      .then(async () => {
        toast.success(t('product.saved'))
        await queryClient.invalidateQueries({ queryKey: ['products'] })
        saved.current = true
        await navigate({ to: '/products' })
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex max-w-4xl flex-col gap-6">
      <UnsavedGuard when={() => isDirty && !saved.current} />
      <BasicsSection form={form} references={references} features={features} />
      <UnitsSection form={form} units={references.units} />
      <PricingSection form={form} references={references} attributes={attributes} features={features} />
      <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 bg-ground px-1 py-3">
        <Button variant="ghost" onClick={() => void navigate({ to: '/products' })}>
          {t('common.cancel')}
        </Button>
        <SubmitButton form={form} size="lg">
          {t('product.save')}
        </SubmitButton>
      </div>
    </form>
  )
}

export function ProductFormPage() {
  const { t } = useTranslation()
  const { id } = useParams({ strict: false })

  const product = useQuery({
    queryKey: ['products', 'detail', id],
    queryFn: () => api(productSchema, 'GET', `/products/${id}`),
    enabled: Boolean(id),
    gcTime: 0,
  })
  const units = useQuery(referenceQuery('units'))
  const categories = useQuery(referenceQuery('categories'))
  const brands = useQuery(referenceQuery('brands'))
  const taxRates = useQuery(referenceQuery('tax-rates'))
  const priceLists = useQuery(referenceQuery('price-lists'))
  const attributes = useQuery(attributesQuery)
  const settings = useQuery(settingsQuery)

  const queries = [units, categories, brands, taxRates, priceLists, attributes, settings, ...(id ? [product] : [])]
  const failed = queries.find((query) => query.isError)
  const ready = queries.every((query) => query.data !== undefined)

  return (
    <div className="flex flex-col gap-6">
      <Sign title={product.data?.name ?? t('product.newTitle')} secondary={t('nav.products.label')} />
      {failed ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : !ready ? (
        <FormSkeleton fields={6} />
      ) : (
        <ProductEditor
          key={id ?? 'new'}
          product={product.data ?? null}
          attributes={attributes.data!.items}
          features={settings.data!.features}
          references={{
            units: units.data!.items,
            categories: categories.data!.items,
            brands: brands.data!.items,
            taxRates: taxRates.data!.items,
            priceLists: priceLists.data!.items,
          }}
        />
      )}
    </div>
  )
}

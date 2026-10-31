import { productLabelsSchema, type ProductLabel, type ProductRow } from '@inv/contracts'
import { Button, Dialog, Field, Input, Select, Skeleton } from '@inv/ui'
import { useQuery } from '@tanstack/react-query'
import JsBarcode from 'jsbarcode'
import { Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'

const MAX_COPIES = 500

type Paper = 'roll' | 'sheet'

const PAGE_RULES: Record<Paper, string> = {
  roll: '@page { size: 38mm 25mm; margin: 0; }',
  sheet: '@page { size: A4; margin: 8mm; }',
}

function BarcodeImage({ code }: { code: string }) {
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svg.current) return
    JsBarcode(svg.current, code, {
      format: /^\d{13}$/.test(code) ? 'EAN13' : 'CODE128',
      height: 34,
      width: 1.3,
      fontSize: 11,
      margin: 0,
      flat: true,
    })
  }, [code])

  return <svg ref={svg} className="h-auto max-w-full" />
}

function Label({ label, showPrice }: { label: ProductLabel; showPrice: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const name = label.variantLabel ? `${label.productName} - ${label.variantLabel}` : label.productName

  return (
    <div className="print-label flex h-[25mm] w-[38mm] flex-col items-center justify-center gap-0.5 overflow-hidden bg-white p-[1mm] text-center text-black">
      <p className="w-full truncate text-[8pt] leading-tight font-medium">{name}</p>
      <BarcodeImage code={label.barcode} />
      {showPrice && label.priceMinor !== null && (
        <p className="tabular text-[9pt] leading-tight font-semibold">
          {format.money(label.priceMinor)} {t('labels.currency')}
        </p>
      )}
    </div>
  )
}

/** Rendered beside the app and shown only by the print stylesheet below. */
function PrintSheet({
  labels,
  copies,
  paper,
  showPrice,
}: {
  labels: ProductLabel[]
  copies: number
  paper: Paper
  showPrice: boolean
}) {
  const repeated = labels.flatMap((label) => Array.from({ length: copies }, () => label))

  return createPortal(
    <div data-testid="print-sheet" className="print-sheet" data-paper={paper}>
      <style>{`
        .print-sheet { display: none; }
        @media print {
          ${PAGE_RULES[paper]}
          html, body { background: white; min-height: 0; }
          body > *:not(.print-sheet) { display: none !important; }
          .print-sheet { display: block; }
          .print-sheet[data-paper='sheet'] { display: grid; grid-template-columns: repeat(5, 38mm); gap: 2mm; }
          .print-sheet[data-paper='roll'] .print-label { break-after: page; }
          .print-label { break-inside: avoid; }
        }
      `}</style>
      {repeated.map((label, index) => (
        <Label key={`${label.variantId}-${index}`} label={label} showPrice={showPrice} />
      ))}
    </div>,
    document.body,
  )
}

export function LabelsDialog({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const { t } = useTranslation()
  const [copies, setCopies] = useState('1')
  const [paper, setPaper] = useState<Paper>('roll')
  const [showPrice, setShowPrice] = useState(true)

  const query = useQuery({
    queryKey: ['products', 'labels', product.id],
    queryFn: () => api(productLabelsSchema, 'GET', `/products/${product.id}/labels`),
  })

  const count = Math.min(Math.max(Number.parseInt(copies, 10) || 1, 1), MAX_COPIES)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('labels.title', { name: product.name })}
      closeLabel={t('common.close')}
    >
      <QueryBoundary
        query={query}
        skeleton={<Skeleton className="h-40 w-full" />}
        isEmpty={(data) => data.items.length === 0}
        empty={<p className="text-ink-soft">{t('labels.noBarcode')}</p>}
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <div className="flex justify-center rounded-md border border-rule bg-sunken p-3">
              <div className="border border-rule-strong">
                <Label label={data.items[0]!} showPrice={showPrice} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field id="label-copies" label={t('labels.copies')}>
                <Input
                  id="label-copies"
                  type="number"
                  dir="ltr"
                  min={1}
                  max={MAX_COPIES}
                  value={copies}
                  onChange={(event) => setCopies(event.target.value)}
                />
              </Field>
              <Field id="label-paper" label={t('labels.paper')}>
                <Select id="label-paper" value={paper} onChange={(event) => setPaper(event.target.value as Paper)}>
                  <option value="roll">{t('labels.roll')}</option>
                  <option value="sheet">{t('labels.sheet')}</option>
                </Select>
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(event) => setShowPrice(event.target.checked)}
                className="size-4 accent-route"
              />
              {t('labels.showPrice')}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => window.print()}>
                <Printer aria-hidden className="size-4" />
                {t('labels.print')}
              </Button>
            </div>
            <PrintSheet labels={data.items} copies={count} paper={paper} showPrice={showPrice} />
          </div>
        )}
      </QueryBoundary>
    </Dialog>
  )
}

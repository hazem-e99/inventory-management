import { posLookupSchema, type PosItem, type Reference, type Sale } from '@inv/contracts'
import { moneyToText, parseMoney, parseQuantity, priceSale, quantityToText } from '@inv/domain'
import { Badge, Button, Input, Select, Skeleton, cn } from '@inv/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Printer, ScanBarcode, Trash2, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { useActor, useCan } from '../../lib/session'
import { referenceQuery, useReferenceName } from '../catalog/queries'
import { cartActions, unitPriceOf, useCart, type Cart, type CartLine } from './cart-store'
import { CustomerPickDialog, HeldDialog, HoldDialog, PaymentDialog, heldQuery } from './pos-dialogs'
import { licenseQuery } from '../license/queries'
import { currentShiftQuery } from './queries'
import { usePrinter } from './receipt'
import { CashDialog, OpenShiftForm } from './shift-panels'

type Panel = 'pay' | 'hold' | 'held' | 'customer' | 'cash' | null

const amountsOf = (line: CartLine) => ({
  qtyMilli: line.qtyMilli,
  unitPriceMinor: line.unitPriceMinor,
  discountMinor: line.discountMinor,
  taxRateBp: line.item.taxRateBp,
})

/** `3*6221234567890` sells three: the way every cashier already works on a till. */
function splitMultiplier(text: string): { code: string; multiplierMilli: number } {
  const match = /^([\d.]+)\*(.+)$/.exec(text)
  const multiplierMilli = match ? parseQuantity(match[1]!) : null
  return match && multiplierMilli ? { code: match[2]!, multiplierMilli } : { code: text, multiplierMilli: 1000 }
}

function Key({ name, label }: { name: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <kbd dir="ltr" className="rounded border border-rule-strong bg-surface px-1.5 font-sans text-xs font-medium text-ink">
        {name}
      </kbd>
      {label}
    </span>
  )
}

function NumberCell({
  label,
  value,
  disabled,
  onCommit,
  parse,
  format,
}: {
  label: string
  value: number
  disabled?: boolean
  onCommit: (value: number) => void
  parse: (text: string) => number | null
  format: (value: number) => string
}) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <Input
      dir="ltr"
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      className="h-9 px-2"
      value={draft ?? format(value)}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = draft === null ? null : parse(draft)
        if (parsed !== null) onCommit(parsed)
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

function CartRow({
  line,
  selected,
  units,
  canPrice,
  canDiscount,
}: {
  line: CartLine
  selected: boolean
  units: Reference[]
  canPrice: boolean
  canDiscount: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const unitName = useReferenceName('units')
  const row = useRef<HTMLTableRowElement>(null)
  const { item } = line
  const total = priceSale([amountsOf(line)], 0).totals.totalMinor
  const unitIds = [item.baseUnitId, ...item.units.map(({ unitId }) => unitId)]

  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const usableLots = item.lots.filter((lot) => lot.availableMilli > 0)

  return (
    <>
      <tr
        ref={row}
        aria-selected={selected}
        onClick={() => cartActions.select(line.key)}
        className={cn('border-b border-rule', selected ? 'bg-route/8' : 'hover:bg-ground')}
      >
        <td className="min-w-48 px-3 py-2">
          <p className="font-medium text-ink">
            {item.productName}
            {item.variantLabel ? ` - ${item.variantLabel}` : ''}
          </p>
          <p className="flex items-center gap-2 text-sm text-ink-faint">
            <span className="tabular">{t('pos.available', { value: format.quantity(item.onHandMilli) })}</span>
            {item.prescriptionRequired && <Badge tone="warn">{t('pos.prescription')}</Badge>}
          </p>
        </td>
        <td className="w-24 px-1 py-2">
          <NumberCell
            label={t('pos.quantity')}
            value={line.qtyMilli}
            parse={(text) => {
              const parsed = parseQuantity(text)
              return parsed ? parsed : null
            }}
            format={quantityToText}
            onCommit={(qtyMilli) => cartActions.patch(line.key, { qtyMilli })}
          />
        </td>
        <td className="w-28 px-1 py-2">
          <Select
            aria-label={t('pos.unit')}
            className="h-9 px-2"
            disabled={item.scaleQtyMilli !== null}
            value={line.unitId}
            onChange={(event) => {
              const unitId = event.target.value
              cartActions.patch(line.key, { unitId, unitPriceMinor: unitPriceOf(item, unitId) })
            }}
          >
            {unitIds.map((id) => {
              const unit = units.find((row) => row.id === id)
              return (
                <option key={id} value={id}>
                  {unit ? unitName(unit) : id}
                </option>
              )
            })}
          </Select>
        </td>
        <td className="w-28 px-1 py-2">
          <NumberCell
            label={t('pos.price')}
            value={line.unitPriceMinor}
            disabled={!canPrice}
            parse={parseMoney}
            format={moneyToText}
            onCommit={(unitPriceMinor) => cartActions.patch(line.key, { unitPriceMinor })}
          />
        </td>
        <td className="w-24 px-1 py-2">
          <NumberCell
            label={t('pos.discount')}
            value={line.discountMinor}
            disabled={!canDiscount}
            parse={parseMoney}
            format={moneyToText}
            onCommit={(discountMinor) => cartActions.patch(line.key, { discountMinor })}
          />
        </td>
        <td className="tabular w-28 px-3 py-2 text-end text-lg font-semibold text-ink">{format.money(total)}</td>
        <td className="w-10 px-1 py-2">
          <Button
            variant="ghost"
            size="icon"
            tabIndex={-1}
            aria-label={t('pos.remove')}
            onClick={(event) => {
              event.stopPropagation()
              cartActions.remove(line.key)
            }}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </td>
      </tr>
      {(item.trackSerials || usableLots.length > 1) && (
        <tr className="border-b border-rule bg-sunken">
          <td colSpan={7} className="px-3 py-2">
            {item.trackSerials ? (
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                {t('pos.serials')}
                <textarea
                  dir="ltr"
                  rows={2}
                  className="w-full rounded-md border border-rule-strong bg-surface px-3 py-1.5 font-normal text-ink"
                  defaultValue={line.serials.join('\n')}
                  onBlur={(event) =>
                    cartActions.patch(line.key, {
                      serials: event.target.value
                        .split(/[\n,]+/)
                        .map((serial) => serial.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            ) : (
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                {t('pos.batch')}
                <Select
                  className="h-8 w-72 px-2"
                  value={line.lotId ?? ''}
                  onChange={(event) => cartActions.patch(line.key, { lotId: event.target.value || null })}
                >
                  <option value="">{t('pos.batchAuto')}</option>
                  {usableLots.map((lot) => (
                    <option key={lot.lotId} value={lot.lotId}>
                      {lot.lotNo} ({lot.expiryDate ?? '-'}) - {format.quantity(lot.availableMilli)}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function SummaryPlate({
  cart,
  lastSale,
  canDiscount,
  discountInput,
  onPay,
  onPrint,
}: {
  cart: Cart
  lastSale: Sale | null
  canDiscount: boolean
  discountInput: React.RefObject<HTMLInputElement | null>
  onPay: () => void
  onPrint: (sale: Sale) => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { totals } = priceSale(cart.lines.map(amountsOf), cart.discountMinor)
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <aside aria-label={t('pos.summary')} className="flex min-h-0 flex-col gap-4 bg-plate p-5 text-plate-ink">
      <div>
        <p className="text-plate-soft">{t('pos.due')}</p>
        <p data-testid="pos-total" className="tabular text-5xl leading-tight font-semibold">
          {format.money(totals.totalMinor)}
        </p>
      </div>

      <dl className="flex flex-col gap-1 text-plate-soft">
        <div className="flex justify-between">
          <dt>{t('pos.itemsCount')}</dt>
          <dd className="tabular">{format.number(cart.lines.length)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('pos.grossTotal')}</dt>
          <dd className="tabular">{format.money(totals.grossMinor)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('pos.includedTax')}</dt>
          <dd className="tabular">{format.money(totals.taxMinor)}</dd>
        </div>
      </dl>

      {canDiscount && (
        <label className="flex items-center justify-between gap-3 text-plate-soft">
          <span>{t('pos.invoiceDiscount')}</span>
          <Input
            ref={discountInput}
            dir="ltr"
            inputMode="decimal"
            className="h-9 w-28 px-2"
            value={draft ?? moneyToText(cart.discountMinor)}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const parsed = draft === null ? null : parseMoney(draft)
              if (parsed !== null) cartActions.setDiscount(parsed)
              setDraft(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>
      )}

      <Button size="lg" className="h-14 w-full text-xl" disabled={cart.lines.length === 0} onClick={onPay}>
        {t('pos.pay')} <span dir="ltr" className="text-base font-normal">F12</span>
      </Button>

      {lastSale && (
        <div className="mt-auto rounded-md border border-plate-rule p-3">
          <p className="text-sm text-plate-soft">{t('pos.lastSale')}</p>
          <div className="flex items-center justify-between gap-2">
            <Link to="/sales/$id" params={{ id: lastSale.id }} className="font-medium text-plate-ink hover:underline">
              <bdi dir="ltr">{lastSale.number}</bdi>
            </Link>
            <button
              type="button"
              onClick={() => onPrint(lastSale)}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-plate-ink hover:bg-plate-rule"
            >
              <Printer aria-hidden className="size-4" />
              {t('pos.reprint')}
            </button>
          </div>
          {lastSale.changeMinor > 0 && (
            <p className="flex justify-between pt-1">
              <span className="text-plate-soft">{t('pos.change')}</span>
              <span data-testid="pos-change" className="tabular text-xl font-semibold">
                {format.money(lastSale.changeMinor)}
              </span>
            </p>
          )}
        </div>
      )}
    </aside>
  )
}

function Till({ units, shiftNumber }: { units: Reference[]; shiftNumber: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const report = useReportError()
  const printer = usePrinter()
  const canPrice = useCan('sales.price')
  const canDiscount = useCan('sales.discount')
  const cart = useCart()
  const scan = useRef<HTMLInputElement>(null)
  const discountInput = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<PosItem[]>([])
  const [panel, setPanel] = useState<Panel>(null)
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const held = useQuery(heldQuery)

  const focusScan = useCallback(() => scan.current?.focus(), [])
  useEffect(focusScan, [focusScan])

  const closePanel = useCallback(() => {
    setPanel(null)
    requestAnimationFrame(focusScan)
  }, [focusScan])

  const add = useCallback((item: PosItem, multiplierMilli: number) => {
    cartActions.add(item, multiplierMilli)
    setText('')
    setMatches([])
  }, [])

  const lookup = async (raw: string) => {
    const { code, multiplierMilli } = splitMultiplier(raw.trim())
    if (!code) return
    try {
      const { items } = await api(posLookupSchema, 'GET', `/pos/lookup?search=${encodeURIComponent(code)}`)
      if (items.length === 1) add(items[0]!, multiplierMilli)
      else if (items.length === 0) toast.error(t('pos.noMatch', { text: code }))
      else setMatches(items)
    } catch (error) {
      report(error)
    }
  }

  const selected = useMemo(() => cart.lines.find((line) => line.key === cart.selected) ?? null, [cart.lines, cart.selected])

  const focusQuantity = () => {
    const input = list.current?.querySelector<HTMLInputElement>('tr[aria-selected="true"] input')
    input?.focus()
  }

  const paid = async (sale: Sale) => {
    setLastSale(sale)
    cartActions.clear()
    closePanel()
    toast.success(t('pos.done', { number: sale.number }))
    await Promise.all(['shifts', 'sales', 'stock', 'products', 'customers', 'held-sales'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    if (printer.autoPrint) await printer.printSale(sale)
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (panel !== null) return
      const actions: Record<string, () => void> = {
        F2: () => setPanel('customer'),
        F3: focusQuantity,
        F4: () => {
          if (cart.lines.length > 0) setPanel('hold')
        },
        F6: () => setPanel('held'),
        F7: () => setPanel('cash'),
        F9: () => discountInput.current?.focus(),
        F12: () => {
          if (cart.lines.length > 0) setPanel('pay')
        },
        Escape: focusScan,
      }
      const action = actions[event.key]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cart.lines.length, focusScan, panel])

  const onScanKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void lookup(text)
      return
    }
    if (text !== '') return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      cartActions.move(event.key === 'ArrowDown' ? 1 : -1)
    }
    if (!selected) return
    if (event.key === 'Delete') cartActions.remove(selected.key)
    if (event.key === '+' || event.key === '-') {
      event.preventDefault()
      const step = event.key === '+' ? 1000 : -1000
      const qtyMilli = selected.qtyMilli + step
      if (qtyMilli > 0) cartActions.patch(selected.key, { qtyMilli })
    }
  }

  const { totals } = priceSale(cart.lines.map(amountsOf), cart.discountMinor)

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem]">
      <section aria-label={t('nav.pos.label')} className="flex min-h-0 flex-col gap-3 p-4">
        <h1 className="sr-only">{t('nav.pos.label')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanBarcode aria-hidden className="absolute start-3 top-3.5 size-5 text-ink-faint" />
            <Input
              ref={scan}
              type="search"
              aria-label={t('pos.scan')}
              placeholder={t('pos.scan')}
              autoComplete="off"
              className="h-12 ps-11 text-lg"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setMatches([])
              }}
              onKeyDown={onScanKey}
            />
            {matches.length > 1 && (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-rule bg-surface shadow-[0_8px_24px_rgb(16_33_59/0.18)]">
                {matches.map((item) => (
                  <li key={item.variantId}>
                    <button
                      type="button"
                      onClick={() => {
                        add(item, splitMultiplier(text.trim()).multiplierMilli)
                        focusScan()
                      }}
                      className="flex w-full items-center justify-between gap-4 px-3 py-2 text-start hover:bg-sunken"
                    >
                      <span className="min-w-0 truncate font-medium text-ink">
                        {item.productName}
                        {item.variantLabel ? ` - ${item.variantLabel}` : ''}
                      </span>
                      <span className="tabular shrink-0 text-sm text-ink-soft">{moneyToText(unitPriceOf(item, item.unitId))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="secondary" className="h-12 max-w-56" onClick={() => setPanel('customer')}>
            <UserRound aria-hidden className="size-4" />
            <span className="truncate">{cart.customer?.name ?? t('pos.walkIn')}</span>
          </Button>
          <Button variant="secondary" className="h-12" disabled={cart.lines.length === 0} onClick={() => setPanel('hold')}>
            {t('pos.hold')}
          </Button>
          <Button variant="secondary" className="h-12" onClick={() => setPanel('held')}>
            {t('pos.heldList')} ({held.data?.items.length ?? 0})
          </Button>
        </div>

        <div ref={list} className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-rule bg-surface">
          {cart.lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
              <h2 className="text-lg font-semibold text-ink">{t('pos.emptyTitle')}</h2>
              <p className="max-w-prose text-ink-soft">{t('pos.emptyBody')}</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-sunken">
                <tr className="text-sm text-ink-soft">
                  <th className="px-3 py-2 text-start font-medium">{t('pos.item')}</th>
                  <th className="px-2 py-2 text-start font-medium">{t('pos.quantity')}</th>
                  <th className="px-2 py-2 text-start font-medium">{t('pos.unit')}</th>
                  <th className="px-2 py-2 text-start font-medium">{t('pos.price')}</th>
                  <th className="px-2 py-2 text-start font-medium">{t('pos.discount')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('pos.total')}</th>
                  <th aria-label={t('pos.remove')} />
                </tr>
              </thead>
              <tbody>
                {cart.lines.map((line) => (
                  <CartRow
                    key={line.key}
                    line={line}
                    selected={line.key === cart.selected}
                    units={units}
                    canPrice={canPrice}
                    canDiscount={canDiscount}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer aria-label={t('pos.keys')} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span className="font-medium text-ink">{t('pos.shiftOf', { number: shiftNumber })}</span>
          <Key name="F2" label={t('pos.keyCustomer')} />
          <Key name="F3" label={t('pos.keyQuantity')} />
          <Key name="F4" label={t('pos.keyHold')} />
          <Key name="F6" label={t('pos.keyHeld')} />
          <Key name="F7" label={t('pos.keyCash')} />
          {canDiscount && <Key name="F9" label={t('pos.keyDiscount')} />}
          <Key name="↑↓" label={t('pos.keyLines')} />
          <Key name="+ -" label={t('pos.keyAmount')} />
          <Key name="Del" label={t('pos.keyRemove')} />
        </footer>
      </section>

      <SummaryPlate
        cart={cart}
        lastSale={lastSale}
        canDiscount={canDiscount}
        discountInput={discountInput}
        onPay={() => setPanel('pay')}
        onPrint={(sale) => void printer.printSale(sale)}
      />

      {panel === 'pay' && <PaymentDialog cart={cart} totalMinor={totals.totalMinor} onClose={closePanel} onPaid={(sale) => void paid(sale)} />}
      {panel === 'hold' && <HoldDialog cart={cart} onClose={closePanel} />}
      {panel === 'held' && <HeldDialog cartHasLines={cart.lines.length > 0} onClose={closePanel} />}
      {panel === 'customer' && <CustomerPickDialog selected={cart.customer !== null} onClose={closePanel} />}
      {panel === 'cash' && <CashDialog onClose={closePanel} />}
      {printer.sheet}
    </div>
  )
}

export function PosPage() {
  const { t } = useTranslation()
  const actor = useActor()
  const shift = useQuery(currentShiftQuery)
  const units = useQuery(referenceQuery('units'))
  const license = useQuery(licenseQuery)

  if (license.data?.status === 'read_only') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-semibold text-ink">{t('license.readOnlyTitle')}</h2>
        <p className="max-w-prose text-ink-soft">{t('license.readOnlyBody')}</p>
      </div>
    )
  }

  const failed = shift.error ?? units.error
  if (failed) {
    return (
      <div className="p-8">
        <ErrorState error={failed} onRetry={() => void shift.refetch()} />
      </div>
    )
  }
  if (!shift.data || !units.data) {
    return (
      <div className="p-8">
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const current = shift.data.shift
  if (!current) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <h1 className="sr-only">{t('nav.pos.label')}</h1>
        <OpenShiftForm />
      </div>
    )
  }
  if (current.userId !== actor.id) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-semibold text-ink">{t('pos.otherShift', { name: current.userName })}</h2>
        <p className="max-w-prose text-ink-soft">{t('pos.otherShiftBody')}</p>
        <Link to="/shifts" className="mt-2">
          <Button tabIndex={-1}>{t('pos.goToShifts')}</Button>
        </Link>
      </div>
    )
  }

  return <Till units={units.data.items} shiftNumber={current.number} />
}

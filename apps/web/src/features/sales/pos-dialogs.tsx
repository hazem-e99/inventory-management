import {
  TENDER_METHODS,
  checkoutSchema,
  heldListSchema,
  heldSaleSchema,
  okSchema,
  saleSchema,
  type Customer,
  type HeldSale,
  type Sale,
  type TenderMethod,
} from '@inv/contracts'
import { moneyToText, parseMoney, settle } from '@inv/domain'
import { Button, Dialog, Field, Input } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { cartActions, type Cart } from './cart-store'
import { CustomerDialog } from './customer-dialog'
import { customerSearchQuery, useCustomerBalanceLabel } from './queries'

const SEARCH_DELAY_MS = 150

// Each method has a key that puts the whole amount on it, so one tender never needs the mouse.
const METHOD_KEYS: Record<string, TenderMethod> = { F5: 'cash', F6: 'card', F7: 'wallet', F8: 'credit' }

type Amounts = Record<TenderMethod, string>

function checkoutBody(cart: Cart, amounts: Amounts) {
  return checkoutSchema.parse({
    requestId: cart.requestId,
    customerId: cart.customer?.id ?? null,
    discountMinor: cart.discountMinor,
    heldId: cart.heldId,
    lines: cart.lines.map((line) => ({
      variantId: line.item.variantId,
      unitId: line.unitId,
      qtyMilli: line.qtyMilli,
      unitPriceMinor: line.unitPriceMinor,
      discountMinor: line.discountMinor,
      lotId: line.lotId,
      serials: line.serials,
    })),
    tenders: TENDER_METHODS.flatMap((method) => {
      const amountMinor = parseMoney(amounts[method]) ?? 0
      return amountMinor > 0 ? [{ method, amountMinor }] : []
    }),
  })
}

export function PaymentDialog({
  cart,
  totalMinor,
  onClose,
  onPaid,
}: {
  cart: Cart
  totalMinor: number
  onClose: () => void
  onPaid: (sale: Sale) => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const baseId = useId()
  const report = useReportError()
  const [amounts, setAmounts] = useState<Amounts>({ cash: moneyToText(totalMinor), card: '', wallet: '', credit: '' })

  const tenders = TENDER_METHODS.map((method) => ({ method, amountMinor: parseMoney(amounts[method]) ?? 0 }))
  const paid = tenders.reduce((sum, { amountMinor }) => sum + amountMinor, 0)
  const settlement = settle(totalMinor, tenders)

  const pay = useMutation({
    mutationFn: () => api(saleSchema, 'POST', '/sales', { body: checkoutBody(cart, amounts) }),
    onSuccess: onPaid,
    onError: report,
  })

  const putAllOn = (method: TenderMethod) => {
    if (method === 'credit' && !cart.customer) return
    setAmounts({ cash: '', card: '', wallet: '', credit: '', [method]: moneyToText(totalMinor) })
  }

  const submit = () => {
    if (settlement.ok && !pay.isPending) pay.mutate()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const method = METHOD_KEYS[event.key]
    if (method) {
      event.preventDefault()
      putAllOn(method)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('pos.paying')}
      description={t('pos.payBody')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
        <div className="flex items-baseline justify-between rounded-md bg-plate px-4 py-3 text-plate-ink">
          <span>{t('pos.due')}</span>
          <span className="tabular text-3xl font-semibold">{format.money(totalMinor)}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {TENDER_METHODS.map((method, index) => {
            const key = Object.keys(METHOD_KEYS)[index]!
            const id = `${baseId}-${method}`
            const disabled = method === 'credit' && !cart.customer
            return (
              <Field key={method} id={id} label={`${t(`pos.methods.${method}`)} (${key})`}>
                <Input
                  id={id}
                  dir="ltr"
                  inputMode="decimal"
                  autoFocus={method === 'cash'}
                  onFocus={(event) => event.target.select()}
                  disabled={disabled}
                  value={amounts[method]}
                  onChange={(event) => setAmounts((current) => ({ ...current, [method]: event.target.value }))}
                />
              </Field>
            )
          })}
        </div>

        <dl className="flex flex-col gap-1 border-t border-rule pt-3">
          <div className="flex justify-between text-ink-soft">
            <dt>{t('pos.paid')}</dt>
            <dd className="tabular">{format.money(paid)}</dd>
          </div>
          {settlement.ok ? (
            <div className="flex justify-between text-lg font-semibold text-ink">
              <dt>{t('pos.change')}</dt>
              <dd className="tabular">{format.money(settlement.changeMinor)}</dd>
            </div>
          ) : (
            <div className="flex justify-between text-lg font-semibold text-danger">
              <dt>{t('pos.left')}</dt>
              <dd className="tabular">{format.money(Math.abs(totalMinor - paid))}</dd>
            </div>
          )}
        </dl>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="lg" disabled={!settlement.ok} loading={pay.isPending} onClick={submit}>
            {t('pos.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function HoldDialog({ cart, onClose }: { cart: Cart; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const report = useReportError()
  const id = useId()
  const [label, setLabel] = useState('')

  const hold = useMutation({
    mutationFn: () =>
      api(heldSaleSchema, 'POST', '/held-sales', {
        body: {
          label,
          customer: cart.customer,
          discountMinor: cart.discountMinor,
          lines: cart.lines.map(({ key: _key, ...line }) => line),
        },
      }),
    onSuccess: async () => {
      if (cart.heldId) await api(okSchema, 'DELETE', `/held-sales/${cart.heldId}`)
      toast.success(t('pos.held'))
      cartActions.clear()
      await queryClient.invalidateQueries({ queryKey: ['held-sales'] })
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
      title={t('pos.hold')}
      closeLabel={t('common.close')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          hold.mutate()
        }}
      >
        <Field id={id} label={`${t('pos.holdLabel')} (${t('common.optional')})`}>
          <Input id={id} autoFocus value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={hold.isPending}>
            {t('pos.hold')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export const heldQuery = {
  queryKey: ['held-sales'],
  queryFn: () => api(heldListSchema, 'GET', '/held-sales'),
}

export function HeldDialog({ cartHasLines, onClose }: { cartHasLines: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const held = useQuery(heldQuery)

  const drop = useMutation({
    mutationFn: (id: string) => api(okSchema, 'DELETE', `/held-sales/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['held-sales'] }),
    onError: report,
  })

  const resume = (sale: HeldSale) => {
    if (cartHasLines) {
      toast.error(t('pos.cartNotEmpty'))
      return
    }
    cartActions.load(sale)
    onClose()
  }

  const items = held.data?.items ?? []

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('pos.heldTitle')}
      closeLabel={t('common.close')}
    >
      {items.length === 0 ? (
        <p className="text-ink-soft">{t('pos.heldEmpty')}</p>
      ) : (
        <ul className="flex max-h-96 flex-col overflow-y-auto">
          {items.map((sale) => (
            <li key={sale.id} className="flex items-center justify-between gap-3 border-b border-rule py-2 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{sale.label ?? sale.customer?.name ?? format.dateTime(sale.createdAt)}</p>
                <p className="tabular text-sm text-ink-soft">
                  {format.money(sale.totalMinor)} · {format.number(sale.lines.length)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" aria-label={t('pos.dropHeld')} onClick={() => drop.mutate(sale.id)}>
                  <Trash2 aria-hidden className="size-4" />
                </Button>
                <Button size="sm" onClick={() => resume(sale)}>
                  {t('pos.resume')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

export function CustomerPickDialog({ selected, onClose }: { selected: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const balanceLabel = useCustomerBalanceLabel()
  const searchId = useId()
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [index, setIndex] = useState(0)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const results = useQuery({ ...customerSearchQuery(search), enabled: search.length > 0 })
  const items = useMemo(() => results.data?.items.filter((row) => !row.archived) ?? [], [results.data])

  const choose = (customer: Pick<Customer, 'id' | 'name'>) => {
    cartActions.setCustomer({ id: customer.id, name: customer.name })
    onClose()
  }

  if (adding) {
    return <CustomerDialog customer={null} initialName={text} onClose={() => setAdding(false)} onSaved={choose} />
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') setIndex((current) => Math.min(current + 1, items.length - 1))
    if (event.key === 'ArrowUp') setIndex((current) => Math.max(current - 1, 0))
    if (event.key === 'Enter') {
      event.preventDefault()
      const customer = items[index]
      if (customer) choose(customer)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('pos.customerTitle')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-3">
        <Field id={searchId} label={t('pos.customerSearch')}>
          <Input
            id={searchId}
            type="search"
            autoFocus
            autoComplete="off"
            value={text}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              setText(event.target.value)
              setIndex(0)
            }}
          />
        </Field>

        {items.length > 0 && (
          <ul className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-rule">
            {items.map((customer, position) => (
              <li key={customer.id}>
                <button
                  type="button"
                  aria-current={position === index ? 'true' : undefined}
                  onClick={() => choose(customer)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-sunken ${position === index ? 'bg-sunken' : ''}`}
                >
                  <span className="min-w-0 truncate font-medium text-ink">{customer.name}</span>
                  <span className="tabular shrink-0 text-sm text-ink-soft">
                    {customer.balanceMinor !== 0 && `${balanceLabel(customer.balanceMinor)}: ${format.money(Math.abs(customer.balanceMinor))}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-between gap-2">
          {selected ? (
            <Button
              variant="ghost"
              onClick={() => {
                cartActions.setCustomer(null)
                onClose()
              }}
            >
              {t('pos.customerClear')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('pos.customerNew')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

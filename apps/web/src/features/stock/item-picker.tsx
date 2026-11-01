import { stockPickListSchema, type StockPickRow } from '@inv/contracts'
import { Input } from '@inv/ui'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useFormat } from '../../lib/format'

const SEARCH_DELAY_MS = 150

export function ItemPicker({ warehouseId, onPick }: { warehouseId: string; onPick: (row: StockPickRow) => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const results = useQuery({
    queryKey: ['stock', 'pick', warehouseId, search],
    queryFn: () =>
      api(stockPickListSchema, 'GET', `/stock/pick?warehouseId=${warehouseId}&search=${encodeURIComponent(search)}`),
    enabled: search.length > 0,
  })

  const choose = (row: StockPickRow) => {
    onPick(row)
    setText('')
    setSearch('')
    input.current?.focus()
  }

  const items = results.data?.items ?? []

  /** A scanner types the code and presses Enter, which must add the item without a click. */
  const submitTyped = async () => {
    const typed = text.trim()
    if (!typed) return
    const found = await api(
      stockPickListSchema,
      'GET',
      `/stock/pick?warehouseId=${warehouseId}&search=${encodeURIComponent(typed)}`,
    )
    if (found.items.length === 1) choose(found.items[0]!)
    else setSearch(typed)
  }

  return (
    <div className="relative">
      <Search aria-hidden className="absolute start-3 top-3 size-4 text-ink-faint" />
      <Input
        ref={input}
        type="search"
        aria-label={t('stock.pick')}
        placeholder={t('stock.pick')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          void submitTyped()
        }}
        className="ps-9"
        autoComplete="off"
      />
      {search && text && results.data && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-rule bg-surface shadow-[0_8px_24px_rgb(16_33_59/0.18)]">
          {items.length === 0 ? (
            <li className="px-3 py-2 text-ink-soft">{t('stock.noPick')}</li>
          ) : (
            items.map((row) => (
              <li key={row.variantId}>
                <button
                  type="button"
                  onClick={() => choose(row)}
                  className="flex w-full items-center justify-between gap-4 px-3 py-2 text-start hover:bg-sunken"
                >
                  <span className="min-w-0 truncate font-medium text-ink">
                    {row.productName}
                    {row.variantLabel ? ` - ${row.variantLabel}` : ''}
                  </span>
                  <span className="tabular shrink-0 text-sm text-ink-soft">
                    {t('stock.onHand', { value: format.quantity(row.onHandMilli) })}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

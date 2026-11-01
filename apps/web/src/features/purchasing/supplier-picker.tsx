import type { Supplier } from '@inv/contracts'
import { Button, Field, Input } from '@inv/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supplierSearchQuery } from './queries'

const SEARCH_DELAY_MS = 150

export interface PickedSupplier {
  id: string
  name: string
}

/** Searches rather than listing, because a long-running shop can outgrow any dropdown. */
export function SupplierPicker({
  value,
  onChange,
  error,
  disabled,
}: {
  value: PickedSupplier | null
  onChange: (supplier: PickedSupplier | null) => void
  error?: string | undefined
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const results = useQuery({ ...supplierSearchQuery(search), enabled: search.length > 0 })
  const usable = results.data?.items.filter((row) => !row.archived) ?? []

  const choose = (supplier: Supplier) => {
    onChange({ id: supplier.id, name: supplier.name })
    setText('')
    setSearch('')
  }

  if (value) {
    return (
      <Field id={id} label={t('purchases.supplier')} error={error}>
        <div className="relative">
          <Input id={id} readOnly value={value.name} className="bg-sunken pe-20 font-medium" />
          {!disabled && (
            <Button variant="ghost" size="sm" className="absolute end-1 top-1" onClick={() => onChange(null)}>
              {t('purchases.change')}
            </Button>
          )}
        </div>
      </Field>
    )
  }

  return (
    <Field id={id} label={t('purchases.supplier')} error={error}>
      <div className="relative">
        <Input
          id={id}
          type="search"
          placeholder={t('purchases.chooseSupplier')}
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (usable.length === 1) choose(usable[0]!)
          }}
          autoComplete="off"
        />
        {search && text && results.data && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-rule bg-surface shadow-[0_8px_24px_rgb(16_33_59/0.18)]">
            {usable.length === 0 ? (
              <li className="px-3 py-2 text-ink-soft">{t('suppliers.noMatch')}</li>
            ) : (
              usable.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => choose(row)}
                    className="flex w-full items-center justify-between gap-4 px-3 py-2 text-start hover:bg-sunken"
                  >
                    <span className="min-w-0 truncate font-medium text-ink">{row.name}</span>
                    {row.phone && (
                      <bdi dir="ltr" className="tabular shrink-0 text-sm text-ink-soft">
                        {row.phone}
                      </bdi>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Field>
  )
}

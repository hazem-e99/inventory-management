import { attributeValueSchema, type Attribute } from '@inv/contracts'
import { Button, cn, Input } from '@inv/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { attributesQuery } from './queries'

export interface VariantCombo {
  label: string
  valueIds: string[]
}

/** Every combination of the chosen values, in the order the attributes are listed. */
function combine(groups: Array<Array<{ id: string; value: string }>>): VariantCombo[] {
  return groups.reduce<VariantCombo[]>(
    (combos, group) =>
      combos.flatMap((combo) =>
        group.map(({ id, value }) => ({
          label: combo.label ? `${combo.label} / ${value}` : value,
          valueIds: [...combo.valueIds, id],
        })),
      ),
    [{ label: '', valueIds: [] }],
  )
}

function AddValue({ attribute }: { attribute: Attribute }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const report = useReportError()
  const [value, setValue] = useState('')

  const add = useMutation({
    mutationFn: () =>
      api(attributeValueSchema, 'POST', `/catalog/attributes/${attribute.id}/values`, { body: { value } }),
    onSuccess: () => {
      setValue('')
      return queryClient.invalidateQueries({ queryKey: attributesQuery.queryKey })
    },
    onError: report,
  })

  return (
    <span className="inline-flex items-center gap-1">
      <Input
        aria-label={t('product.newValue')}
        placeholder={t('product.newValue')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (value.trim()) add.mutate()
        }}
        className="h-8 w-32"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('product.addValue')}
        disabled={!value.trim()}
        loading={add.isPending}
        onClick={() => add.mutate()}
      >
        {!add.isPending && <Plus aria-hidden className="size-4" />}
      </Button>
    </span>
  )
}

export function AttributeMatrix({
  attributes,
  onBuild,
}: {
  attributes: Attribute[]
  onBuild: (combos: VariantCombo[]) => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
  }

  const groups = attributes
    .map((attribute) => attribute.values.filter((value) => selected.has(value.id)))
    .filter((values) => values.length > 0)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-surface p-4">
      <p className="text-ink-soft">{t('product.matrixBody')}</p>
      {attributes.map((attribute) => (
        <div key={attribute.id} className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">
            {attribute.isSystem
              ? (t as (key: string) => string)(`reference.attributes.${attribute.name}`)
              : attribute.name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {attribute.values.map((value) => (
              <button
                key={value.id}
                type="button"
                aria-pressed={selected.has(value.id)}
                onClick={() => toggle(value.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors duration-150',
                  selected.has(value.id)
                    ? 'border-route bg-route text-route-ink'
                    : 'border-rule-strong bg-surface text-ink hover:bg-sunken',
                )}
              >
                {value.value}
              </button>
            ))}
            <AddValue attribute={attribute} />
          </div>
        </div>
      ))}
      <div>
        <Button variant="secondary" size="sm" disabled={groups.length === 0} onClick={() => onBuild(combine(groups))}>
          {t('product.buildVariants')}
        </Button>
      </div>
    </div>
  )
}

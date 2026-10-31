import {
  attributesListSchema,
  referenceListSchema,
  type Reference,
  type ReferenceKind,
} from '@inv/contracts'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'

export const referenceQuery = (kind: ReferenceKind) => ({
  queryKey: ['catalog', kind],
  queryFn: () => api(referenceListSchema, 'GET', `/catalog/${kind}`),
  staleTime: 5 * 60_000,
})

export const attributesQuery = {
  queryKey: ['catalog', 'attributes'],
  queryFn: () => api(attributesListSchema, 'GET', '/catalog/attributes'),
}

const SYSTEM_GROUP: Partial<Record<ReferenceKind, string>> = {
  units: 'units',
  'tax-rates': 'taxes',
  'price-lists': 'priceLists',
}

/** Built-in rows store an id, so their display name comes from the translations. */
export function useReferenceName(kind: ReferenceKind) {
  const { t } = useTranslation()
  return useCallback(
    (row: Pick<Reference, 'name' | 'isSystem'>): string => {
      const group = SYSTEM_GROUP[kind]
      return row.isSystem && group ? (t as (key: string) => string)(`reference.${group}.${row.name}`) : row.name
    },
    [kind, t],
  )
}

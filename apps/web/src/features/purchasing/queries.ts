import { supplierPageSchema, supplierSchema, type OrderStatus, type PurchaseStatus } from '@inv/contracts'
import type { Badge } from '@inv/ui'
import type { ComponentProps } from 'react'
import { api } from '../../lib/api'

type Tone = ComponentProps<typeof Badge>['tone']

export const PURCHASE_STATUS_TONE: Record<PurchaseStatus, Tone> = {
  draft: 'warn',
  posted: 'ok',
  voided: 'neutral',
}

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: 'warn',
  open: 'ok',
  partial: 'warn',
  received: 'ok',
  cancelled: 'neutral',
}

export const supplierQuery = (id: string) => ({
  queryKey: ['suppliers', id],
  queryFn: () => api(supplierSchema, 'GET', `/suppliers/${id}`),
})

export const supplierSearchQuery = (search: string) => ({
  queryKey: ['suppliers', 'search', search],
  queryFn: () => api(supplierPageSchema, 'GET', `/suppliers?limit=20&search=${encodeURIComponent(search)}`),
})

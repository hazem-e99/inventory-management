import {
  currentShiftSchema,
  customerPageSchema,
  customerSchema,
  shiftSummarySchema,
  type SaleStatus,
} from '@inv/contracts'
import type { Badge } from '@inv/ui'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'

export const SALE_STATUS_TONE: Record<SaleStatus, ComponentProps<typeof Badge>['tone']> = {
  posted: 'ok',
  voided: 'neutral',
}

export const currentShiftQuery = {
  queryKey: ['shifts', 'current'],
  queryFn: () => api(currentShiftSchema, 'GET', '/shifts/current'),
}

export const shiftQuery = (id: string) => ({
  queryKey: ['shifts', id],
  queryFn: () => api(shiftSummarySchema, 'GET', `/shifts/${id}`),
})

export const customerQuery = (id: string) => ({
  queryKey: ['customers', id],
  queryFn: () => api(customerSchema, 'GET', `/customers/${id}`),
})

export const customerSearchQuery = (search: string) => ({
  queryKey: ['customers', 'search', search],
  queryFn: () => api(customerPageSchema, 'GET', `/customers?limit=20&search=${encodeURIComponent(search)}`),
})

export function useCustomerBalanceLabel() {
  const { t } = useTranslation()
  return (balanceMinor: number): string =>
    t(balanceMinor > 0 ? 'customers.owes' : balanceMinor < 0 ? 'customers.credit' : 'customers.settled')
}

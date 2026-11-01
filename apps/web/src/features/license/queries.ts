import { licenseInfoSchema } from '@inv/contracts'
import { api } from '../../lib/api'

export const licenseQuery = {
  queryKey: ['license'],
  queryFn: () => api(licenseInfoSchema, 'GET', '/license'),
  staleTime: 60_000,
  refetchInterval: 15 * 60_000,
}

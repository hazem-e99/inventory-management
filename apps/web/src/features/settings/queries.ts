import { settingsSchema } from '@inv/contracts'
import { api } from '../../lib/api'

export const settingsQuery = {
  queryKey: ['settings'],
  queryFn: () => api(settingsSchema, 'GET', '/settings'),
}

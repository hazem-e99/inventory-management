import { backupsListSchema } from '@inv/contracts'
import { api } from '../../lib/api'

export const backupsQuery = {
  queryKey: ['backups'],
  queryFn: () => api(backupsListSchema, 'GET', '/backups'),
}

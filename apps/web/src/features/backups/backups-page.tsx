import { backupSchema } from '@inv/contracts'
import { Badge, Button, Dialog, Sign, Table, TableSkeleton, Td, Th, Tr } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, HardDriveDownload, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EmptyState, QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { desktop } from '../../lib/desktop'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { backupsQuery } from './queries'
import { RestoreForm } from './restore'

export function BackupsPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const query = useQuery(backupsQuery)
  const [restoring, setRestoring] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['backups'] })

  const create = useMutation({
    mutationFn: () => api(backupSchema, 'POST', '/backups'),
    onSuccess: () => {
      toast.success(t('backups.created'))
      return refresh()
    },
    onError: report,
  })

  const exportCopy = useMutation({
    mutationFn: async () => {
      const stamp = new Date().toISOString().slice(0, 10)
      const destination = await desktop().chooseBackupDestination(`inventory-${stamp}.invbak`)
      if (!destination) return null
      return api(backupSchema, 'POST', '/backups/export', { body: { destination } })
    },
    onSuccess: (backup) => {
      if (backup) toast.success(t('backups.exported'))
    },
    onError: report,
  })

  const createButton = (
    <Button loading={create.isPending} onClick={() => create.mutate()}>
      <Archive aria-hidden className="size-4" />
      {t('backups.create')}
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <Sign
        title={t('nav.backups.label')}
        secondary={t('nav.backups.other')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRestoring(true)}>
              <RotateCcw aria-hidden className="size-4" />
              {t('backups.restore')}
            </Button>
            <Button variant="secondary" loading={exportCopy.isPending} onClick={() => exportCopy.mutate()}>
              <HardDriveDownload aria-hidden className="size-4" />
              {t('backups.export')}
            </Button>
            {createButton}
          </>
        }
      />
      <p className="max-w-prose text-ink-soft">{t('backups.note')}</p>

      <QueryBoundary
        query={query}
        skeleton={<TableSkeleton columns={3} />}
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title={t('backups.emptyTitle')} body={t('backups.emptyBody')} />}
      >
        {(data) => (
          <Table>
            <thead>
              <tr>
                <Th>{t('backups.date')}</Th>
                <Th>{t('backups.kind')}</Th>
                <Th>{t('backups.size')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((backup) => (
                <Tr key={backup.fileName}>
                  <Td className="tabular">{format.dateTime(backup.createdAt)}</Td>
                  <Td>
                    <Badge tone={backup.automatic ? 'neutral' : 'route'}>
                      {backup.automatic ? t('backups.automatic') : t('backups.manual')}
                    </Badge>
                  </Td>
                  <Td className="tabular">{format.bytes(backup.sizeBytes)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryBoundary>

      <Dialog
        open={restoring}
        onOpenChange={setRestoring}
        title={t('backups.restoreTitle')}
        description={t('backups.restoreBody')}
        closeLabel={t('common.close')}
      >
        <RestoreForm onCancel={() => setRestoring(false)} />
      </Dialog>
    </div>
  )
}

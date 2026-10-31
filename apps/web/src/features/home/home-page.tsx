import { auditPageSchema, backupSchema } from '@inv/contracts'
import { Badge, Button, Sign, Skeleton } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { useActor, useCan } from '../../lib/session'
import { useAuditLabel } from '../audit/audit-label'
import { backupsQuery } from '../backups/queries'
import { settingsQuery } from '../settings/queries'

function StatusRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 border-b border-rule px-4 py-2 last:border-b-0">
      <span className="text-ink-soft">{label}</span>
      <span className="flex items-center gap-3 font-medium text-ink">{children}</span>
    </div>
  )
}

function BackupStatus() {
  const { t } = useTranslation()
  const format = useFormat()
  const report = useReportError()
  const queryClient = useQueryClient()
  const query = useQuery(backupsQuery)

  const create = useMutation({
    mutationFn: () => api(backupSchema, 'POST', '/backups'),
    onSuccess: () => {
      toast.success(t('backups.created'))
      return queryClient.invalidateQueries({ queryKey: backupsQuery.queryKey })
    },
    onError: report,
  })

  return (
    <StatusRow label={t('home.backup')}>
      <QueryBoundary query={query} skeleton={<Skeleton className="h-5 w-40" />}>
        {(data) => {
          const latest = data.items[0]
          return latest ? (
            <span className="tabular">{format.dateTime(latest.createdAt)}</span>
          ) : (
            <>
              <Badge tone="warn">{t('home.backupNone')}</Badge>
              <Button size="sm" variant="secondary" loading={create.isPending} onClick={() => create.mutate()}>
                <Archive aria-hidden className="size-4" />
                {t('home.backupNow')}
              </Button>
            </>
          )
        }}
      </QueryBoundary>
    </StatusRow>
  )
}

function RecentActivity() {
  const { t } = useTranslation()
  const format = useFormat()
  const label = useAuditLabel()
  const query = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => api(auditPageSchema, 'GET', '/audit?limit=6'),
  })

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-ink">{t('home.activity')}</h2>
      <QueryBoundary
        query={query}
        skeleton={<Skeleton className="h-40 w-full" />}
        isEmpty={(data) => data.items.length === 0}
        empty={<p className="text-ink-soft">{t('home.activityEmpty')}</p>}
      >
        {(data) => (
          <ul className="rounded-lg border border-rule bg-surface">
            {data.items.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-6 border-b border-rule px-4 py-2.5 last:border-b-0"
              >
                <span className="truncate">{label(entry.action)}</span>
                <span className="tabular shrink-0 text-sm text-ink-soft">{format.dateTime(entry.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </section>
  )
}

export function HomePage() {
  const { t } = useTranslation()
  const actor = useActor()
  const settings = useQuery(settingsQuery)
  const canBackUp = useCan('backups.manage')
  const canAudit = useCan('audit.view')

  return (
    <div className="flex flex-col gap-8">
      <Sign title={t('home.greeting', { name: actor.fullName })} secondary={settings.data?.store.name} />
      <section className="flex max-w-3xl flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">{t('home.statusTitle')}</h2>
        <div className="rounded-lg border border-rule bg-surface">
          {settings.data && (
            <StatusRow label={t('home.business')}>{t(`business.${settings.data.store.businessType}.name`)}</StatusRow>
          )}
          {canBackUp && <BackupStatus />}
          <StatusRow label={t('home.pin')}>
            <Badge tone={actor.hasPin ? 'ok' : 'neutral'}>
              {actor.hasPin ? t('home.pinOn') : t('home.pinOff')}
            </Badge>
          </StatusRow>
        </div>
      </section>
      {canAudit && (
        <div className="max-w-3xl">
          <RecentActivity />
        </div>
      )}
    </div>
  )
}

import { licenseInfoSchema } from '@inv/contracts'
import { Badge, Button, FormSkeleton, Sign } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { OfflineForm, SerialForm } from './license-screens'
import { licenseQuery } from './queries'

const TONE = { active: 'ok', grace: 'warn', read_only: 'danger', unlicensed: 'danger' } as const

export function LicensePage() {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const license = useQuery(licenseQuery)

  const checkIn = useMutation({
    mutationFn: () => api(licenseInfoSchema, 'POST', '/license/check-in'),
    onSuccess: async () => {
      toast.success(t('license.checked'))
      await queryClient.invalidateQueries({ queryKey: licenseQuery.queryKey })
    },
    onError: report,
  })

  return (
    <div className="flex flex-col gap-6">
      <Sign
        title={t('license.pageTitle')}
        secondary={t('nav.license.other')}
        actions={
          <Button variant="secondary" loading={checkIn.isPending} onClick={() => checkIn.mutate()}>
            {t('license.checkIn')}
          </Button>
        }
      />
      <QueryBoundary query={license} skeleton={<FormSkeleton fields={2} />}>
        {(data) => (
          <>
            <dl className="grid max-w-3xl grid-cols-2 gap-4 rounded-lg border border-rule bg-surface p-5">
              <div>
                <dt className="text-sm text-ink-soft">{t('license.status')}</dt>
                <dd className="pt-1">
                  <Badge tone={TONE[data.status]}>{t(`license.statuses.${data.status}`)}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">{t('license.customer')}</dt>
                <dd className="font-medium text-ink">{data.customer ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">{t('license.expiresAt')}</dt>
                <dd data-testid="license-expiry" className="tabular font-medium text-ink">
                  {data.expiresAt ? format.dateTime(data.expiresAt) : '-'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">{t('license.daysLeft')}</dt>
                <dd data-testid="license-days" className="tabular font-medium text-ink">
                  {data.daysLeft ?? '-'}
                </dd>
              </div>
            </dl>
            <section className="flex max-w-3xl flex-col gap-3">
              <h2 className="text-lg font-semibold text-ink">{t('license.renew')}</h2>
              <div className="grid grid-cols-2 items-start gap-6">
                <SerialForm />
                <OfflineForm deviceId={data.deviceId} />
              </div>
            </section>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}

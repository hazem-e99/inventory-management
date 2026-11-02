import { aiConsentSchema, aiStatusSchema, type AiStatus } from '@inv/contracts'
import { Badge, Button, Dialog } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'

export const aiStatusQuery = {
  queryKey: ['ai'],
  queryFn: () => api(aiStatusSchema, 'GET', '/ai'),
}

function Consent({ status }: { status: AiStatus }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const report = useReportError()
  const [asking, setAsking] = useState(false)

  const change = useMutation({
    mutationFn: (accepted: boolean) => api(aiStatusSchema, 'PUT', '/ai/consent', { body: aiConsentSchema.parse({ accepted }) }),
    onSuccess: (_status, accepted) => {
      setAsking(false)
      toast.success(t(accepted ? 'ai.consentGiven' : 'ai.consentWithdrawn'))
      return queryClient.invalidateQueries({ queryKey: ['ai'] })
    },
    onError: report,
  })

  if (status.consentedAt !== null) {
    return (
      <div className="flex items-center justify-between gap-4">
        <Badge tone="ok">{t('ai.consented')}</Badge>
        <Button variant="secondary" loading={change.isPending} onClick={() => change.mutate(false)}>
          {t('ai.withdraw')}
        </Button>
      </div>
    )
  }

  return (
    <>
      <div>
        <Button onClick={() => setAsking(true)}>{t('ai.reviewConsent')}</Button>
      </div>
      <Dialog open={asking} onOpenChange={setAsking} title={t('ai.consentTitle')} description={t('ai.consentIntro')} closeLabel={t('common.close')}>
        <ul className="flex list-disc flex-col gap-2 ps-5 text-ink-soft">
          <li>{t('ai.consentSent')}</li>
          <li>{t('ai.consentKept')}</li>
          <li>{t('ai.consentProcessor')}</li>
          <li>{t('ai.consentCustomers')}</li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsking(false)}>
            {t('common.cancel')}
          </Button>
          <Button loading={change.isPending} onClick={() => change.mutate(true)}>
            {t('ai.accept')}
          </Button>
        </div>
      </Dialog>
    </>
  )
}

/** Shown only to whoever manages the shop's settings, because the choice is the owner's. */
export function AiSection() {
  const { t } = useTranslation()
  const status = useQuery(aiStatusQuery)

  if (!status.data) return null

  return (
    <section className="flex max-w-3xl flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">{t('ai.title')}</h2>
      {status.data.available ? (
        <>
          <p className="text-ink-soft">{t('ai.usage', { used: status.data.used, limit: status.data.monthlyLimit })}</p>
          <Consent status={status.data} />
        </>
      ) : (
        <p className="text-ink-soft">{t('ai.notEnabled')}</p>
      )}
    </section>
  )
}

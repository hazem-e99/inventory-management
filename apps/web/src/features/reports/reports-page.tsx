import { REPORT_KEYS, type ReportKey } from '@inv/contracts'
import { Sign } from '@inv/ui'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { REPORTS } from './report-config'

const GROUPS = ['sales', 'stock', 'accounts'] as const

function ReportLink({ report }: { report: ReportKey }) {
  const { t } = useTranslation()
  return (
    <li>
      <Link to="/reports/$key" params={{ key: report }} className="group block border-b border-rule px-4 py-3 last:border-b-0 hover:bg-ground">
        <span className="block font-medium text-ink group-hover:text-route">{t(`reports.titles.${report}`)}</span>
        <span className="block text-sm text-ink-soft">{t(`reports.descriptions.${report}`)}</span>
      </Link>
    </li>
  )
}

export function ReportsPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <Sign title={t('nav.reports.label')} secondary={t('nav.reports.other')} />
      <div className="grid grid-cols-3 items-start gap-6">
        {GROUPS.map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">{t(`reports.groups.${group}`)}</h2>
            <ul className="rounded-lg border border-rule bg-surface">
              {REPORT_KEYS.filter((key) => REPORTS[key].group === group).map((key) => (
                <ReportLink key={key} report={key} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

import { fileSavedSchema, importReportSchema, type ImportIssue, type ImportReport } from '@inv/contracts'
import { Badge, Button, Dialog } from '@inv/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, FileWarning } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { desktop } from '../../lib/desktop'
import { useErrorText, useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { usePreferences } from '../../lib/preferences'

const VISIBLE_ISSUES = 8

function useIssueText() {
  const { t } = useTranslation()
  const errorText = useErrorText()

  return {
    column: (issue: ImportIssue) => (issue.column ? t(`import.columns.${issue.column}`) : ''),
    problem: (issue: ImportIssue) => errorText(issue.code),
    t,
  }
}

function ReportView({ path, report, onDone }: { path: string; report: ImportReport; onDone: () => void }) {
  const { t, column, problem } = useIssueText()
  const format = useFormat()
  const report_ = useReportError()
  const queryClient = useQueryClient()
  const rejected = report.totalRows - report.validRows

  const commit = useMutation({
    mutationFn: () => api(importReportSchema, 'POST', '/catalog/import', { body: { path } }),
    onSuccess: async (result) => {
      toast.success(t('import.done', { count: result.importedRows }))
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      await queryClient.invalidateQueries({ queryKey: ['catalog'] })
      onDone()
    },
    onError: report_,
  })

  const saveReport = useMutation({
    mutationFn: async () => {
      const destination = await desktop().chooseSpreadsheetDestination('import-errors.xlsx')
      if (!destination) return null
      const rows = [
        [t('import.reportRow'), t('import.reportColumn'), t('import.reportValue'), t('import.reportProblem')],
        ...report.issues.map((issue) => [String(issue.row), column(issue), issue.value ?? '', problem(issue)]),
      ]
      return api(fileSavedSchema, 'POST', '/catalog/import/issues', { body: { destination, rows } })
    },
    onSuccess: (saved) => {
      if (saved) toast.success(t('import.reportSaved'))
    },
    onError: report_,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t('import.summary', { total: format.number(report.totalRows) })}</Badge>
        <Badge tone="ok">{t('import.valid', { value: format.number(report.validRows) })}</Badge>
        {rejected > 0 && (
          <Badge tone="danger">{t('import.invalid', { value: format.number(rejected) })}</Badge>
        )}
      </div>

      {(report.newCategories.length > 0 || report.newBrands.length > 0) && (
        <p className="text-ink-soft">
          {t('import.created', { categories: report.newCategories.length, brands: report.newBrands.length })}
        </p>
      )}

      {report.issues.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-ink">{t('import.issuesTitle')}</h3>
          <ul className="max-h-60 overflow-y-auto rounded-md border border-rule">
            {report.issues.slice(0, VISIBLE_ISSUES).map((issue, index) => (
              <li key={index} className="flex gap-3 border-b border-rule px-3 py-2 text-sm last:border-b-0">
                <span className="tabular shrink-0 font-medium text-ink">{t('import.issueRow', { row: issue.row })}</span>
                <span className="text-ink-soft">
                  {column(issue)}
                  {issue.value && (
                    <>
                      {' '}
                      <bdi>({issue.value})</bdi>
                    </>
                  )}
                  : {problem(issue)}
                </span>
              </li>
            ))}
          </ul>
          {report.issues.length > VISIBLE_ISSUES && (
            <p className="text-sm text-ink-faint">
              {t('import.moreIssues', { count: report.issues.length - VISIBLE_ISSUES })}
            </p>
          )}
          <div>
            <Button variant="secondary" size="sm" loading={saveReport.isPending} onClick={() => saveReport.mutate()}>
              <FileWarning aria-hidden className="size-4" />
              {t('import.saveReport')}
            </Button>
          </div>
        </section>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button disabled={report.validRows === 0} loading={commit.isPending} onClick={() => commit.mutate()}>
          {t('import.submit', { count: report.validRows })}
        </Button>
      </div>
    </div>
  )
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { preferences } = usePreferences()
  const report = useReportError()
  const [preview, setPreview] = useState<{ path: string; report: ImportReport } | null>(null)

  const choose = useMutation({
    mutationFn: async () => {
      const path = await desktop().chooseCatalogFile()
      if (!path) return null
      const result = await api(importReportSchema, 'POST', '/catalog/import/preview', { body: { path } })
      return { path, report: result }
    },
    onSuccess: (result) => {
      if (result) setPreview(result)
    },
    onError: report,
  })

  const template = useMutation({
    mutationFn: async () => {
      const destination = await desktop().chooseSpreadsheetDestination('items-template.xlsx')
      if (!destination) return null
      return api(fileSavedSchema, 'POST', '/catalog/import/template', {
        body: { destination, locale: preferences.locale },
      })
    },
    onError: report,
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('import.title')}
      {...(preview ? {} : { description: t('import.intro') })}
      closeLabel={t('common.close')}
      className="w-[min(40rem,calc(100vw-2rem))]"
    >
      {preview ? (
        <ReportView path={preview.path} report={preview.report} onDone={onClose} />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" loading={template.isPending} onClick={() => template.mutate()}>
            <Download aria-hidden className="size-4" />
            {t('import.template')}
          </Button>
          <Button loading={choose.isPending} onClick={() => choose.mutate()}>
            <FileSpreadsheet aria-hidden className="size-4" />
            {choose.isPending ? t('import.checking') : t('import.choose')}
          </Button>
        </div>
      )}
    </Dialog>
  )
}

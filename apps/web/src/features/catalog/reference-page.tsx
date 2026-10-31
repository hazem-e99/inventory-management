import {
  okSchema,
  REFERENCE_KINDS,
  referenceInputSchema,
  referenceSchema,
  type Reference,
  type ReferenceKind,
} from '@inv/contracts'
import { Badge, Button, cn, Dialog, Menu, MenuItem, Sign, Table, TableSkeleton, Td, Th, Tr } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { SelectField, SubmitButton, TextField } from '../../components/form'
import { EmptyState, QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { referenceQuery, useReferenceName } from './queries'

const tabStyles =
  'border-b-2 border-transparent px-4 py-2.5 font-medium text-ink-soft transition-colors duration-150 hover:text-ink data-[state=active]:border-route data-[state=active]:text-route'

const entrySchema = z.object({
  name: referenceInputSchema.shape.name,
  parentId: z.string(),
  allowsFraction: z.boolean(),
  rate: z.string().refine((value) => value === '' || (Number(value) >= 0 && Number(value) <= 100), 'INVALID_VALUE'),
})

function EntryForm({
  kind,
  entry,
  rows,
  onDone,
}: {
  kind: ReferenceKind
  entry: Reference | null
  rows: Reference[]
  onDone: () => void
}) {
  const { t } = useTranslation()
  const name = useReferenceName(kind)
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: zodResolver(entrySchema),
    defaultValues: {
      name: entry?.name ?? '',
      parentId: entry?.parentId ?? '',
      allowsFraction: entry?.allowsFraction ?? false,
      rate: entry?.rateBp === undefined ? '' : String(entry.rateBp / 100),
    },
  })
  const report = useReportError(form, (path) => (path === 'rateBp' ? 'rate' : path))

  const submit = form.handleSubmit(async (values) => {
    const body = {
      name: entry?.isSystem ? entry.name : values.name,
      ...(kind === 'categories' ? { parentId: values.parentId || null } : {}),
      ...(kind === 'units' ? { allowsFraction: values.allowsFraction } : {}),
      ...(kind === 'tax-rates' ? { rateBp: Math.round(Number(values.rate) * 100) } : {}),
    }
    const request = entry
      ? api(referenceSchema, 'PUT', `/catalog/${kind}/${entry.id}`, { body })
      : api(referenceSchema, 'POST', `/catalog/${kind}`, { body })

    await request
      .then(async () => {
        toast.success(t('reference.saved'))
        await queryClient.invalidateQueries({ queryKey: ['catalog'] })
        onDone()
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField form={form} name="name" label={t('reference.name')} disabled={entry?.isSystem ?? false} autoFocus />
      {kind === 'categories' && (
        <SelectField form={form} name="parentId" label={t('reference.parent')}>
          <option value="">{t('reference.noParent')}</option>
          {rows
            .filter((row) => row.id !== entry?.id && !row.archived)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {name(row)}
              </option>
            ))}
        </SelectField>
      )}
      {kind === 'units' && (
        <label className="flex cursor-pointer items-center gap-2 text-ink">
          <input type="checkbox" className="size-4 accent-route" {...form.register('allowsFraction')} />
          {t('reference.allowsFraction')}
        </label>
      )}
      {kind === 'tax-rates' && (
        <TextField form={form} name="rate" dir="ltr" inputMode="decimal" label={t('reference.rate')} />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <SubmitButton form={form}>{t('common.save')}</SubmitButton>
      </div>
    </form>
  )
}

function ReferenceTab({ kind }: { kind: ReferenceKind }) {
  const { t } = useTranslation()
  const name = useReferenceName(kind)
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const query = useQuery(referenceQuery(kind))
  const [editing, setEditing] = useState<Reference | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Reference | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['catalog'] })

  const setArchived = useMutation({
    mutationFn: (row: Reference) =>
      api(referenceSchema, 'PUT', `/catalog/${kind}/${row.id}`, { body: { name: row.name, archived: !row.archived } }),
    onSuccess: refresh,
    onError: report,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(okSchema, 'DELETE', `/catalog/${kind}/${id}`),
    onSuccess: async () => {
      toast.success(t('reference.deleted'))
      await refresh()
      setDeleting(null)
    },
    onError: (error) => {
      setDeleting(null)
      report(error)
    },
  })

  const addButton = (
    <Button onClick={() => setEditing('new')}>
      <Plus aria-hidden className="size-4" />
      {t('reference.add')}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{addButton}</div>
      <QueryBoundary
        query={query}
        skeleton={<TableSkeleton columns={3} rows={5} />}
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title={t('reference.emptyTitle')} body={t('reference.emptyBody')} />}
      >
        {(data) => (
          <Table>
            <thead>
              <tr>
                <Th>{t('reference.name')}</Th>
                {kind === 'tax-rates' && <Th>{t('reference.rate')}</Th>}
                {kind === 'units' && <Th>{t('reference.fraction')}</Th>}
                <Th>{t('reference.usage')}</Th>
                <Th aria-label={t('common.edit')} />
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <span className={cn('flex items-center gap-2 font-medium', row.archived && 'text-ink-faint')}>
                      {name(row)}
                      {row.isSystem && <Badge>{t('reference.system')}</Badge>}
                      {row.archived && <Badge tone="warn">{t('reference.archived')}</Badge>}
                    </span>
                  </Td>
                  {kind === 'tax-rates' && <Td className="tabular">{format.number((row.rateBp ?? 0) / 100)}%</Td>}
                  {kind === 'units' && <Td>{row.allowsFraction ? t('common.yes') : ''}</Td>}
                  <Td className="tabular">{format.number(row.usageCount)}</Td>
                  <Td className="w-12">
                    <Menu
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={`${t('common.edit')} ${name(row)}`}>
                          <Ellipsis aria-hidden className="size-4" />
                        </Button>
                      }
                    >
                      <MenuItem onSelect={() => setEditing(row)}>
                        <Pencil aria-hidden />
                        {t('common.edit')}
                      </MenuItem>
                      <MenuItem onSelect={() => setArchived.mutate(row)}>
                        {row.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                        {row.archived ? t('reference.restore') : t('reference.archive')}
                      </MenuItem>
                      {!row.isSystem && (
                        <MenuItem onSelect={() => setDeleting(row)}>
                          <Trash2 aria-hidden />
                          {t('common.delete')}
                        </MenuItem>
                      )}
                    </Menu>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryBoundary>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        title={
          editing && editing !== 'new' ? t('reference.editTitle', { name: name(editing) }) : t('reference.addTitle')
        }
        closeLabel={t('common.close')}
      >
        {editing && (
          <EntryForm
            kind={kind}
            entry={editing === 'new' ? null : editing}
            rows={query.data?.items ?? []}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('reference.deleteTitle', { name: deleting ? name(deleting) : '' })}
        description={t('reference.deleteBody')}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => {
              if (deleting) remove.mutate(deleting.id)
            }}
          >
            {t('common.delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

export function ReferencePage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <Sign title={t('nav.catalog.label')} secondary={t('nav.catalog.other')} />
      <Tabs.Root defaultValue={REFERENCE_KINDS[0]}>
        <Tabs.List className="mb-4 flex border-b border-rule">
          {REFERENCE_KINDS.map((kind) => (
            <Tabs.Trigger key={kind} value={kind} className={tabStyles}>
              {t(`reference.tabs.${kind}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {REFERENCE_KINDS.map((kind) => (
          <Tabs.Content key={kind} value={kind}>
            <ReferenceTab kind={kind} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  )
}

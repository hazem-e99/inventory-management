import { okSchema, PERMISSIONS, roleInputSchema, roleSchema, rolesListSchema, type Role } from '@inv/contracts'
import { Badge, Button, Dialog, Sign, Table, TableSkeleton, Td, Th, Tr } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SubmitButton, TextField } from '../../components/form'
import { QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useFormat } from '../../lib/format'
import { useCan } from '../../lib/session'
import { useRoleName } from './role-name'

const rolesQuery = { queryKey: ['roles'], queryFn: () => api(rolesListSchema, 'GET', '/roles') }

function RoleForm({ role, onDone }: { role: Role | null; onDone: () => void }) {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: zodResolver(roleInputSchema),
    defaultValues: {
      name: role ? roleName(role) : '',
      permissions: role?.permissions ?? [],
    },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    const request = role
      ? api(roleSchema, 'PUT', `/roles/${role.id}`, { body })
      : api(roleSchema, 'POST', '/roles', { body })

    await request
      .then(async () => {
        toast.success(t('roles.saved'))
        await queryClient.invalidateQueries({ queryKey: ['roles'] })
        onDone()
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField form={form} name="name" label={t('roles.name')} disabled={role?.isSystem ?? false} autoFocus />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium text-ink">{t('roles.permissions')}</legend>
        {PERMISSIONS.map((permission) => (
          <label key={permission} className="flex cursor-pointer items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-sunken">
            <input
              type="checkbox"
              value={permission}
              className="size-4 accent-route"
              {...form.register('permissions')}
            />
            {t(`permissions.${permission}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <SubmitButton form={form}>{t('common.save')}</SubmitButton>
      </div>
    </form>
  )
}

export function RolesPage() {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const format = useFormat()
  const queryClient = useQueryClient()
  const report = useReportError()
  const canManage = useCan('roles.manage')
  const query = useQuery(rolesQuery)
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Role | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api(okSchema, 'DELETE', `/roles/${id}`),
    onSuccess: async () => {
      toast.success(t('roles.deleted'))
      await queryClient.invalidateQueries({ queryKey: ['roles'] })
      setDeleting(null)
    },
    onError: (error) => {
      setDeleting(null)
      report(error)
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <Sign
        title={t('nav.roles.label')}
        secondary={t('nav.roles.other')}
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden className="size-4" />
              {t('roles.add')}
            </Button>
          )
        }
      />

      <QueryBoundary query={query} skeleton={<TableSkeleton columns={3} rows={4} />}>
        {(data) => (
          <Table>
            <thead>
              <tr>
                <Th>{t('roles.name')}</Th>
                <Th>{t('roles.permissions')}</Th>
                <Th>{t('nav.users.label')}</Th>
                {canManage && <Th aria-label={t('common.edit')} />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((role) => (
                <Tr key={role.id}>
                  <Td>
                    <span className="flex items-center gap-2 font-medium">
                      {roleName(role)}
                      {role.isSystem && <Badge>{t('roles.system')}</Badge>}
                    </span>
                  </Td>
                  <Td className="max-w-md text-sm text-ink-soft">
                    {role.id === 'owner'
                      ? t('roles.ownerNote')
                      : role.permissions.length === 0
                        ? t('roles.noPermissions')
                        : role.permissions
                            .map((permission) => t(`permissions.${permission}`))
                            .join(t('common.listSeparator'))}
                  </Td>
                  <Td className="tabular">{format.number(role.userCount)}</Td>
                  {canManage && (
                    <Td className="w-24">
                      {role.id !== 'owner' && (
                        <span className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('common.edit')} ${roleName(role)}`}
                            onClick={() => setEditing(role)}
                          >
                            <Pencil aria-hidden className="size-4" />
                          </Button>
                          {!role.isSystem && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${t('common.delete')} ${roleName(role)}`}
                              onClick={() => setDeleting(role)}
                            >
                              <Trash2 aria-hidden className="size-4" />
                            </Button>
                          )}
                        </span>
                      )}
                    </Td>
                  )}
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
          editing && editing !== 'new'
            ? t('roles.editTitle', { name: roleName(editing) })
            : t('roles.addTitle')
        }
        closeLabel={t('common.close')}
      >
        {editing && (
          <RoleForm role={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('roles.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('roles.deleteBody')}
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

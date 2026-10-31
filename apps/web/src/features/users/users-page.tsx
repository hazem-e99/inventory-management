import {
  createUserSchema,
  okSchema,
  resetPasswordSchema,
  rolesListSchema,
  updateUserSchema,
  userSchema,
  usersListSchema,
  type Role,
  type User,
} from '@inv/contracts'
import { Badge, Button, Dialog, Menu, MenuItem, Sign, Table, TableSkeleton, Td, Th, Tr } from '@inv/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ellipsis, KeyRound, Pencil, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SelectField, SubmitButton, TextField } from '../../components/form'
import { EmptyState, QueryBoundary } from '../../components/states'
import { api } from '../../lib/api'
import { useReportError } from '../../lib/errors'
import { useActor, useCan } from '../../lib/session'
import { useRoleName } from './role-name'

const usersQuery = { queryKey: ['users'], queryFn: () => api(usersListSchema, 'GET', '/users') }
const rolesQuery = { queryKey: ['roles'], queryFn: () => api(rolesListSchema, 'GET', '/roles') }

function useAssignableRoles(roles: Role[]): Role[] {
  const actor = useActor()
  return roles.filter((role) => role.id !== 'owner' || actor.roleId === 'owner')
}

function CreateUserForm({ roles, onDone }: { roles: Role[]; onDone: () => void }) {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const queryClient = useQueryClient()
  const assignable = useAssignableRoles(roles)
  const form = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: { fullName: '', username: '', password: '', roleId: 'cashier' },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(userSchema, 'POST', '/users', { body })
      .then(async () => {
        toast.success(t('users.created'))
        await queryClient.invalidateQueries({ queryKey: ['users'] })
        onDone()
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField form={form} name="fullName" label={t('users.fullName')} autoFocus />
      <TextField form={form} name="username" dir="ltr" label={t('users.username')} autoComplete="off" />
      <TextField
        form={form}
        name="password"
        type="password"
        dir="ltr"
        label={t('users.tempPassword')}
        hint={t('users.tempPasswordHint')}
        autoComplete="new-password"
      />
      <SelectField form={form} name="roleId" label={t('users.role')}>
        {assignable.map((role) => (
          <option key={role.id} value={role.id}>
            {roleName(role)}
          </option>
        ))}
      </SelectField>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <SubmitButton form={form}>{t('common.add')}</SubmitButton>
      </div>
    </form>
  )
}

function EditUserForm({ user, roles, onDone }: { user: User; roles: Role[]; onDone: () => void }) {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const queryClient = useQueryClient()
  const assignable = useAssignableRoles(roles)
  const form = useForm({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { fullName: user.fullName, roleId: user.roleId },
  })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(userSchema, 'PATCH', `/users/${user.id}`, { body })
      .then(async () => {
        toast.success(t('users.updated'))
        await queryClient.invalidateQueries({ queryKey: ['users'] })
        onDone()
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField form={form} name="fullName" label={t('users.fullName')} autoFocus />
      <SelectField form={form} name="roleId" label={t('users.role')}>
        {assignable.map((role) => (
          <option key={role.id} value={role.id}>
            {roleName(role)}
          </option>
        ))}
      </SelectField>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <SubmitButton form={form}>{t('common.save')}</SubmitButton>
      </div>
    </form>
  )
}

function ResetPasswordForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { t } = useTranslation()
  const form = useForm({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '' } })
  const report = useReportError(form)

  const submit = form.handleSubmit(async (body) => {
    await api(okSchema, 'POST', `/users/${user.id}/reset-password`, { body })
      .then(() => {
        toast.success(t('users.passwordReset'))
        onDone()
      })
      .catch(report)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <TextField
        form={form}
        name="password"
        type="password"
        dir="ltr"
        label={t('users.tempPassword')}
        hint={t('users.tempPasswordHint')}
        autoComplete="new-password"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <SubmitButton form={form}>{t('common.save')}</SubmitButton>
      </div>
    </form>
  )
}

type Panel = { kind: 'create' } | { kind: 'edit'; user: User } | { kind: 'reset'; user: User } | null

export function UsersPage() {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const queryClient = useQueryClient()
  const report = useReportError()
  const canManage = useCan('users.manage')
  const users = useQuery(usersQuery)
  const roles = useQuery(rolesQuery)
  const [panel, setPanel] = useState<Panel>(null)
  const close = () => setPanel(null)

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api(userSchema, 'PATCH', `/users/${id}`, { body: { isActive } }),
    onSuccess: () => {
      toast.success(t('users.updated'))
      return queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: report,
  })

  const roleList = roles.data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <Sign
        title={t('nav.users.label')}
        secondary={t('nav.users.other')}
        actions={
          canManage && (
            <Button onClick={() => setPanel({ kind: 'create' })} disabled={!roles.data}>
              <UserPlus aria-hidden className="size-4" />
              {t('users.add')}
            </Button>
          )
        }
      />

      <QueryBoundary
        query={users}
        skeleton={<TableSkeleton columns={4} />}
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title={t('users.emptyTitle')} />}
      >
        {(data) => (
          <Table>
            <thead>
              <tr>
                <Th>{t('users.fullName')}</Th>
                <Th>{t('users.username')}</Th>
                <Th>{t('users.role')}</Th>
                <Th>{t('users.status')}</Th>
                {canManage && <Th aria-label={t('common.edit')} />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => {
                const role = roleList.find((candidate) => candidate.id === user.roleId)
                return (
                  <Tr key={user.id}>
                    <Td className="font-medium">{user.fullName}</Td>
                    <Td>
                      <bdi dir="ltr">{user.username}</bdi>
                    </Td>
                    <Td>{role ? roleName(role) : ''}</Td>
                    <Td>
                      <Badge tone={user.isActive ? 'ok' : 'neutral'}>
                        {user.isActive ? t('users.active') : t('users.disabled')}
                      </Badge>
                    </Td>
                    {canManage && (
                      <Td className="w-12">
                        <Menu
                          trigger={
                            <Button variant="ghost" size="icon" aria-label={`${t('common.edit')} ${user.fullName}`}>
                              <Ellipsis aria-hidden className="size-4" />
                            </Button>
                          }
                        >
                          <MenuItem onSelect={() => setPanel({ kind: 'edit', user })}>
                            <Pencil aria-hidden />
                            {t('common.edit')}
                          </MenuItem>
                          <MenuItem onSelect={() => setPanel({ kind: 'reset', user })}>
                            <KeyRound aria-hidden />
                            {t('users.resetPassword')}
                          </MenuItem>
                          <MenuItem
                            onSelect={() => setActive.mutate({ id: user.id, isActive: !user.isActive })}
                          >
                            {user.isActive ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
                            {user.isActive ? t('users.disable') : t('users.enable')}
                          </MenuItem>
                        </Menu>
                      </Td>
                    )}
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </QueryBoundary>

      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={
          panel?.kind === 'create'
            ? t('users.addTitle')
            : panel?.kind === 'edit'
              ? t('users.editTitle', { name: panel.user.fullName })
              : panel?.kind === 'reset'
                ? t('users.resetTitle', { name: panel.user.fullName })
                : ''
        }
        closeLabel={t('common.close')}
      >
        {panel?.kind === 'create' && <CreateUserForm roles={roleList} onDone={close} />}
        {panel?.kind === 'edit' && <EditUserForm user={panel.user} roles={roleList} onDone={close} />}
        {panel?.kind === 'reset' && <ResetPasswordForm user={panel.user} onDone={close} />}
      </Dialog>
    </div>
  )
}

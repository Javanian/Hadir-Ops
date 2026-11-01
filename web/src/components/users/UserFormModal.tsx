import { useEffect } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { usersApi } from '@/api/users.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess, showError } from '@/utils/toast'
import type { UserListItem } from '@/types/users'
import { t } from '@/i18n'

const createSchema = z.object({
  employee_id: z.string().min(1, t('userForm.employeeIdIsRequired')),
  name: z.string().min(1, t('userForm.nameIsRequired')),
  email: z.email(t('userForm.invalidEmailAddress')),
  password: z.string().min(8, t('userForm.passwordMustBeAtLeast')),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'EMPLOYEE', 'SALES']),
  site_id: z.number().nullable(),
  supervisor_id: z.number().nullable(),
})

const editSchema = z.object({
  name: z.string().min(1, t('userForm.nameIsRequired')),
  email: z.email(t('userForm.invalidEmailAddress')),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'EMPLOYEE', 'SALES']),
  site_id: z.number().nullable(),
  supervisor_id: z.number().nullable(),
  is_active: z.boolean(),
})

type CreateFormData = z.infer<typeof createSchema>
type EditFormData = z.infer<typeof editSchema>

interface Props {
  open: boolean
  onClose: () => void
  editingUser: UserListItem | null
}

export function UserFormModal({ open, onClose, editingUser }: Props) {
  const qc = useQueryClient()
  const isEdit = editingUser !== null

  const {
    register: regCreate, handleSubmit: handleCreate, control: controlCreate,
    reset: resetCreate, formState: { errors: ce },
  } = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { employee_id: '', name: '', email: '', password: '', role: 'EMPLOYEE', site_id: null, supervisor_id: null },
  })

  const {
    register: regEdit, handleSubmit: handleEdit, control: controlEdit,
    reset: resetEdit, setValue: setEditValue,
    formState: { errors: ee },
  } = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', email: '', role: 'EMPLOYEE', site_id: null, supervisor_id: null, is_active: true },
  })
  const createRole = useWatch({ control: controlCreate, name: 'role' })
  const editRole = useWatch({ control: controlEdit, name: 'role' })

  useEffect(() => {
    if (editingUser) {
      resetEdit({ name: editingUser.name, email: editingUser.email, role: editingUser.role, site_id: editingUser.site_id, supervisor_id: null, is_active: editingUser.is_active })
    } else {
      resetCreate()
    }
  }, [editingUser, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      showSuccess(t('userForm.userAdded'))
      void qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        showError((err.response.data as { detail?: string })?.detail ?? t('common.invalidData'))
      }
    },
  })

  const editMutation = useMutation({
    mutationFn: (data: EditFormData) => usersApi.update(editingUser!.id, data),
    onSuccess: () => {
      showSuccess(t('userForm.userUpdated'))
      void qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        showError((err.response.data as { detail?: string })?.detail ?? t('common.invalidData'))
      }
    },
  })

  const handleClose = () => { resetCreate(); resetEdit(); onClose() }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('userForm.edit', { name: editingUser?.name }) : t('userForm.addANewUser')}
          </DialogTitle>
        </DialogHeader>

        {isEdit ? (
          <form onSubmit={handleEdit((d) => editMutation.mutate(d))} className="space-y-4">
            <Field error={ee.name?.message}>
              <Label>{t('userForm.fullName2')}</Label>
              <Input placeholder={t('userForm.fullName')} {...regEdit('name')} />
            </Field>
            <Field error={ee.email?.message}>
              <Label>Email *</Label>
              <Input type="email" placeholder="email@perusahaan.com" {...regEdit('email')} />
            </Field>
            <Field>
              <Label>Role *</Label>
              <Controller control={controlEdit} name="role" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                    <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                    <SelectItem value="EMPLOYEE">{t('common.employee')}</SelectItem>
                    <SelectItem value="SALES">Sales</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </Field>

            {editRole === 'EMPLOYEE' && (
              <Field>
                <Label>Supervisor</Label>
                <Input
                  placeholder={t('userForm.supervisorIdOptional')}
                  type="number"
                  onChange={(e) => setEditValue('supervisor_id', e.target.value ? parseInt(e.target.value) : null)}
                />
              </Field>
            )}
            <div className="flex items-center gap-3">
              <input type="checkbox" id="is_active_edit" {...regEdit('is_active')} className="h-4 w-4 accent-brand" />
              <Label htmlFor="is_active_edit">{t('userForm.activeAccount')}</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending ? t('common.saving') : t('common.saveChanges')}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleCreate((d) => createMutation.mutate(d))} className="space-y-4">
            <Field error={ce.employee_id?.message}>
              <Label>{t('userForm.employeeId')}</Label>
              <Input placeholder={t('userForm.eGEmp001')} {...regCreate('employee_id')} />
            </Field>
            <Field error={ce.name?.message}>
              <Label>{t('userForm.fullName2')}</Label>
              <Input placeholder={t('userForm.fullName')} {...regCreate('name')} />
            </Field>
            <Field error={ce.email?.message}>
              <Label>Email *</Label>
              <Input type="email" placeholder="email@perusahaan.com" {...regCreate('email')} />
            </Field>
            <Field>
              <Label>Role *</Label>
              <Controller control={controlCreate} name="role" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                    <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                    <SelectItem value="EMPLOYEE">{t('common.employee')}</SelectItem>
                    <SelectItem value="SALES">Sales</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </Field>

            {createRole === 'EMPLOYEE' && (
              <Field>
                <Label>Supervisor</Label>
                <Input
                  placeholder={t('userForm.supervisorIdOptional')}
                  type="number"
                  onChange={(e) =>
                    regCreate('supervisor_id').onChange({ target: { value: e.target.value ? parseInt(e.target.value) : null } })
                  }
                />
              </Field>
            )}
            <Field error={ce.password?.message}>
              <Label>Password *</Label>
              <Input type="password" placeholder={t('userForm.atLeast8Characters')} {...regCreate('password')} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? t('common.saving') : t('common.addUser')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

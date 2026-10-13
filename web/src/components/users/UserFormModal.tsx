import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { usersApi } from '@/api/users.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess, showError } from '@/utils/toast'
import type { UserListItem } from '@/types/users'

const createSchema = z.object({
  employee_id: z.string().min(1, 'ID karyawan wajib diisi'),
  name: z.string().min(1, 'Nama wajib diisi'),
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'EMPLOYEE', 'SALES']),
  site_id: z.number().nullable(),
  supervisor_id: z.number().nullable(),
})

const editSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi'),
  email: z.string().email('Format email tidak valid'),
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
    watch: watchCreate, reset: resetCreate, formState: { errors: ce },
  } = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { employee_id: '', name: '', email: '', password: '', role: 'EMPLOYEE', site_id: null, supervisor_id: null },
  })

  const {
    register: regEdit, handleSubmit: handleEdit, control: controlEdit,
    watch: watchEdit, reset: resetEdit, setValue: setEditValue,
    formState: { errors: ee },
  } = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', email: '', role: 'EMPLOYEE', site_id: null, supervisor_id: null, is_active: true },
  })

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
      showSuccess('Pengguna berhasil ditambahkan')
      void qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        showError((err.response.data as { detail?: string })?.detail ?? 'Data tidak valid')
      }
    },
  })

  const editMutation = useMutation({
    mutationFn: (data: EditFormData) => usersApi.update(editingUser!.id, data),
    onSuccess: () => {
      showSuccess('Pengguna berhasil diperbarui')
      void qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        showError((err.response.data as { detail?: string })?.detail ?? 'Data tidak valid')
      }
    },
  })

  const handleClose = () => { resetCreate(); resetEdit(); onClose() }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit: ${editingUser?.name}` : 'Tambah Pengguna Baru'}
          </DialogTitle>
        </DialogHeader>

        {isEdit ? (
          <form onSubmit={handleEdit((d) => editMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nama Lengkap *</Label>
              <Input placeholder="Nama lengkap" {...regEdit('name')} />
              {ee.name && <p className="text-xs text-red-500">{ee.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="email@perusahaan.com" {...regEdit('email')} />
              {ee.email && <p className="text-xs text-red-500">{ee.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Controller control={controlEdit} name="role" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                    <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                    <SelectItem value="EMPLOYEE">Karyawan</SelectItem>
                    <SelectItem value="SALES">Sales</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>

            {watchEdit('role') === 'EMPLOYEE' && (
              <div className="space-y-1.5">
                <Label>Supervisor</Label>
                <Input
                  placeholder="ID supervisor (opsional)"
                  type="number"
                  onChange={(e) => setEditValue('supervisor_id', e.target.value ? parseInt(e.target.value) : null)}
                />
              </div>
            )}
            <div className="flex items-center gap-3">
              <input type="checkbox" id="is_active_edit" {...regEdit('is_active')} className="h-4 w-4 accent-brand" />
              <Label htmlFor="is_active_edit">Akun aktif</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Batal</Button>
              <Button type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending ? 'Menyimpan...' : 'Simpan Perubahan'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleCreate((d) => createMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>ID Karyawan *</Label>
              <Input placeholder="cth. EMP001" {...regCreate('employee_id')} />
              {ce.employee_id && <p className="text-xs text-red-500">{ce.employee_id.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Nama Lengkap *</Label>
              <Input placeholder="Nama lengkap" {...regCreate('name')} />
              {ce.name && <p className="text-xs text-red-500">{ce.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="email@perusahaan.com" {...regCreate('email')} />
              {ce.email && <p className="text-xs text-red-500">{ce.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Controller control={controlCreate} name="role" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                    <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                    <SelectItem value="EMPLOYEE">Karyawan</SelectItem>
                    <SelectItem value="SALES">Sales</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>

            {watchCreate('role') === 'EMPLOYEE' && (
              <div className="space-y-1.5">
                <Label>Supervisor</Label>
                <Input
                  placeholder="ID supervisor (opsional)"
                  type="number"
                  onChange={(e) =>
                    regCreate('supervisor_id').onChange({ target: { value: e.target.value ? parseInt(e.target.value) : null } })
                  }
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Password *</Label>
              <Input type="password" placeholder="Minimal 8 karakter" {...regCreate('password')} />
              {ce.password && <p className="text-xs text-red-500">{ce.password.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Batal</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Menyimpan...' : 'Tambah Pengguna'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

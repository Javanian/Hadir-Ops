import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { holidaysApi } from '@/api/shifts.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess, showError } from '@/utils/toast'
import type { HolidayResponse } from '@/types/shifts'

const createSchema = z.object({
  holiday_date: z.string().min(1, 'Tanggal wajib diisi'),
  description: z.string().optional(),
  is_national: z.boolean(),
})

const editSchema = z.object({
  description: z.string().optional(),
  is_national: z.boolean(),
})

type CreateFormData = z.infer<typeof createSchema>
type EditFormData = z.infer<typeof editSchema>

interface Props {
  open: boolean
  onClose: () => void
  editingHoliday: HolidayResponse | null
}

export function HolidayFormModal({ open, onClose, editingHoliday }: Props) {
  const qc = useQueryClient()
  const isEdit = editingHoliday !== null

  // Create form
  const {
    register: regCreate,
    handleSubmit: handleCreate,
    reset: resetCreate,
    formState: { errors: ce },
  } = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { holiday_date: '', description: '', is_national: true },
  })

  // Edit form
  const {
    register: regEdit,
    handleSubmit: handleEdit,
    reset: resetEdit,
    formState: { errors: ee },
  } = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: { description: '', is_national: true },
  })

  useEffect(() => {
    if (editingHoliday) {
      resetEdit({
        description: editingHoliday.description ?? '',
        is_national: editingHoliday.is_national,
      })
    } else {
      resetCreate({ holiday_date: '', description: '', is_national: true })
    }
  }, [editingHoliday, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: (data: CreateFormData) =>
      holidaysApi.create({
        holiday_date: data.holiday_date,
        description: data.description || undefined,
        is_national: data.is_national,
      }),
    onSuccess: () => {
      showSuccess('Hari libur berhasil ditambahkan')
      void qc.invalidateQueries({ queryKey: ['holidays'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        const detail = (err.response.data as { detail?: string })?.detail
        showError(detail ?? 'Data tidak valid')
      }
    },
  })

  const editMutation = useMutation({
    mutationFn: (data: EditFormData) =>
      holidaysApi.update(editingHoliday!.id, {
        description: data.description || undefined,
        is_national: data.is_national,
      }),
    onSuccess: () => {
      showSuccess('Hari libur berhasil diperbarui')
      void qc.invalidateQueries({ queryKey: ['holidays'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        const detail = (err.response.data as { detail?: string })?.detail
        showError(detail ?? 'Data tidak valid')
      }
    },
  })

  const handleClose = () => { resetCreate(); resetEdit(); onClose() }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Edit: ${editingHoliday?.holiday_date}`
              : 'Tambah Hari Libur'}
          </DialogTitle>
        </DialogHeader>

        {isEdit ? (
          <form onSubmit={handleEdit((d) => editMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <p className="text-sm font-medium text-text-primary">{editingHoliday?.holiday_date}</p>
              <p className="text-xs text-text-secondary">Tanggal tidak dapat diubah.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Keterangan</Label>
              <Input placeholder="cth. Hari Raya Idul Fitri" {...regEdit('description')} />
              {ee.description && (
                <p className="text-xs text-red-500">{ee.description.message}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="is_national_edit"
                {...regEdit('is_national')}
                className="h-4 w-4 accent-brand"
              />
              <Label htmlFor="is_national_edit">Hari libur nasional</Label>
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
              <Label>Tanggal *</Label>
              <Input type="date" {...regCreate('holiday_date')} />
              {ce.holiday_date && (
                <p className="text-xs text-red-500">{ce.holiday_date.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Keterangan</Label>
              <Input placeholder="cth. Hari Raya Idul Fitri" {...regCreate('description')} />
              {ce.description && (
                <p className="text-xs text-red-500">{ce.description.message}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="is_national_create"
                {...regCreate('is_national')}
                className="h-4 w-4 accent-brand"
              />
              <Label htmlFor="is_national_create">Hari libur nasional</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Batal</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Menyimpan...' : 'Tambah Hari Libur'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { shiftsApi } from '@/api/shifts.api'
import { sitesApi } from '@/api/sites.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess, showError } from '@/utils/toast'
import type { ShiftResponse } from '@/types/shifts'

const shiftSchema = z.object({
  site_id: z.number({ invalid_type_error: 'Lokasi wajib dipilih' }),
  name: z.string().min(1, 'Nama shift wajib diisi'),
  start_time: z.string().min(1, 'Jam mulai wajib diisi'),
  end_time: z.string().min(1, 'Jam selesai wajib diisi'),
  work_hours_standard: z
    .number({ invalid_type_error: 'Jam kerja harus berupa angka' })
    .int()
    .min(1, 'Minimal 1 jam')
    .max(24, 'Maksimal 24 jam'),
})

type FormData = z.infer<typeof shiftSchema>

interface Props {
  open: boolean
  onClose: () => void
  editingShift: ShiftResponse | null
}

function isCrossMidnight(start: string, end: string): boolean {
  if (!start || !end) return false
  return end < start
}

export function ShiftFormModal({ open, onClose, editingShift }: Props) {
  const qc = useQueryClient()
  const isEdit = editingShift !== null

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    enabled: open,
    staleTime: 5 * 60_000,
  })

  const { register, handleSubmit, control, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(shiftSchema),
    defaultValues: {
      site_id: undefined,
      name: '',
      start_time: '08:00',
      end_time: '17:00',
      work_hours_standard: 8,
    },
  })

  const watchedStart = watch('start_time')
  const watchedEnd = watch('end_time')
  const crossMidnight = isCrossMidnight(watchedStart, watchedEnd)

  useEffect(() => {
    if (editingShift) {
      reset({
        site_id: editingShift.site_id,
        name: editingShift.name ?? '',
        start_time: editingShift.start_time.substring(0, 5),
        end_time: editingShift.end_time.substring(0, 5),
        work_hours_standard: editingShift.work_hours_standard,
      })
    } else {
      reset({
        site_id: undefined,
        name: '',
        start_time: '08:00',
        end_time: '17:00',
        work_hours_standard: 8,
      })
    }
  }, [editingShift, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const payload = { ...data, is_cross_midnight: isCrossMidnight(data.start_time, data.end_time) }
      return isEdit
        ? shiftsApi.update(editingShift!.id, payload)
        : shiftsApi.create(payload)
    },
    onSuccess: () => {
      showSuccess(isEdit ? 'Shift berhasil diperbarui' : 'Shift berhasil ditambahkan')
      void qc.invalidateQueries({ queryKey: ['shifts'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        const detail = (err.response.data as { detail?: string })?.detail
        showError(detail ?? 'Data tidak valid')
      }
    },
  })

  const handleClose = () => { reset(); onClose() }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit Shift: ${editingShift?.name}` : 'Tambah Shift Baru'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          {/* Site */}
          <div className="space-y-1.5">
            <Label>Lokasi Kerja *</Label>
            <Controller
              control={control}
              name="site_id"
              render={({ field }) => (
                <Select
                  value={field.value != null ? field.value.toString() : '__none__'}
                  onValueChange={(v) => field.onChange(v === '__none__' ? undefined : parseInt(v))}
                  disabled={isEdit}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih lokasi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Pilih Lokasi —</SelectItem>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {isEdit && (
              <p className="text-xs text-text-secondary">Lokasi tidak dapat diubah setelah shift dibuat.</p>
            )}
            {errors.site_id && <p className="text-xs text-red-500">{errors.site_id.message}</p>}
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label>Nama Shift *</Label>
            <Input placeholder="cth. Pagi, Siang, Malam" {...register('name')} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Jam Mulai *</Label>
              <Input type="time" {...register('start_time')} />
              {errors.start_time && (
                <p className="text-xs text-red-500">{errors.start_time.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Jam Selesai *</Label>
              <Input type="time" {...register('end_time')} />
              {errors.end_time && (
                <p className="text-xs text-red-500">{errors.end_time.message}</p>
              )}
            </div>
          </div>

          {/* Cross-midnight warning */}
          {crossMidnight && (
            <div className="flex items-center gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2">
              <Badge variant="warning">Lintas Tengah Malam</Badge>
              <p className="text-xs text-yellow-700">
                Jam selesai lebih awal dari jam mulai — shift ini melewati tengah malam.
              </p>
            </div>
          )}

          {/* Work hours */}
          <div className="space-y-1.5">
            <Label>Jam Kerja Standar (jam) *</Label>
            <Input
              type="number"
              placeholder="8"
              min={1}
              max={24}
              {...register('work_hours_standard', { valueAsNumber: true })}
            />
            {errors.work_hours_standard && (
              <p className="text-xs text-red-500">{errors.work_hours_standard.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>Batal</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? 'Menyimpan...'
                : isEdit ? 'Simpan Perubahan' : 'Tambah Shift'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

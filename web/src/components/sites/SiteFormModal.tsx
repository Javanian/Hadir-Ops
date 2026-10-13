import { useEffect } from 'react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { sitesApi } from '@/api/sites.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess, showError } from '@/utils/toast'
import { TIMEZONE_OPTIONS } from '@/types/sites'
import type { SiteResponse } from '@/types/sites'
import { SiteMapPicker } from './SiteMapPicker'

const siteSchema = z.object({
  name: z.string().min(1, 'Nama lokasi wajib diisi'),
  latitude: z
    .number({ invalid_type_error: 'Latitude harus berupa angka' })
    .min(-90, 'Latitude minimum -90')
    .max(90, 'Latitude maksimum 90'),
  longitude: z
    .number({ invalid_type_error: 'Longitude harus berupa angka' })
    .min(-180, 'Longitude minimum -180')
    .max(180, 'Longitude maksimum 180'),
  radius_meter: z
    .number({ invalid_type_error: 'Radius harus berupa angka' })
    .int('Radius harus bilangan bulat')
    .positive('Radius harus lebih dari 0'),
  timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']),
})

type FormData = z.infer<typeof siteSchema>

interface Props {
  open: boolean
  onClose: () => void
  editingSite: SiteResponse | null
}

export function SiteFormModal({ open, onClose, editingSite }: Props) {
  const qc = useQueryClient()
  const isEdit = editingSite !== null

  const { register, handleSubmit, control, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: '',
      // NaN so Number.isFinite() → false → map shows default location on create
      latitude: NaN,
      longitude: NaN,
      radius_meter: 100,
      timezone: 'Asia/Jakarta',
    },
  })

  useEffect(() => {
    if (editingSite) {
      reset({
        name: editingSite.name,
        latitude: editingSite.latitude,
        longitude: editingSite.longitude,
        radius_meter: editingSite.radius_meter,
        timezone: editingSite.timezone as 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura',
      })
    } else {
      reset({ name: '', latitude: NaN, longitude: NaN, radius_meter: 100, timezone: 'Asia/Jakarta' })
    }
  }, [editingSite, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const watchedLat = useWatch({ control, name: 'latitude' })
  const watchedLng = useWatch({ control, name: 'longitude' })
  const watchedRadius = useWatch({ control, name: 'radius_meter' })

  // Pass null to map when value is NaN/non-finite (create mode, not yet set)
  const mapLat = Number.isFinite(watchedLat) ? watchedLat : null
  const mapLng = Number.isFinite(watchedLng) ? watchedLng : null
  const mapRadius = Number.isFinite(watchedRadius) && watchedRadius > 0 ? watchedRadius : 100

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      isEdit ? sitesApi.update(editingSite!.id, data) : sitesApi.create(data),
    onSuccess: () => {
      showSuccess(isEdit ? 'Lokasi berhasil diperbarui' : 'Lokasi berhasil ditambahkan')
      void qc.invalidateQueries({ queryKey: ['sites'] })
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
      <DialogContent className="max-w-6xl w-full max-h-[calc(100vh-4rem)] flex flex-col p-0 overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b border-border">
          <DialogTitle>
            {isEdit ? `Edit: ${editingSite?.name}` : 'Tambah Lokasi Baru'}
          </DialogTitle>
        </DialogHeader>

        {/* Body: form left | map right */}
        <div className="flex flex-row flex-1 min-h-0 overflow-hidden">

          {/* ── Left: form fields (1/4 width, scrollable) ── */}
          <form
            onSubmit={handleSubmit((d) => mutation.mutate(d))}
            className="w-1/4 min-w-[260px] flex flex-col overflow-y-auto px-6 py-4 gap-4"
          >
            {/* Nama Lokasi */}
            <div className="space-y-1.5">
              <Label>Nama Lokasi *</Label>
              <Input placeholder="cth. Site Jakarta" {...register('name')} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            {/* Latitude */}
            <div className="space-y-1.5">
              <Label>Latitude *</Label>
              <Input
                type="number"
                step="any"
                placeholder="-6.2903"
                {...register('latitude', { valueAsNumber: true })}
              />
              {errors.latitude && <p className="text-xs text-red-500">{errors.latitude.message}</p>}
            </div>

            {/* Longitude */}
            <div className="space-y-1.5">
              <Label>Longitude *</Label>
              <Input
                type="number"
                step="any"
                placeholder="106.7981"
                {...register('longitude', { valueAsNumber: true })}
              />
              {errors.longitude && <p className="text-xs text-red-500">{errors.longitude.message}</p>}
            </div>

            {/* Radius */}
            <div className="space-y-1.5">
              <Label>Radius Absensi (meter) *</Label>
              <Input
                type="number"
                placeholder="100"
                {...register('radius_meter', { valueAsNumber: true })}
              />
              {errors.radius_meter && (
                <p className="text-xs text-red-500">{errors.radius_meter.message}</p>
              )}
            </div>

            {/* Timezone */}
            <div className="space-y-1.5">
              <Label>Zona Waktu *</Label>
              <Controller
                control={control}
                name="timezone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.timezone && <p className="text-xs text-red-500">{errors.timezone.message}</p>}
            </div>

            {/* Hint */}
            <p className="text-xs text-muted-foreground">
              Klik peta atau seret marker untuk mengisi koordinat.
            </p>

            {/* Spacer pushes buttons to bottom */}
            <div className="flex-1" />

            {/* Action buttons */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? 'Menyimpan...'
                  : isEdit ? 'Simpan Perubahan' : 'Tambah Lokasi'}
              </Button>
              <Button type="button" variant="outline" onClick={handleClose}>
                Batal
              </Button>
            </div>
          </form>

          {/* Vertical divider */}
          <div className="w-px bg-border shrink-0" />

          {/* ── Right: Leaflet map (fills remaining space) ── */}
          <div className="flex-1 min-h-0 min-w-0">
            <SiteMapPicker
              latitude={mapLat}
              longitude={mapLng}
              radiusMeter={mapRadius}
              onChange={(lat, lng) => {
                setValue('latitude', lat, { shouldValidate: true })
                setValue('longitude', lng, { shouldValidate: true })
              }}
            />
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}

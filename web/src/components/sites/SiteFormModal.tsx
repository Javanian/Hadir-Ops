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
import { Field } from '@/components/ui/field'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { sitesApi } from '@/api/sites.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess, showError } from '@/utils/toast'
import { browserTimezone, isKnownTimezone, TIMEZONE_OPTIONS } from '@/types/sites'
import type { SiteResponse } from '@/types/sites'
import { SiteMapPicker } from './SiteMapPicker'
import { t } from '@/i18n'

const siteSchema = z.object({
  name: z.string().min(1, t('siteForm.siteNameIsRequired')),
  latitude: z
    .number({ error: t('siteForm.latitudeMustBeANumber') })
    .min(-90, t('siteForm.latitudeMustBeAtLeast'))
    .max(90, t('siteForm.latitudeMustBeAtMost')),
  longitude: z
    .number({ error: t('siteForm.longitudeMustBeANumber') })
    .min(-180, t('siteForm.longitudeMustBeAtLeast'))
    .max(180, t('siteForm.longitudeMustBeAtMost')),
  radius_meter: z
    .number({ error: t('siteForm.radiusMustBeANumber') })
    .int(t('siteForm.radiusMustBeAWhole'))
    .positive(t('siteForm.radiusMustBeGreaterThan')),
  timezone: z.string().refine(isKnownTimezone, t('sites.timezoneInvalid')),
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
      // Empty on create: Number.isFinite() is false, so the map shows the default
      // location. (NaN would be written into the number input, which browsers reject.)
      latitude: undefined,
      longitude: undefined,
      radius_meter: 100,
      timezone: browserTimezone(),
    },
  })

  useEffect(() => {
    if (editingSite) {
      reset({
        name: editingSite.name,
        latitude: editingSite.latitude,
        longitude: editingSite.longitude,
        radius_meter: editingSite.radius_meter,
        timezone: editingSite.timezone,
      })
    } else {
      reset({ name: '', latitude: undefined, longitude: undefined, radius_meter: 100, timezone: browserTimezone() })
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
      showSuccess(isEdit ? t('siteForm.siteUpdated') : t('siteForm.siteAdded'))
      void qc.invalidateQueries({ queryKey: ['sites'] })
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 422) {
        const detail = (err.response.data as { detail?: string })?.detail
        showError(detail ?? t('common.invalidData'))
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
            {isEdit ? t('siteForm.edit', { name: editingSite?.name }) : t('siteForm.addANewSite')}
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
            <Field error={errors.name?.message}>
              <Label>{t('siteForm.siteName')}</Label>
              <Input placeholder={t('siteForm.eGRotterdamPortTerminal')} {...register('name')} />
            </Field>

            {/* Latitude */}
            <Field error={errors.latitude?.message}>
              <Label>Latitude *</Label>
              <Input
                type="number"
                step="any"
                placeholder="-6.2903"
                {...register('latitude', { valueAsNumber: true })}
              />
            </Field>

            {/* Longitude */}
            <Field error={errors.longitude?.message}>
              <Label>Longitude *</Label>
              <Input
                type="number"
                step="any"
                placeholder="106.7981"
                {...register('longitude', { valueAsNumber: true })}
              />
            </Field>

            {/* Radius */}
            <Field error={errors.radius_meter?.message}>
              <Label>{t('siteForm.checkInRadiusMetres')}</Label>
              <Input
                type="number"
                placeholder="100"
                {...register('radius_meter', { valueAsNumber: true })}
              />
            </Field>

            {/* Timezone */}
            <Field error={errors.timezone?.message}>
              <Label>{t('siteForm.timeZone')}</Label>
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
            </Field>

            {/* Hint */}
            <p className="text-xs text-muted-foreground">
              {t('siteForm.clickTheMapOrDrag')}
            </p>

            {/* Spacer pushes buttons to bottom */}
            <div className="flex-1" />

            {/* Action buttons */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? t('common.saving')
                  : isEdit ? t('common.saveChanges') : t('common.addSite')}
              </Button>
              <Button type="button" variant="outline" onClick={handleClose}>
                {t('common.cancel')}
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

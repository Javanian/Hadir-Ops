import { useEffect } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { shiftsApi } from '@/api/shifts.api'
import { sitesApi } from '@/api/sites.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess, showError } from '@/utils/toast'
import type { ShiftResponse } from '@/types/shifts'
import { t } from '@/i18n'

const shiftSchema = z.object({
  site_id: z.number({ error: t('shiftForm.selectASite2') }),
  name: z.string().min(1, t('shiftForm.shiftNameIsRequired')),
  start_time: z.string().min(1, t('shiftForm.startTimeIsRequired')),
  end_time: z.string().min(1, t('shiftForm.endTimeIsRequired')),
  work_hours_standard: z
    .number({ error: t('shiftForm.workHoursMustBeA') })
    .int()
    .min(1, t('shiftForm.atLeast1Hour'))
    .max(24, t('shiftForm.atMost24Hours')),
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

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(shiftSchema),
    defaultValues: {
      site_id: undefined,
      name: '',
      start_time: '08:00',
      end_time: '17:00',
      work_hours_standard: 8,
    },
  })

  const watchedStart = useWatch({ control, name: 'start_time' })
  const watchedEnd = useWatch({ control, name: 'end_time' })
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
      showSuccess(isEdit ? t('shiftForm.shiftUpdated') : t('shiftForm.shiftAdded'))
      void qc.invalidateQueries({ queryKey: ['shifts'] })
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('shiftForm.editShift', { name: editingShift?.name }) : t('shiftForm.addANewShift')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          {/* Site */}
          <Field error={errors.site_id?.message}>
            <Label>{t('shiftForm.workSite')}</Label>
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
                    <SelectValue placeholder={t('common.selectASite')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('shiftForm.selectASite')}</SelectItem>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {isEdit && (
              <p className="text-xs text-text-secondary">{t('shiftForm.theSiteCannotBeChanged')}</p>
            )}
          </Field>

          {/* Name */}
          <Field error={errors.name?.message}>
            <Label>{t('shiftForm.shiftName')}</Label>
            <Input placeholder={t('shiftForm.eGMorningAfternoonNight')} {...register('name')} />
          </Field>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <Field error={errors.start_time?.message}>
              <Label>{t('shiftForm.startTime')}</Label>
              <Input type="time" {...register('start_time')} />
            </Field>
            <Field error={errors.end_time?.message}>
              <Label>{t('shiftForm.endTime')}</Label>
              <Input type="time" {...register('end_time')} />
            </Field>
          </div>

          {/* Cross-midnight warning */}
          {crossMidnight && (
            <div className="flex items-center gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2">
              <Badge variant="warning">{t('shiftForm.crossesMidnight')}</Badge>
              <p className="text-xs text-yellow-700">
                {t('shiftForm.theEndTimeIsBefore')}
              </p>
            </div>
          )}

          {/* Work hours */}
          <Field error={errors.work_hours_standard?.message}>
            <Label>{t('shiftForm.standardWorkHours')}</Label>
            <Input
              type="number"
              placeholder="8"
              min={1}
              max={24}
              {...register('work_hours_standard', { valueAsNumber: true })}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t('common.saving')
                : isEdit ? t('common.saveChanges') : t('common.addShift')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

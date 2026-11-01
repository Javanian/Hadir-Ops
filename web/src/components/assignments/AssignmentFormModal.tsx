import { useState, useEffect, useRef } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { assignmentsApi } from '@/api/assignments.api'
import { sitesApi } from '@/api/sites.api'
import { shiftsApi } from '@/api/shifts.api'
import { usersApi } from '@/api/users.api'
import { isAxiosError } from '@/api/axios'
import { showSuccess } from '@/utils/toast'
import type { UserListItem } from '@/types/users'
import { localDateISO } from '@/utils/datetime'
import { t } from '@/i18n'

const schema = z.object({
  user_id:    z.number({ error: t('assignmentForm.selectAnEmployee') }),
  site_id:    z.number({ error: t('common.selectASite') }),
  shift_id:   z.number({ error: t('assignmentForm.selectAShift2') }),
  start_date: z.string().min(1, t('assignmentForm.selectAStartDate')),
  end_date:   z.string().min(1, t('assignmentForm.selectAnEndDate')),
  notes:      z.string().optional(),
}).refine((d) => d.end_date >= d.start_date, {
  error: t('assignmentForm.endDateMustBeAfter'),
  path: ['end_date'],
})

type FormData = z.infer<typeof schema>

interface Props {
  open:    boolean
  onClose: () => void
}

function formatTime(t: string) {
  return t.slice(0, 5)
}

export function AssignmentFormModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const [userSearch, setUserSearch]         = useState('')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [selectedUser, setSelectedUser]     = useState<UserListItem | null>(null)
  const [overlapError, setOverlapError]     = useState<string | null>(null)
  const userInputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const watchedSiteId = useWatch({ control, name: 'site_id' })

  // Every way of closing goes through here, so the next open starts empty.
  const close = () => {
    reset()
    setSelectedUser(null)
    setUserSearch('')
    setOverlapError(null)
    onClose()
  }

  // Reset shift when site changes
  useEffect(() => {
    setValue('shift_id', undefined as unknown as number)
  }, [watchedSiteId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Data queries
  const { data: usersData } = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => usersApi.list({ page_size: 100 }),
    staleTime: 60_000,
    enabled: open,
  })

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    staleTime: 60_000,
    enabled: open,
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', watchedSiteId],
    queryFn: () => shiftsApi.list(watchedSiteId),
    enabled: open && !!watchedSiteId,
    staleTime: 30_000,
  })

  const allUsers: UserListItem[] = usersData?.items ?? []

  const filteredUsers = userSearch.trim()
    ? allUsers.filter((u) => {
        const q = userSearch.toLowerCase()
        return (
          u.name.toLowerCase().includes(q) ||
          u.employee_id.toLowerCase().includes(q)
        )
      })
    : allUsers.slice(0, 30)

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      assignmentsApi.create({
        ...data,
        notes: data.notes || undefined,
      }),
    onSuccess: () => {
      showSuccess(t('assignmentForm.assignmentAdded'))
      void qc.invalidateQueries({ queryKey: ['assignments'] })
      close()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 409) {
        const detail = (err.response.data as { detail?: string })?.detail
        setOverlapError(detail ?? t('assignmentForm.thisEmployeeAlreadyHasAn'))
      }
    },
  })

  const onSubmit = (data: FormData) => {
    setOverlapError(null)
    mutation.mutate(data)
  }

  const handleSelectUser = (user: UserListItem) => {
    setSelectedUser(user)
    setUserSearch(`${user.employee_id} — ${user.name}`)
    setValue('user_id', user.id, { shouldValidate: true })
    setShowUserDropdown(false)
  }

  const today = localDateISO()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle>{t('common.addAssignment')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 mt-2">

          {/* Pilih Karyawan — searchable */}
          <Field error={errors.user_id?.message}>
            <Label>{t('assignmentForm.employee')}</Label>
            <div className="relative">
              <Input
                ref={userInputRef}
                placeholder={t('assignmentForm.searchByNameOrEmployee')}
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value)
                  setSelectedUser(null)
                  setValue('user_id', undefined as unknown as number)
                  setShowUserDropdown(true)
                }}
                onFocus={() => setShowUserDropdown(true)}
                onBlur={() => {
                  // Delay to allow click on dropdown item
                  setTimeout(() => setShowUserDropdown(false), 150)
                }}
                autoComplete="off"
              />
              {showUserDropdown && filteredUsers.length > 0 && (
                <div className="absolute z-50 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-divider bg-white shadow-lg">
                  {filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors"
                      onMouseDown={() => handleSelectUser(u)}
                    >
                      <span className="font-mono text-text-secondary text-xs mr-2">{u.employee_id}</span>
                      <span className="text-text-primary">{u.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedUser && (
              <p className="text-xs text-text-secondary">
                Terpilih: <strong>{selectedUser.name}</strong> ({selectedUser.employee_id})
              </p>
            )}
          </Field>

          {/* Pilih Lokasi */}
          <Field error={errors.site_id?.message}>
            <Label>{t('assignmentForm.site')}</Label>
            <Controller
              control={control}
              name="site_id"
              render={({ field }) => (
                <Select
                  value={field.value?.toString() ?? ''}
                  onValueChange={(v) => field.onChange(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('assignmentForm.selectASite')} />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          {/* Pilih Shift */}
          <Field error={errors.shift_id?.message}>
            <Label>{t('assignmentForm.shift')}</Label>
            <Controller
              control={control}
              name="shift_id"
              render={({ field }) => (
                <Select
                  value={field.value?.toString() ?? ''}
                  onValueChange={(v) => field.onChange(parseInt(v))}
                  disabled={!watchedSiteId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={watchedSiteId ? t('assignmentForm.selectAShift') : t('assignmentForm.selectASiteFirst')} />
                  </SelectTrigger>
                  <SelectContent>
                    {shifts.map((sh) => (
                      <SelectItem key={sh.id} value={sh.id.toString()}>
                        {sh.name} ({formatTime(sh.start_time)}–{formatTime(sh.end_time)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          {/* Tanggal Mulai & Selesai */}
          <div className="grid grid-cols-2 gap-3">
            <Field error={errors.start_date?.message}>
              <Label>{t('assignmentForm.startDate')}</Label>
              <Input type="date" min={today} {...register('start_date')} />
            </Field>
            <Field error={errors.end_date?.message}>
              <Label>{t('assignmentForm.endDate')}</Label>
              <Input type="date" min={today} {...register('end_date')} />
            </Field>
          </div>

          {/* Catatan */}
          <div className="space-y-1.5">
            <Label htmlFor="assignment-notes">{t('assignmentForm.notesOptional')}</Label>
            <textarea
              id="assignment-notes"
              className="w-full px-3 py-2 text-sm border border-divider rounded-md bg-white text-text-primary placeholder:text-text-secondary focus:outline-hidden focus:ring-2 focus:ring-brand/30 resize-none"
              rows={2}
              placeholder={t('assignmentForm.reasonForTheAssignmentSpecial')}
              {...register('notes')}
            />
          </div>

          {/* Overlap error callout */}
          {overlapError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {overlapError}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-divider">
            <Button type="button" variant="outline" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('assignmentForm.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

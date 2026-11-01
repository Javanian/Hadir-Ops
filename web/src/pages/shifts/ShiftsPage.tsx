import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useTable, tableFeatures, flexRender, type ColumnDef,
} from '@tanstack/react-table'

const features = tableFeatures({})
import {
  Plus, Pencil, Trash2, RefreshCw, AlertCircle, CalendarDays,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ShiftFormModal } from '@/components/shifts/ShiftFormModal'
import { ScheduleManagerModal } from '@/components/shifts/ScheduleManagerModal'
import { shiftsApi } from '@/api/shifts.api'
import { sitesApi } from '@/api/sites.api'
import { useHasRole } from '@/hooks/useAuth'
import { showSuccess, showError } from '@/utils/toast'
import { DAY_LABELS } from '@/types/shifts'
import type { ShiftResponse } from '@/types/shifts'
import { t } from '@/i18n'
import { tRich } from '@/i18n/rich'

// The action column stays pinned to the right edge while the rest of the
// table scrolls sideways on narrow screens.
const STICKY_ACTIONS_HEAD = 'sticky right-0 bg-slate-800'
const STICKY_ACTIONS_CELL =
  'sticky right-0 bg-white group-hover:bg-surface shadow-[-12px_0_12px_-12px_rgba(15,23,42,0.25)] lg:shadow-none'

function formatTime(t: string): string {
  return t.substring(0, 5) // "HH:MM:SS" → "HH:MM"
}

function getScheduleSummary(shift: ShiftResponse): string {
  if (shift.schedules.length === 0) return '—'
  const days = shift.schedules
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .map((s) => DAY_LABELS[s.day_of_week].substring(0, 3)) // "Min", "Sen", etc.
  return days.join(', ')
}

export function ShiftsPage() {
  const qc = useQueryClient()
  const isAdmin = useHasRole('ADMIN')

  const [siteFilter, setSiteFilter] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<ShiftResponse | null>(null)
  const [deletingShift, setDeletingShift] = useState<ShiftResponse | null>(null)
  const [scheduleShift, setScheduleShift] = useState<ShiftResponse | null>(null)

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    staleTime: 5 * 60_000,
  })

  const { data: shifts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['shifts', siteFilter],
    queryFn: () => shiftsApi.list(siteFilter ?? undefined),
    staleTime: 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => shiftsApi.delete(id),
    onSuccess: () => {
      showSuccess(t('shifts.shiftDeleted'))
      void qc.invalidateQueries({ queryKey: ['shifts'] })
      setDeletingShift(null)
    },
    onError: () => showError(t('shifts.couldNotDeleteTheShift')),
  })

  const siteName = (siteId: number) =>
    sites.find((s) => s.id === siteId)?.name ?? `Site #${siteId}`

  const columns: ColumnDef<typeof features, ShiftResponse>[] = [
    {
      accessorKey: 'name',
      header: t('shifts.shiftName'),
      cell: ({ row }) => (
        <span className="font-medium text-text-primary whitespace-nowrap">{row.original.name ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'site_id',
      header: t('common.site'),
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary whitespace-nowrap">{siteName(row.original.site_id)}</span>
      ),
    },
    {
      id: 'times',
      header: t('common.workHours'),
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm whitespace-nowrap">
            {formatTime(row.original.start_time)} – {formatTime(row.original.end_time)}
          </span>
          {row.original.is_cross_midnight && (
            <Badge variant="outline" className="text-xs whitespace-nowrap">{t('shifts.1Day')}</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'work_hours_standard',
      header: t('shifts.stdHours'),
      cell: ({ row }) => (
        <span className="text-sm text-text-secondary whitespace-nowrap">{t('common.hoursCount', { count: row.original.work_hours_standard })}</span>
      ),
    },
    {
      id: 'schedule',
      header: t('common.workdays'),
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-secondary whitespace-nowrap">{getScheduleSummary(row.original)}</span>
          {row.original.schedules.length > 0 && (
            <Badge variant="success" className="text-xs">{t('common.daysCount', { count: row.original.schedules.length })}</Badge>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setScheduleShift(row.original)}
            title={t('shifts.manageSchedule')}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('shifts.schedule')}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setEditingShift(row.original); setModalOpen(true) }}
            aria-label={t('shifts.editShift', { name: row.original.name ?? '' })}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="text-red-500 hover:text-red-700 hover:bg-red-50"
              onClick={() => setDeletingShift(row.original)}
              aria-label={t('shifts.deleteShift2', { name: row.original.name ?? '' })}
              title={t('common.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  const table = useTable({
    features,
    data: shifts,
    columns,
  })

  const COLUMN_COUNT = columns.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">{t('shifts.shifts')}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {t('shifts.manageShiftSchedulesAndLate')}
          </p>
        </div>
        <Button variant="accent" onClick={() => { setEditingShift(null); setModalOpen(true) }}>
          <Plus className="h-4 w-4" />
          {t('common.addShift')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select
          value={siteFilter != null ? siteFilter.toString() : '__all__'}
          onValueChange={(v) => setSiteFilter(v === '__all__' ? null : parseInt(v))}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t('common.allSites')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('common.allSites')}</SelectItem>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${
                        h.column.id === 'actions' ? STICKY_ACTIONS_HEAD : ''
                      }`}
                    >
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-divider">
                    {Array.from({ length: COLUMN_COUNT }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-400" />
                      <p className="text-text-secondary text-sm">{t('shifts.couldNotLoadShifts')}</p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        {t('common.tryAgain')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-12 text-center text-text-secondary text-sm">
                    {t('shifts.noShiftsFound')}
                    {siteFilter && t('shifts.tryRemovingTheSiteFilter')}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="group border-t border-divider hover:bg-surface transition-colors"
                  >
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className={`px-4 py-3 ${cell.column.id === 'actions' ? STICKY_ACTIONS_CELL : ''}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shift Add/Edit Modal */}
      <ShiftFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingShift(null) }}
        editingShift={editingShift}
      />

      {/* Schedule Manager Modal */}
      <ScheduleManagerModal
        open={!!scheduleShift}
        onClose={() => setScheduleShift(null)}
        shift={scheduleShift}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingShift}
        onOpenChange={(open) => !open && setDeletingShift(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('shifts.deleteShift')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tRich('shifts.deleteConfirm', { name: <strong>{deletingShift?.name}</strong> })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingShift && deleteMutation.mutate(deletingShift.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

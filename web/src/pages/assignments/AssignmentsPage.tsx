import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RefreshCw, AlertCircle, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AssignmentFormModal } from '@/components/assignments/AssignmentFormModal'
import { assignmentsApi } from '@/api/assignments.api'
import { sitesApi } from '@/api/sites.api'
import { showSuccess, showError } from '@/utils/toast'
import { timezoneOffset } from '@/types/sites'
import type { AssignmentResponse } from '@/types/assignments'
import { localDateISO } from '@/utils/datetime'
import { intlLocale, t } from '@/i18n'
import { tRich } from '@/i18n/rich'

const fmt = new Intl.DateTimeFormat(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' })

function formatDate(d: string) {
  return fmt.format(new Date(d + 'T00:00:00'))
}

function formatTime(t: string) {
  return t.slice(0, 5)   // "HH:MM:SS" → "HH:MM"
}

function getStatus(row: AssignmentResponse): 'ACTIVE' | 'UPCOMING' | 'ENDED' {
  const today = localDateISO()
  if (row.end_date < today) return 'ENDED'
  if (row.start_date > today) return 'UPCOMING'
  return 'ACTIVE'
}

const STATUS_BADGE: Record<ReturnType<typeof getStatus>, string> = {
  ACTIVE:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  UPCOMING: 'bg-blue-100 text-blue-700 border-blue-200',
  ENDED:    'bg-slate-100 text-slate-500 border-slate-200',
}

const STATUS_LABEL: Record<ReturnType<typeof getStatus>, string> = {
  ACTIVE: t('assignments.statusActive'),
  UPCOMING: t('assignments.statusUpcoming'),
  ENDED: t('assignments.statusEnded'),
}

const COLUMNS = 6

export function AssignmentsPage() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen]         = useState(false)
  const [deleting, setDeleting]           = useState<AssignmentResponse | null>(null)
  const [filterSiteId, setFilterSiteId]   = useState<number | ''>('')
  const [activeOnly, setActiveOnly]       = useState(false)

  const { data: assignments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['assignments', filterSiteId, activeOnly],
    queryFn: () => assignmentsApi.list({
      site_id:     filterSiteId !== '' ? filterSiteId : undefined,
      active_only: activeOnly || undefined,
    }),
    staleTime: 30_000,
  })

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    staleTime: 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => assignmentsApi.delete(id),
    onSuccess: () => {
      showSuccess(t('assignments.assignmentDeleted'))
      void qc.invalidateQueries({ queryKey: ['assignments'] })
      setDeleting(null)
    },
    onError: () => showError(t('assignments.couldNotDeleteTheAssignment')),
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">{t('assignments.temporaryAssignments')}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {t('assignments.assignEmployeesToAnotherSite')}
          </p>
        </div>
        <Button variant="accent" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('common.addAssignment')}
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label={t('assignments.filterBySite')}
          className="text-sm border border-divider rounded-md px-3 py-1.5 bg-white text-text-primary focus:outline-hidden focus:ring-2 focus:ring-brand/30"
          value={filterSiteId}
          onChange={(e) => setFilterSiteId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">{t('common.allSites')}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-divider"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          {t('assignments.activeOnly')}
        </label>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  {t('common.employee')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  {t('assignments.assignedSite')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide hidden md:table-cell">
                  Shift
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide hidden md:table-cell">
                  {t('assignments.dateRange')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-divider">
                    {Array.from({ length: COLUMNS }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-400" />
                      <p className="text-text-secondary text-sm">{t('assignments.couldNotLoadAssignments')}</p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        {t('common.tryAgain')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : assignments.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <CalendarClock className="h-8 w-8 text-text-secondary" />
                      <p className="text-text-secondary text-sm">
                        {t('assignments.noAssignmentsYetAddOne')}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        {t('common.addAssignment')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                assignments.map((row) => {
                  const st = getStatus(row)
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-divider hover:bg-surface transition-colors"
                    >
                      {/* Karyawan */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{row.user.full_name}</div>
                        <div className="text-xs text-text-secondary font-mono">{row.user.employee_id}</div>
                      </td>

                      {/* Lokasi */}
                      <td className="px-4 py-3">
                        <div className="text-text-primary">{row.site.name}</div>
                        <Badge variant="info" className="mt-0.5 text-xs">
                          {timezoneOffset(row.site.timezone) || row.site.timezone}
                        </Badge>
                      </td>

                      {/* Shift */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-text-primary">{row.shift.name}</div>
                        <div className="text-xs text-text-secondary">
                          {formatTime(row.shift.start_time)}–{formatTime(row.shift.end_time)}
                        </div>
                      </td>

                      {/* Rentang Tanggal */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-text-secondary text-xs">
                          {formatDate(row.start_date)} – {formatDate(row.end_date)}
                        </span>
                        {row.notes && (
                          <p className="text-xs text-text-secondary italic mt-0.5 truncate max-w-[180px]" title={row.notes}>
                            {row.notes}
                          </p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${STATUS_BADGE[st]}`}>
                          {STATUS_LABEL[st]}
                        </span>
                      </td>

                      {/* Aksi */}
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleting(row)}
                            aria-label={t('assignments.deleteTheAssignmentOf', { full_name: row.user.full_name })}
                            title={t('common.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      <AssignmentFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assignments.deleteAssignment')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tRich('assignments.deleteConfirm', {
                name: <strong>{deleting?.user.full_name}</strong>,
                site: <strong>{deleting?.site.name}</strong>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
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

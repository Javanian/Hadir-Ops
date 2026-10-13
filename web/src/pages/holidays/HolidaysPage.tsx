import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, RefreshCw, AlertCircle, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { HolidayFormModal } from '@/components/holidays/HolidayFormModal'
import { holidaysApi } from '@/api/shifts.api'
import { showSuccess, showError } from '@/utils/toast'
import type { HolidayResponse } from '@/types/shifts'

function formatHolidayDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD" — format without timezone conversion (it's a calendar date, not a moment in time)
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export function HolidaysPage() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState<HolidayResponse | null>(null)
  const [deletingHoliday, setDeletingHoliday] = useState<HolidayResponse | null>(null)

  const { data: holidays = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['holidays'],
    queryFn: holidaysApi.list,
    staleTime: 5 * 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => holidaysApi.delete(id),
    onSuccess: () => {
      showSuccess('Hari libur berhasil dihapus')
      void qc.invalidateQueries({ queryKey: ['holidays'] })
      setDeletingHoliday(null)
    },
    onError: () => showError('Gagal menghapus hari libur'),
  })

  // Sort holidays by date ascending
  const sortedHolidays = [...holidays].sort((a, b) =>
    a.holiday_date.localeCompare(b.holiday_date)
  )

  const COLUMNS = 4

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Hari Libur</h1>
          <p className="text-sm text-text-secondary mt-1">
            Kelola hari libur nasional dan khusus perusahaan
          </p>
        </div>
        <Button variant="accent" onClick={() => { setEditingHoliday(null); setModalOpen(true) }}>
          <Plus className="h-4 w-4" />
          Tambah Hari Libur
        </Button>
      </div>

      {/* Summary */}
      {holidays.length > 0 && (
        <div className="flex gap-4">
          <div className="rounded-lg border border-divider bg-surface px-4 py-3">
            <p className="text-xs text-text-secondary">Total Hari Libur</p>
            <p className="text-2xl font-semibold text-brand">{holidays.length}</p>
          </div>
          <div className="rounded-lg border border-divider bg-surface px-4 py-3">
            <p className="text-xs text-text-secondary">Nasional</p>
            <p className="text-2xl font-semibold text-green-600">
              {holidays.filter((h) => h.is_national).length}
            </p>
          </div>
          <div className="rounded-lg border border-divider bg-surface px-4 py-3">
            <p className="text-xs text-text-secondary">Khusus</p>
            <p className="text-2xl font-semibold text-text-secondary">
              {holidays.filter((h) => !h.is_national).length}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  Tanggal
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  Keterangan
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                  Jenis
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
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
                      <p className="text-text-secondary text-sm">Gagal memuat data hari libur</p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Coba Lagi
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : sortedHolidays.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <CalendarDays className="h-8 w-8 text-text-secondary" />
                      <p className="text-text-secondary text-sm">
                        Belum ada hari libur yang terdaftar.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditingHoliday(null); setModalOpen(true) }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Tambah Hari Libur
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedHolidays.map((holiday) => (
                  <tr
                    key={holiday.id}
                    className="border-t border-divider hover:bg-surface transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-text-primary">
                          {formatHolidayDate(holiday.holiday_date)}
                        </p>
                        <p className="text-xs font-mono text-text-secondary">{holiday.holiday_date}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-primary">
                        {holiday.description ?? <span className="text-text-secondary italic">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {holiday.is_national ? (
                        <Badge variant="success">Nasional</Badge>
                      ) : (
                        <Badge variant="outline">Khusus</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setEditingHoliday(holiday); setModalOpen(true) }}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeletingHoliday(holiday)}
                          title="Hapus"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <HolidayFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingHoliday(null) }}
        editingHoliday={editingHoliday}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingHoliday}
        onOpenChange={(open) => !open && setDeletingHoliday(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Hari Libur</AlertDialogTitle>
            <AlertDialogDescription>
              Apakah Anda yakin ingin menghapus hari libur{' '}
              <strong>
                {deletingHoliday?.holiday_date}
                {deletingHoliday?.description && ` — ${deletingHoliday.description}`}
              </strong>?
              Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingHoliday && deleteMutation.mutate(deletingHoliday.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

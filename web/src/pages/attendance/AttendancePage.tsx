import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  RefreshCw, AlertCircle, Search, Download, Clock, Users, CheckCircle,
  AlertTriangle, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AttendanceDetailModal } from '@/components/attendance/AttendanceDetailModal'
import { attendanceApi } from '@/api/attendance.api'
import { useHasRole } from '@/hooks/useAuth'
import { showSuccess, showError } from '@/utils/toast'
import { formatDate, formatDuration, formatTime, localDateISO } from '@/utils/datetime'
import type { TeamAttendanceRecord, AttendanceStatus } from '@/types/attendance'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today as YYYY-MM-DD using Asia/Jakarta as reference (multi-site default) */
function todayString(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

function statusBadgeVariant(status: AttendanceStatus | null) {
  if (status === 'ONTIME') return 'success' as const
  if (status === 'LATE') return 'warning' as const
  if (status === 'OUT_OF_RADIUS') return 'danger' as const
  return 'outline' as const
}

function statusLabel(status: AttendanceStatus | null): string {
  if (status === 'ONTIME') return 'Tepat Waktu'
  if (status === 'LATE') return 'Terlambat'
  if (status === 'OUT_OF_RADIUS') return 'Di Luar Radius'
  return '—'
}

function exportCSV(records: TeamAttendanceRecord[]) {
  const headers = [
    'ID', 'ID Karyawan', 'Nama', 'Site', 'Check-in', 'Check-out',
    'Jam Kerja (menit)', 'Lembur (menit)', 'Status', 'Akhir Pekan', 'Hari Libur', 'Timezone',
  ]
  const rows = records.map((r) => [
    r.id,
    r.employee_id,
    r.employee_name,
    r.site_name ?? '',
    r.checkin_time,
    r.checkout_time ?? '',
    r.work_duration_minutes,
    r.overtime_minutes,
    r.status ?? '',
    r.is_weekend ? 'Ya' : 'Tidak',
    r.is_holiday ? 'Ya' : 'Tidak',
    r.site_timezone,
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `absensi_${localDateISO()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Stats Card ────────────────────────────────────────────────────────────────

function StatsCard({
  icon, label, value, colorClass,
}: { icon: React.ReactNode; label: string; value: number; colorClass: string }) {
  return (
    <div className="rounded-lg border border-divider bg-white px-4 py-3 flex items-center gap-3">
      <div className={`rounded-full p-2 ${colorClass}`}>{icon}</div>
      <div>
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-xl font-semibold text-text-primary">{value}</p>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const LIMIT = 500

export function AttendancePage() {
  const isAdmin = useHasRole('ADMIN')
  const qc = useQueryClient()

  const today = todayString()
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | ''>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const [selectedRecord, setSelectedRecord] = useState<TeamAttendanceRecord | null>(null)
  const [showAutoCheckoutConfirm, setShowAutoCheckoutConfirm] = useState(false)

  // ── Data fetch ──────────────────────────────────────────────────────────────

  const { data: records = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['attendance-team', fromDate, toDate, page],
    queryFn: () => attendanceApi.getTeam({
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      limit: LIMIT,
      offset: page * LIMIT,
    }),
    staleTime: 30_000,
  })

  // ── Client-side filters ─────────────────────────────────────────────────────

  const filteredRecords = useMemo(() => {
    let result = records
    if (statusFilter) {
      result = result.filter((r) => r.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (r) =>
          r.employee_id.toLowerCase().includes(q) ||
          r.employee_name.toLowerCase().includes(q),
      )
    }
    return result
  }, [records, statusFilter, search])

  // ── Stats ───────────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: filteredRecords.length,
    ontime: filteredRecords.filter((r) => r.status === 'ONTIME').length,
    late: filteredRecords.filter((r) => r.status === 'LATE').length,
    outOfRadius: filteredRecords.filter((r) => r.status === 'OUT_OF_RADIUS').length,
  }), [filteredRecords])

  // ── Auto-checkout mutation ──────────────────────────────────────────────────

  const autoCheckoutMutation = useMutation({
    mutationFn: attendanceApi.triggerAutoCheckout,
    onSuccess: (result) => {
      showSuccess(`Auto-checkout selesai: ${result.processed} record diproses.`)
      setShowAutoCheckoutConfirm(false)
      void qc.invalidateQueries({ queryKey: ['attendance-team'] })
    },
    onError: () => {
      showError('Gagal menjalankan auto-checkout.')
      setShowAutoCheckoutConfirm(false)
    },
  })

  // ── Filter reset ────────────────────────────────────────────────────────────

  const resetFilters = () => {
    setFromDate(today)
    setToDate(today)
    setStatusFilter('')
    setSearch('')
    setPage(0)
  }

  const TABLE_COLS = 7

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Monitoring Absensi</h1>
          <p className="text-sm text-text-secondary mt-1">
            {isAdmin
              ? 'Pantau seluruh data absensi karyawan di semua lokasi'
              : 'Pantau data absensi bawahan Anda'}
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="destructive"
            onClick={() => setShowAutoCheckoutConfirm(true)}
            disabled={autoCheckoutMutation.isPending}
          >
            <Clock className="h-4 w-4" />
            Trigger Auto-Checkout
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="rounded-lg border border-divider bg-surface p-4">
        <div className="flex flex-wrap gap-3">
          {/* Date range */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-text-secondary whitespace-nowrap">
              Dari:
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(0) }}
              className="h-9 rounded-md border border-divider bg-white px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-text-secondary whitespace-nowrap">
              Sampai:
            </label>
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => { setToDate(e.target.value); setPage(0) }}
              className="h-9 rounded-md border border-divider bg-white px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as AttendanceStatus | ''); setPage(0) }}
            className="h-9 rounded-md border border-divider bg-white px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            <option value="">Semua Status</option>
            <option value="ONTIME">Tepat Waktu</option>
            <option value="LATE">Terlambat</option>
            <option value="OUT_OF_RADIUS">Di Luar Radius</option>
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-secondary" />
            <input
              type="text"
              placeholder="Cari nama atau ID karyawan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-divider bg-white pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>

          {/* Actions */}
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset
          </Button>
        </div>
      </div>

      {/* Stats summary */}
      {!isLoading && !isError && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsCard
            icon={<Users className="h-4 w-4 text-brand" />}
            label="Total"
            value={stats.total}
            colorClass="bg-brand/10"
          />
          <StatsCard
            icon={<CheckCircle className="h-4 w-4 text-green-600" />}
            label="Tepat Waktu"
            value={stats.ontime}
            colorClass="bg-green-50"
          />
          <StatsCard
            icon={<AlertTriangle className="h-4 w-4 text-yellow-600" />}
            label="Terlambat"
            value={stats.late}
            colorClass="bg-yellow-50"
          />
          <StatsCard
            icon={<XCircle className="h-4 w-4 text-red-500" />}
            label="Di Luar Radius"
            value={stats.outOfRadius}
            colorClass="bg-red-50"
          />
        </div>
      )}

      {/* Export + Pagination info */}
      {!isLoading && !isError && filteredRecords.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            Menampilkan <strong>{filteredRecords.length}</strong> dari{' '}
            <strong>{records.length}</strong> record
            {records.length === LIMIT && ' (batas maksimum halaman ini)'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCSV(filteredRecords)}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide">
                  ID Karyawan
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide">
                  Nama
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide hidden md:table-cell">
                  Site
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide">
                  Check-in / Check-out
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide hidden md:table-cell">
                  Durasi
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide hidden lg:table-cell">
                  Keterangan
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t border-divider">
                    {Array.from({ length: TABLE_COLS }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={TABLE_COLS} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-400" />
                      <p className="text-text-secondary text-sm">Gagal memuat data absensi</p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Coba Lagi
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLS} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Users className="h-8 w-8 text-text-secondary" />
                      <p className="text-text-secondary text-sm">
                        {records.length === 0
                          ? 'Tidak ada data absensi untuk rentang tanggal ini.'
                          : 'Tidak ada data yang sesuai dengan filter yang dipilih.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => {
                  const tz = record.site_timezone
                  return (
                    <tr
                      key={record.id}
                      className="border-t border-divider hover:bg-surface transition-colors cursor-pointer"
                      onClick={() => setSelectedRecord(record)}
                    >
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-xs text-text-secondary">
                          {record.employee_id}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left">
                        <span className="font-medium text-text-primary">{record.employee_name}</span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-center">
                        <span className="text-xs text-text-secondary">
                          {record.site_name ?? '—'}
                        </span>
                      </td>
                      {/* Check-in / Check-out stacked: date kiri, time kanan */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col gap-0.5">
                          {/* Check-in */}
                          <div className="flex items-center justify-between gap-2 min-w-[140px]">
                            <span className="text-[10px] text-text-secondary whitespace-nowrap">
                              {formatDate(record.checkin_time, tz)}
                            </span>
                            <span className="text-xs font-medium text-text-primary whitespace-nowrap">
                              {formatTime(record.checkin_time, tz)}
                            </span>
                          </div>
                          <div className="border-t border-divider" />
                          {/* Check-out */}
                          {record.checkout_time ? (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-text-secondary whitespace-nowrap">
                                {formatDate(record.checkout_time, tz)}
                              </span>
                              <span className="text-xs font-medium text-text-primary whitespace-nowrap">
                                {formatTime(record.checkout_time, tz)}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center">
                              <span className="text-xs text-text-secondary italic">Belum checkout</span>
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Durasi: Reguler dan Overtime ditumpuk */}
                      <td className="px-4 py-3 hidden md:table-cell text-center">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-2 min-w-[100px]">
                            <span className="text-[10px] font-semibold text-blue-600 whitespace-nowrap">
                              Reguler
                            </span>
                            <span className="text-xs text-text-secondary whitespace-nowrap">
                              {record.work_duration_minutes > 0
                                ? formatDuration(record.work_duration_minutes)
                                : '—'}
                            </span>
                          </div>
                          <div className="border-t border-divider" />
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold text-orange-500 whitespace-nowrap">
                              Overtime
                            </span>
                            <span className="text-xs text-text-secondary whitespace-nowrap">
                              {record.overtime_minutes > 0
                                ? formatDuration(record.overtime_minutes)
                                : '—'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={statusBadgeVariant(record.status)}>
                          {statusLabel(record.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {record.is_weekend && (
                            <Badge variant="info" className="text-xs">Akhir Pekan</Badge>
                          )}
                          {record.is_holiday && (
                            <Badge variant="warning" className="text-xs">Hari Libur</Badge>
                          )}
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

      {/* Load more */}
      {records.length === LIMIT && !isLoading && !isError && (
        <div className="flex justify-center gap-4">
          {page > 0 && (
            <Button variant="outline" onClick={() => setPage((p) => p - 1)}>
              ← Sebelumnya
            </Button>
          )}
          <Button variant="outline" onClick={() => setPage((p) => p + 1)}>
            Berikutnya →
          </Button>
        </div>
      )}
      {page > 0 && records.length < LIMIT && !isLoading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setPage((p) => p - 1)}>
            ← Sebelumnya
          </Button>
        </div>
      )}

      {/* Detail Modal */}
      <AttendanceDetailModal
        record={selectedRecord}
        open={selectedRecord != null}
        onClose={() => setSelectedRecord(null)}
      />

      {/* Auto-checkout Confirmation */}
      <AlertDialog
        open={showAutoCheckoutConfirm}
        onOpenChange={(open) => !open && setShowAutoCheckoutConfirm(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trigger Auto-Checkout</AlertDialogTitle>
            <AlertDialogDescription>
              Proses ini akan secara otomatis melakukan checkout untuk semua karyawan yang
              melewati waktu akhir shift tetapi belum melakukan checkout.
              Tindakan ini tidak dapat dibatalkan. Lanjutkan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => autoCheckoutMutation.mutate()}
              disabled={autoCheckoutMutation.isPending}
            >
              {autoCheckoutMutation.isPending ? 'Memproses...' : 'Ya, Jalankan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

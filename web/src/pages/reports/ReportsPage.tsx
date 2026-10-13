import { useState, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Search, Download, FileBarChart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { attendanceApi } from '@/api/attendance.api'
import { formatDate, formatTime, formatDuration } from '@/utils/datetime'
import type { TeamAttendanceRecord, AttendanceStatus } from '@/types/attendance'

// ── Schema ────────────────────────────────────────────────────────────────────

const reportSchema = z
  .object({
    from_date: z.string().min(1, 'Wajib diisi'),
    to_date: z.string().min(1, 'Wajib diisi'),
    employee_search: z.string().optional(),
    status_filter: z.enum(['', 'ONTIME', 'LATE', 'OUT_OF_RADIUS']).optional(),
  })
  .refine(
    ({ from_date, to_date }) => {
      if (!from_date || !to_date) return true
      const diff =
        (new Date(to_date).getTime() - new Date(from_date).getTime()) / 86_400_000
      return diff >= 0 && diff <= 30
    },
    { message: 'Rentang tanggal maksimal 31 hari', path: ['to_date'] },
  )

type ReportFormValues = z.infer<typeof reportSchema>

interface QueryParams {
  from_date: string
  to_date: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function exportCSV(records: TeamAttendanceRecord[], fromDate: string, toDate: string) {
  const BOM = '\uFEFF'
  const headers = [
    'No',
    'Nama',
    'ID Karyawan',
    'Tanggal',
    'Jam Masuk',
    'Jam Keluar',
    'Durasi (menit)',
    'Lembur (menit)',
    'Status',
    'Timezone',
  ]
  const rows = records.map((r, i) => [
    i + 1,
    `"${r.employee_name}"`,
    r.employee_id,
    formatDate(r.checkin_time, r.site_timezone),
    formatTime(r.checkin_time, r.site_timezone),
    r.checkout_time ? formatTime(r.checkout_time, r.site_timezone) : '',
    r.work_duration_minutes,
    r.overtime_minutes,
    r.status ?? '',
    r.site_timezone,
  ])
  const csvContent =
    BOM + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `laporan_absensi_${fromDate}_${toDate}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function thirtyDaysAgoStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 29)
  return d.toISOString().slice(0, 10)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [queryParams, setQueryParams] = useState<QueryParams | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      from_date: thirtyDaysAgoStr(),
      to_date: todayStr(),
      employee_search: '',
      status_filter: '',
    },
  })

  const employeeSearch = watch('employee_search') ?? ''
  const statusFilter = watch('status_filter') ?? ''

  // Manual-trigger query — only runs after form submit
  const { data: rawData, isFetching } = useQuery({
    queryKey: ['reports', queryParams],
    queryFn: () =>
      attendanceApi.getTeam({
        from_date: queryParams!.from_date,
        to_date: queryParams!.to_date,
        limit: 1000,
      }),
    enabled: queryParams !== null,
    staleTime: 60_000,
  })

  // Client-side filtering
  const filteredData = useMemo(() => {
    if (!rawData) return []
    let result = rawData
    if (employeeSearch.trim()) {
      const q = employeeSearch.trim().toLowerCase()
      result = result.filter(
        (r) =>
          r.employee_name.toLowerCase().includes(q) ||
          r.employee_id.toLowerCase().includes(q),
      )
    }
    if (statusFilter) {
      result = result.filter((r) => r.status === statusFilter)
    }
    return result
  }, [rawData, employeeSearch, statusFilter])

  // Summary stats (from filtered data)
  const summary = useMemo(() => {
    const total = filteredData.length
    const ontime = filteredData.filter((r) => r.status === 'ONTIME').length
    const late = filteredData.filter((r) => r.status === 'LATE').length
    const outOfRadius = filteredData.filter((r) => r.status === 'OUT_OF_RADIUS').length
    const totalWork = filteredData.reduce((acc, r) => acc + r.work_duration_minutes, 0)
    const totalOvertime = filteredData.reduce((acc, r) => acc + r.overtime_minutes, 0)
    const avgWork = total > 0 ? Math.round(totalWork / total) : 0
    const ontimePct = total > 0 ? Math.round((ontime / total) * 100) : 0
    const latePct = total > 0 ? Math.round((late / total) * 100) : 0
    const outPct = total > 0 ? Math.round((outOfRadius / total) * 100) : 0
    return { total, ontime, late, outOfRadius, avgWork, totalOvertime, ontimePct, latePct, outPct }
  }, [filteredData])

  function onSubmit(values: ReportFormValues) {
    setQueryParams({ from_date: values.from_date, to_date: values.to_date })
  }

  const hasData = rawData !== undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Laporan Absensi</h1>
        <p className="text-text-secondary text-sm mt-1">
          Buat laporan berdasarkan rentang tanggal dan filter karyawan.
        </p>
      </div>

      {/* Filter form */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="rounded-2xl border border-slate-200/80 bg-white shadow-soft p-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* From date */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Dari Tanggal
            </label>
            <input
              type="date"
              {...register('from_date')}
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            {errors.from_date && (
              <p className="text-xs text-red-500 mt-1">{errors.from_date.message}</p>
            )}
          </div>

          {/* To date */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Sampai Tanggal
            </label>
            <input
              type="date"
              {...register('to_date')}
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            {errors.to_date && (
              <p className="text-xs text-red-500 mt-1">{errors.to_date.message}</p>
            )}
          </div>

          {/* Employee search */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Nama / ID Karyawan
            </label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled"
              />
              <input
                type="text"
                placeholder="Cari..."
                {...register('employee_search')}
                className="w-full rounded-lg border border-divider pl-8 pr-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
          </div>

          {/* Status filter */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Status
            </label>
            <select
              {...register('status_filter')}
              className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 bg-white"
            >
              <option value="">Semua Status</option>
              <option value="ONTIME">Tepat Waktu</option>
              <option value="LATE">Terlambat</option>
              <option value="OUT_OF_RADIUS">Di Luar Radius</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={isFetching} className="gap-2">
            <FileBarChart size={16} />
            {isFetching ? 'Memuat...' : 'Buat Laporan'}
          </Button>
        </div>
      </form>

      {/* Summary cards — shown only after first fetch */}
      {isFetching ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : hasData ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatsCard
            icon={<span className="text-base font-bold">#</span>}
            title="Total Hadir"
            value={summary.total}
            variant="default"
          />
          <StatsCard
            icon={<span className="text-base">✓</span>}
            title="Tepat Waktu"
            value={summary.ontime}
            subtitle={`${summary.ontimePct}%`}
            variant="success"
          />
          <StatsCard
            icon={<span className="text-base">⏰</span>}
            title="Terlambat"
            value={summary.late}
            subtitle={`${summary.latePct}%`}
            variant="warning"
          />
          <StatsCard
            icon={<span className="text-base">📍</span>}
            title="Di Luar Radius"
            value={summary.outOfRadius}
            subtitle={`${summary.outPct}%`}
            variant="danger"
          />
          <StatsCard
            icon={<span className="text-base">⌛</span>}
            title="Rata-rata Durasi"
            value={formatDuration(summary.avgWork)}
            variant="default"
          />
          <StatsCard
            icon={<span className="text-base">📈</span>}
            title="Total Lembur"
            value={formatDuration(summary.totalOvertime)}
            variant="default"
          />
        </div>
      ) : null}

      {/* Results table — shown only after first fetch */}
      {isFetching ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-soft overflow-hidden">
          <div className="p-4">
            <Skeleton className="h-8 w-48" />
          </div>
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ) : hasData ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-soft overflow-hidden">
          {/* Table header row */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-divider">
            <p className="text-sm text-text-secondary">
              {filteredData.length} dari {rawData?.length ?? 0} record
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={filteredData.length === 0}
              onClick={() =>
                exportCSV(filteredData, queryParams!.from_date, queryParams!.to_date)
              }
              className="gap-2"
            >
              <Download size={14} />
              Export CSV
            </Button>
          </div>

          {filteredData.length === 0 ? (
            <p className="text-center text-sm text-text-disabled py-12">
              Tidak ada data untuk filter yang dipilih.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-3 py-2 text-center font-medium w-10">No</th>
                    <th className="px-3 py-2 text-left font-medium">Nama</th>
                    <th className="px-3 py-2 text-left font-medium hidden md:table-cell">
                      ID Karyawan
                    </th>
                    <th className="px-3 py-2 text-center font-medium">Tanggal</th>
                    <th className="px-3 py-2 text-center font-medium">Check-In</th>
                    <th className="px-3 py-2 text-center font-medium hidden lg:table-cell">
                      Check-Out
                    </th>
                    <th className="px-3 py-2 text-center font-medium hidden lg:table-cell">
                      Durasi
                    </th>
                    <th className="px-3 py-2 text-center font-medium hidden xl:table-cell">
                      Lembur
                    </th>
                    <th className="px-3 py-2 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((rec, idx) => (
                    <tr key={rec.id} className="border-b border-divider hover:bg-surface">
                      <td className="px-3 py-2 text-center text-text-disabled text-xs">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 font-medium text-text-primary">
                        {rec.employee_name}
                      </td>
                      <td className="px-3 py-2 text-text-secondary hidden md:table-cell">
                        {rec.employee_id}
                      </td>
                      <td className="px-3 py-2 text-center text-text-secondary">
                        {formatDate(rec.checkin_time, rec.site_timezone)}
                      </td>
                      <td className="px-3 py-2 text-center text-text-secondary">
                        {formatTime(rec.checkin_time, rec.site_timezone)}
                      </td>
                      <td className="px-3 py-2 text-center text-text-secondary hidden lg:table-cell">
                        {rec.checkout_time
                          ? formatTime(rec.checkout_time, rec.site_timezone)
                          : <span className="text-text-disabled">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center text-text-secondary hidden lg:table-cell">
                        {rec.work_duration_minutes > 0
                          ? formatDuration(rec.work_duration_minutes)
                          : <span className="text-text-disabled">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center text-text-secondary hidden xl:table-cell">
                        {rec.overtime_minutes > 0
                          ? formatDuration(rec.overtime_minutes)
                          : <span className="text-text-disabled">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={statusBadgeVariant(rec.status)}>
                          {statusLabel(rec.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, CheckCircle, Clock, AlertCircle, CalendarX } from 'lucide-react'
import { attendanceApi } from '@/api/attendance.api'
import { overtimeApi } from '@/api/overtime.api'
import { leaveApi } from '@/api/leave.api'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { AttendanceChart } from '@/components/dashboard/AttendanceChart'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/store/authStore'
import { daysAgoISO, formatTime } from '@/utils/datetime'
import type { BadgeProps } from '@/components/ui/badge'

function statusBadgeVariant(status: string | null): BadgeProps['variant'] {
  if (status === 'ONTIME') return 'success'
  if (status === 'LATE') return 'warning'
  if (status === 'OUT_OF_RADIUS') return 'danger'
  return 'outline'
}

function statusLabel(status: string | null): string {
  if (status === 'ONTIME') return 'Tepat Waktu'
  if (status === 'LATE') return 'Terlambat'
  if (status === 'OUT_OF_RADIUS') return 'Di Luar Radius'
  return '—'
}

export function DashboardPage() {
  const { user } = useAuthStore()

  const tz = user?.site_timezone ?? undefined
  const today = daysAgoISO(0, tz)
  const sevenDaysAgo = daysAgoISO(6, tz)

  // Q1 — today's attendance (auto-refresh 30s, also drives recent activity)
  const { data: todayRecords = [], isLoading: todayLoading } = useQuery({
    queryKey: ['attendance', 'dashboard-today', today],
    queryFn: () => attendanceApi.getTeam({ from_date: today, to_date: today }),
    refetchInterval: 30_000,
    staleTime: 0,
  })

  // Q2 — last 7 days for chart
  const { data: weekRecords = [], isLoading: weekLoading } = useQuery({
    queryKey: ['attendance', 'dashboard-week', sevenDaysAgo, today],
    queryFn: () => attendanceApi.getTeam({ from_date: sevenDaysAgo, to_date: today }),
    staleTime: 60_000,
  })

  // Q3 — pending overtime count
  const { data: pendingOT = [], isLoading: otLoading } = useQuery({
    queryKey: ['overtime', 'dashboard-pending'],
    queryFn: () => overtimeApi.list({ status: 'PENDING', limit: 200 }),
    staleTime: 30_000,
  })

  // Q4 — approved leave covering today, and requests waiting for a decision
  const { data: onLeave = [], isLoading: leaveLoading } = useQuery({
    queryKey: ['leave', 'today', today],
    queryFn: () => leaveApi.listTeam({ status: 'APPROVED', from_date: today, to_date: today, limit: 500 }),
    staleTime: 60_000,
  })
  const { data: pendingLeave = [] } = useQuery({
    queryKey: ['leave', 'pending'],
    queryFn: () => leaveApi.listTeam({ status: 'PENDING', limit: 500 }),
    staleTime: 30_000,
  })

  const ontimeCount = useMemo(
    () => todayRecords.filter((r) => r.status === 'ONTIME').length,
    [todayRecords],
  )
  const lateCount = useMemo(
    () => todayRecords.filter((r) => r.status === 'LATE').length,
    [todayRecords],
  )

  // Last 10 today's records sorted by checkin_time DESC
  const recentActivity = useMemo(
    () =>
      [...todayRecords]
        .sort((a, b) => b.checkin_time.localeCompare(a.checkin_time))
        .slice(0, 10),
    [todayRecords],
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Dashboard</h1>
        <p className="text-text-secondary text-sm mt-1">
          Selamat datang,{' '}
          <span className="font-medium text-text-primary">{user?.name}</span>
          {user?.site_timezone && (
            <span className="ml-2 text-xs bg-brand/10 text-brand px-2 py-0.5 rounded-full">
              {user.site_timezone}
            </span>
          )}
          <span className="ml-2 text-xs text-text-disabled">
            · Update otomatis setiap 30 detik
          </span>
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4">
        <StatsCard
          icon={<Users size={20} />}
          title="Hadir Hari Ini"
          value={todayRecords.length}
          loading={todayLoading}
          variant="default"
        />
        <StatsCard
          icon={<CheckCircle size={20} />}
          title="Tepat Waktu"
          value={ontimeCount}
          loading={todayLoading}
          variant="success"
        />
        <StatsCard
          icon={<Clock size={20} />}
          title="Terlambat"
          value={lateCount}
          loading={todayLoading}
          variant="warning"
        />
        <StatsCard
          icon={<AlertCircle size={20} />}
          title="Lembur Pending"
          value={pendingOT.length}
          loading={otLoading}
          variant="danger"
        />
        <StatsCard
          icon={<CalendarX size={20} />}
          title="Izin / Cuti Hari Ini"
          value={onLeave.length}
          loading={leaveLoading}
          variant="default"
          subtitle={pendingLeave.length > 0 ? `${pendingLeave.length} pengajuan menunggu` : undefined}
        />
      </div>

      {/* 7-day trend chart */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-soft p-6">
        <h2 className="text-base font-semibold text-text-primary mb-4">
          Tren Absensi — 7 Hari Terakhir
        </h2>
        <AttendanceChart records={weekRecords} loading={weekLoading} />
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-soft p-6">
        <h2 className="text-base font-semibold text-text-primary mb-4">Aktivitas Hari Ini</h2>

        {todayLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 bg-surface rounded animate-pulse" />
            ))}
          </div>
        ) : recentActivity.length === 0 ? (
          <p className="text-center text-sm text-text-disabled py-8">
            Belum ada aktivitas hari ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-3 py-2 text-left font-medium rounded-tl-lg">Nama</th>
                  <th className="px-3 py-2 text-left font-medium">ID Karyawan</th>
                  <th className="px-3 py-2 text-center font-medium">Check-In</th>
                  <th className="px-3 py-2 text-center font-medium rounded-tr-lg">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((rec) => (
                  <tr key={rec.id} className="border-b border-divider hover:bg-surface">
                    <td className="px-3 py-2 font-medium text-text-primary">{rec.employee_name}</td>
                    <td className="px-3 py-2 text-text-secondary">{rec.employee_id}</td>
                    <td className="px-3 py-2 text-center text-text-secondary">
                      {formatTime(rec.checkin_time, rec.site_timezone)}
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
            {todayRecords.length > 10 && (
              <p className="mt-2 text-center text-xs text-text-disabled">
                Menampilkan 10 dari {todayRecords.length} check-in hari ini
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

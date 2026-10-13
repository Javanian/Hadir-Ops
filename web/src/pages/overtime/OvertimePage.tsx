import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { OvertimeDetailDrawer } from '@/components/overtime/OvertimeDetailDrawer'
import { overtimeApi } from '@/api/overtime.api'
import { formatDuration } from '@/utils/datetime'
import type { OvertimeRequest, OvertimeStatus } from '@/types/overtime'

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusBadgeVariant(status: OvertimeStatus) {
  if (status === 'APPROVED') return 'success' as const
  if (status === 'REJECTED') return 'danger' as const
  return 'warning' as const // PENDING
}

function statusLabel(status: OvertimeStatus) {
  if (status === 'APPROVED') return 'Disetujui'
  if (status === 'REJECTED') return 'Ditolak'
  return 'Menunggu'
}

/**
 * Format a UTC ISO timestamp for the list table.
 * Uses browser locale (no explicit timezone) — pragmatic since the OT response
 * doesn't include site_timezone. The detail drawer uses the correct site timezone.
 */
function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

type StatusTab = '' | OvertimeStatus

const STATUS_TABS: Array<{ value: StatusTab; label: string }> = [
  { value: '', label: 'Semua' },
  { value: 'PENDING', label: 'Menunggu' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'REJECTED', label: 'Ditolak' },
]

const LIMIT = 200

// ── Component ─────────────────────────────────────────────────────────────────

export function OvertimePage() {
  const [activeTab, setActiveTab] = useState<StatusTab>('')
  const [search, setSearch] = useState('')
  const [selectedRequest, setSelectedRequest] = useState<OvertimeRequest | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['overtime', activeTab],
    queryFn: () => overtimeApi.list({ status: activeTab || undefined, limit: LIMIT }),
    staleTime: 30_000,
    retry: false,
  })

  // Client-side search: filter by ID or attendance_id
  const filteredData = useMemo(() => {
    if (!data) return []
    if (!search.trim()) return data
    const q = search.trim().toLowerCase()
    return data.filter(
      (r) =>
        String(r.id).includes(q) ||
        String(r.attendance_id).includes(q),
    )
  }, [data, search])

  // Summary counts (derived from current tab's data)
  const counts = useMemo(
    () => ({
      pending: (data ?? []).filter((r) => r.status === 'PENDING').length,
      approved: (data ?? []).filter((r) => r.status === 'APPROVED').length,
      rejected: (data ?? []).filter((r) => r.status === 'REJECTED').length,
    }),
    [data],
  )

  function openDetail(req: OvertimeRequest) {
    setSelectedRequest(req)
    setDrawerOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Manajemen Lembur</h1>
          <p className="text-sm text-text-secondary mt-1">
            Review dan setujui pengajuan lembur karyawan
          </p>
        </div>
        <Button variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Status Tab Filter */}
      <div className="flex items-center gap-0 border-b border-divider">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.value
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Summary cards — shown when "All" tab is active */}
      {activeTab === '' && !isLoading && data && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-divider bg-surface p-4">
            <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Menunggu</p>
            <p className="text-2xl font-bold text-yellow-500 mt-1">{counts.pending}</p>
          </div>
          <div className="rounded-lg border border-divider bg-surface p-4">
            <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Disetujui</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{counts.approved}</p>
          </div>
          <div className="rounded-lg border border-divider bg-surface p-4">
            <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Ditolak</p>
            <p className="text-2xl font-bold text-red-500 mt-1">{counts.rejected}</p>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Cari ID pengajuan atau ID absensi..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {!isLoading && data && (
          <p className="text-sm text-text-secondary">
            {filteredData.length} dari {data.length} pengajuan
          </p>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                  # Pengajuan
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                  # Absensi
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                  Mulai Lembur
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap hidden md:table-cell">
                  Selesai Lembur
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap hidden md:table-cell">
                  Durasi
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap hidden lg:table-cell">
                  Diajukan Pada
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-divider">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-400" />
                      <p className="text-text-secondary text-sm">Gagal memuat data lembur.</p>
                      <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Coba Lagi
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-text-secondary text-sm">
                    Tidak ada pengajuan lembur ditemukan.
                  </td>
                </tr>
              ) : (
                filteredData.map((req) => (
                  <tr
                    key={req.id}
                    className="border-t border-divider hover:bg-surface transition-colors cursor-pointer"
                    onClick={() => openDetail(req)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm text-text-secondary">#{req.id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-medium text-text-primary">
                        #{req.attendance_id}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      {fmtDateTime(req.requested_start)}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-text-primary">
                      {fmtDateTime(req.requested_end)}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-center text-text-secondary">
                      {formatDuration(req.requested_minutes)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={statusBadgeVariant(req.status)}>
                        {statusLabel(req.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-text-secondary text-xs">
                      {fmtDateTime(req.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Drawer */}
      <OvertimeDetailDrawer
        request={selectedRequest}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false)
          setSelectedRequest(null)
        }}
      />
    </div>
  )
}

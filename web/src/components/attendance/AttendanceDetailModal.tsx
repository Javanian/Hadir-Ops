import { useQuery } from '@tanstack/react-query'
import { ExternalLink, MapPin, RefreshCw, AlertCircle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { attendanceApi } from '@/api/attendance.api'
import { formatDateTime, formatDuration } from '@/utils/datetime'
import type { TeamAttendanceRecord, AttendanceStatus } from '@/types/attendance'

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

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-divider last:border-0">
      <span className="text-xs font-medium text-text-secondary uppercase tracking-wide w-36 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-text-primary flex-1">{children}</span>
    </div>
  )
}

interface Props {
  record: TeamAttendanceRecord | null
  open: boolean
  onClose: () => void
}

export function AttendanceDetailModal({ record, open, onClose }: Props) {
  const { data: detail, isLoading, isError, refetch } = useQuery({
    queryKey: ['attendance-detail', record?.id],
    queryFn: () => attendanceApi.getById(record!.id),
    enabled: open && record != null,
    staleTime: 30_000,
  })

  const tz = record?.site_timezone ?? 'Asia/Jakarta'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Absensi</DialogTitle>
          <DialogDescription>
            {record ? `${record.employee_name} (${record.employee_id})` : ''}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 mt-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex gap-3 py-2">
                <Skeleton className="h-4 w-36 flex-shrink-0" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-text-secondary">Gagal memuat detail absensi</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Coba Lagi
            </Button>
          </div>
        ) : detail && record ? (
          <div className="mt-2 divide-y divide-divider rounded-md border border-divider px-4">
            {/* Karyawan */}
            <div className="py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                Karyawan
              </p>
              <DetailRow label="ID Karyawan">{record.employee_id}</DetailRow>
              <DetailRow label="Nama">{record.employee_name}</DetailRow>
            </div>

            {/* Waktu */}
            <div className="py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                Waktu
              </p>
              <DetailRow label="Check-in">
                {formatDateTime(record.checkin_time, tz)}
              </DetailRow>
              <DetailRow label="Check-out">
                {record.checkout_time
                  ? formatDateTime(record.checkout_time, tz)
                  : <span className="text-text-secondary italic">Belum checkout</span>}
              </DetailRow>
              {detail.auto_checkout && (
                <DetailRow label="Keterangan">
                  <Badge variant="info">Auto Checkout</Badge>
                </DetailRow>
              )}
            </div>

            {/* Durasi */}
            <div className="py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                Durasi
              </p>
              <DetailRow label="Jam Kerja">
                {record.work_duration_minutes > 0
                  ? formatDuration(record.work_duration_minutes)
                  : <span className="text-text-secondary italic">—</span>}
              </DetailRow>
              <DetailRow label="Lembur">
                {record.overtime_minutes > 0
                  ? formatDuration(record.overtime_minutes)
                  : <span className="text-text-secondary italic">—</span>}
              </DetailRow>
            </div>

            {/* Status */}
            <div className="py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                Status
              </p>
              <DetailRow label="Status Absensi">
                <Badge variant={statusBadgeVariant(record.status)}>
                  {statusLabel(record.status)}
                </Badge>
              </DetailRow>
              {record.is_weekend && (
                <DetailRow label="Hari Libur">
                  <Badge variant="info">Akhir Pekan</Badge>
                </DetailRow>
              )}
              {record.is_holiday && (
                <DetailRow label="Hari Libur">
                  <Badge variant="warning">Hari Libur Nasional</Badge>
                </DetailRow>
              )}
            </div>

            {/* GPS */}
            <div className="py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                Lokasi GPS
              </p>
              {detail.latitude != null && detail.longitude != null ? (
                <DetailRow label="Koordinat">
                  <a
                    href={`https://maps.google.com/?q=${detail.latitude},${detail.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-brand hover:underline font-mono text-xs"
                  >
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                    {detail.latitude.toFixed(6)}, {detail.longitude.toFixed(6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </DetailRow>
              ) : (
                <DetailRow label="Koordinat">
                  <span className="text-text-secondary italic">Tidak tersedia</span>
                </DetailRow>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

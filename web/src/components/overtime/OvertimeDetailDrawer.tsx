import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, RefreshCw, AlertCircle, MapPin, ExternalLink } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { overtimeApi } from '@/api/overtime.api'
import { attendanceApi } from '@/api/attendance.api'
import { useHasRole } from '@/hooks/useAuth'
import { showSuccess, showError } from '@/utils/toast'
import { formatDateTime, formatDuration } from '@/utils/datetime'
import type { OvertimeRequest, OvertimeStatus } from '@/types/overtime'

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusBadgeVariant(status: OvertimeStatus) {
  if (status === 'APPROVED') return 'success' as const
  if (status === 'REJECTED') return 'danger' as const
  return 'warning' as const
}

function statusLabel(status: OvertimeStatus) {
  if (status === 'APPROVED') return 'Disetujui'
  if (status === 'REJECTED') return 'Ditolak'
  return 'Menunggu'
}

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-divider last:border-0">
      <span className="text-xs font-medium text-text-secondary uppercase tracking-wide w-32 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-text-primary flex-1">{children}</span>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  request: OvertimeRequest | null
  open: boolean
  onClose: () => void
}

export function OvertimeDetailDrawer({ request, open, onClose }: Props) {
  const qc = useQueryClient()
  const canApproveOrReject = useHasRole('ADMIN', 'SUPERVISOR')
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null)

  // Fetch fresh overtime detail (ensures up-to-date status before approve/reject)
  const {
    data: overtime,
    isLoading: otLoading,
    isError: otError,
    refetch: refetchOT,
  } = useQuery({
    queryKey: ['overtime-detail', request?.id],
    queryFn: () => overtimeApi.getById(request!.id),
    enabled: open && request != null,
    staleTime: 10_000,
  })

  // Fetch linked attendance for site_timezone + checkin/checkout context
  const { data: attendance, isLoading: attLoading } = useQuery({
    queryKey: ['attendance-detail', request?.attendance_id],
    queryFn: () => attendanceApi.getById(request!.attendance_id),
    enabled: open && request != null,
    staleTime: 60_000,
  })

  const isLoading = otLoading || attLoading
  // Use site_timezone from attendance for accurate timestamp display
  const tz = attendance?.site_timezone ?? 'Asia/Jakarta'

  const approveMutation = useMutation({
    mutationFn: () => overtimeApi.approve(request!.id),
    onSuccess: () => {
      showSuccess('Pengajuan lembur berhasil disetujui')
      void qc.invalidateQueries({ queryKey: ['overtime'] })
      void qc.invalidateQueries({ queryKey: ['overtime-detail', request?.id] })
      onClose()
    },
    onError: () => showError('Gagal menyetujui pengajuan lembur'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => overtimeApi.reject(request!.id),
    onSuccess: () => {
      showSuccess('Pengajuan lembur berhasil ditolak')
      void qc.invalidateQueries({ queryKey: ['overtime'] })
      void qc.invalidateQueries({ queryKey: ['overtime-detail', request?.id] })
      onClose()
    },
    onError: () => showError('Gagal menolak pengajuan lembur'),
  })

  const isMutating = approveMutation.isPending || rejectMutation.isPending

  function handleConfirm() {
    if (confirmAction === 'approve') approveMutation.mutate()
    else if (confirmAction === 'reject') rejectMutation.mutate()
    setConfirmAction(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Pengajuan Lembur</DialogTitle>
            <DialogDescription>
              {request
                ? `Pengajuan #${request.id} — Absensi #${request.attendance_id}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-3 mt-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex gap-3 py-2">
                  <Skeleton className="h-4 w-32 flex-shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : otError ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-text-secondary">Gagal memuat detail pengajuan</p>
              <Button variant="outline" size="sm" onClick={() => void refetchOT()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Coba Lagi
              </Button>
            </div>
          ) : overtime ? (
            <div className="mt-2 divide-y divide-divider rounded-md border border-divider px-4">

              {/* Status pengajuan */}
              <div className="py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                  Status Pengajuan
                </p>
                <DetailRow label="Status">
                  <Badge variant={statusBadgeVariant(overtime.status)}>
                    {statusLabel(overtime.status)}
                  </Badge>
                </DetailRow>
                <DetailRow label="ID Pengajuan">
                  <span className="font-mono">#{overtime.id}</span>
                </DetailRow>
                <DetailRow label="Diajukan Pada">
                  {formatDateTime(overtime.created_at, tz)}
                </DetailRow>
                {overtime.approved_by != null && (
                  <DetailRow label="ID Penyetuju">
                    <span className="font-mono">#{overtime.approved_by}</span>
                  </DetailRow>
                )}
              </div>

              {/* Absensi terkait */}
              <div className="py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                  Absensi Terkait
                </p>
                <DetailRow label="ID Absensi">
                  <span className="font-mono">#{overtime.attendance_id}</span>
                </DetailRow>
                {attendance ? (
                  <>
                    <DetailRow label="Check-in">
                      {formatDateTime(attendance.checkin_time, tz)}
                    </DetailRow>
                    <DetailRow label="Check-out">
                      {attendance.checkout_time
                        ? formatDateTime(attendance.checkout_time, tz)
                        : <span className="italic text-text-secondary">Belum checkout</span>}
                    </DetailRow>
                    <DetailRow label="Jam Kerja">
                      {attendance.work_duration_minutes > 0
                        ? formatDuration(attendance.work_duration_minutes)
                        : <span className="italic text-text-secondary">—</span>}
                    </DetailRow>
                    {attendance.latitude != null && attendance.longitude != null && (
                      <DetailRow label="Lokasi GPS">
                        <a
                          href={`https://maps.google.com/?q=${attendance.latitude},${attendance.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand hover:underline font-mono text-xs"
                        >
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                          {attendance.latitude.toFixed(6)}, {attendance.longitude.toFixed(6)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </DetailRow>
                    )}
                  </>
                ) : (
                  <DetailRow label="Detail">
                    <span className="italic text-text-secondary">Tidak dapat dimuat</span>
                  </DetailRow>
                )}
              </div>

              {/* Periode lembur yang diminta */}
              <div className="py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                  Periode Lembur
                </p>
                <DetailRow label="Mulai">
                  {formatDateTime(overtime.requested_start, tz)}
                </DetailRow>
                <DetailRow label="Selesai">
                  {formatDateTime(overtime.requested_end, tz)}
                </DetailRow>
                <DetailRow label="Durasi">
                  <span className="font-semibold text-brand">
                    {formatDuration(overtime.requested_minutes)}
                  </span>
                </DetailRow>
              </div>

              {/* Approve / Reject actions — only for PENDING requests */}
              {canApproveOrReject && overtime.status === 'PENDING' && (
                <div className="py-4 flex gap-3">
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
                    onClick={() => setConfirmAction('approve')}
                    disabled={isMutating}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Setujui
                  </button>
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
                    onClick={() => setConfirmAction('reject')}
                    disabled={isMutating}
                  >
                    <XCircle className="h-4 w-4" />
                    Tolak
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(v) => !v && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'approve'
                ? 'Setujui Pengajuan Lembur'
                : 'Tolak Pengajuan Lembur'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'approve'
                ? `Apakah Anda yakin ingin menyetujui pengajuan lembur #${request?.id}? Jam lembur akan ditambahkan ke rekap absensi karyawan.`
                : `Apakah Anda yakin ingin menolak pengajuan lembur #${request?.id}? Tindakan ini tidak dapat dibatalkan.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isMutating}>
              {isMutating
                ? 'Memproses...'
                : confirmAction === 'approve'
                  ? 'Setujui'
                  : 'Tolak'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

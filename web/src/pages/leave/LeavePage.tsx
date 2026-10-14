import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CalendarOff, Check, RefreshCw, X } from 'lucide-react'
import { isAxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { leaveApi } from '@/api/leave.api'
import { useAuthStore } from '@/store/authStore'
import { daysAgoISO, formatDateTime, formatPlainDate } from '@/utils/datetime'
import { showError, showSuccess } from '@/utils/toast'
import {
  LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL,
  type LeaveRequest, type LeaveStatus, type LeaveType,
} from '@/types/leave'

type Tab = 'pending' | 'today' | 'history'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'pending', label: 'Menunggu keputusan' },
  { value: 'today', label: 'Tidak masuk hari ini' },
  { value: 'history', label: 'Riwayat' },
]

const TYPE_VARIANT: Record<LeaveType, BadgeProps['variant']> = {
  SICK: 'danger',
  PERMIT: 'info',
  ANNUAL: 'default',
}

const STATUS_VARIANT: Record<LeaveStatus, BadgeProps['variant']> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'outline',
}

function dateRange(r: LeaveRequest): string {
  if (r.start_date === r.end_date) return formatPlainDate(r.start_date)
  return `${formatPlainDate(r.start_date, { year: undefined })} – ${formatPlainDate(r.end_date)}`
}

function errorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const detail = err.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail.message === 'string') return detail.message
  }
  return fallback
}

export function LeavePage() {
  const { user } = useAuthStore()
  const tz = user?.site_timezone ?? undefined
  const today = daysAgoISO(0, tz)
  const [tab, setTab] = useState<Tab>('pending')
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null)
  const [note, setNote] = useState('')
  const qc = useQueryClient()

  const pending = useQuery({
    queryKey: ['leave', 'pending'],
    queryFn: () => leaveApi.listTeam({ status: 'PENDING', limit: 500 }),
    staleTime: 15_000,
  })

  const onLeaveToday = useQuery({
    queryKey: ['leave', 'today', today],
    queryFn: () => leaveApi.listTeam({ status: 'APPROVED', from_date: today, to_date: today, limit: 500 }),
    staleTime: 60_000,
  })

  const history = useQuery({
    queryKey: ['leave', 'history'],
    queryFn: () => leaveApi.listTeam({ from_date: daysAgoISO(90, tz), limit: 500 }),
    enabled: tab === 'history',
    staleTime: 30_000,
  })

  const decide = useMutation({
    mutationFn: (v: { id: number; decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
      leaveApi.decide(v.id, v.decision, v.note),
    onSuccess: (_, v) => {
      showSuccess(v.decision === 'APPROVED' ? 'Pengajuan disetujui' : 'Pengajuan ditolak')
      setRejecting(null)
      setNote('')
      void qc.invalidateQueries({ queryKey: ['leave'] })
    },
    onError: (err) => {
      showError(errorMessage(err, 'Gagal menyimpan keputusan'))
      void qc.invalidateQueries({ queryKey: ['leave'] })
    },
  })

  const active = tab === 'pending' ? pending : tab === 'today' ? onLeaveToday : history
  const rows = useMemo(() => {
    const data = active.data ?? []
    return tab === 'history' ? data.filter((r) => r.status !== 'PENDING') : data
  }, [active.data, tab])

  const counts: Partial<Record<Tab, number | undefined>> = {
    pending: pending.data?.length,
    today: onLeaveToday.data?.length,
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Izin &amp; Cuti</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-2xl">
            Pengajuan sakit, izin, dan cuti dari aplikasi mobile. Setujui atau tolak pengajuan tim
            Anda; penolakan wajib diberi alasan agar karyawan tahu kenapa.
          </p>
        </div>
        <Button variant="outline" onClick={() => void active.refetch()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-0 border-b border-divider overflow-x-auto" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`min-h-11 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.value
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
            {counts[t.value] !== undefined && (
              <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand tabular-nums">
                {counts[t.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Phones: one card per request, so the decision buttons stay on screen */}
      <div className="md:hidden space-y-3">
        {active.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)
        ) : active.isError ? (
          <div className="rounded-xl border border-divider bg-white"><ErrorState onRetry={() => void active.refetch()} /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-divider bg-white"><EmptyState tab={tab} /></div>
        ) : (
          rows.map((r) => (
            <article key={r.id} className="rounded-xl border border-divider bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary truncate">{r.employee_name}</p>
                  <p className="text-xs text-text-secondary font-mono">{r.employee_id}</p>
                </div>
                <Badge variant={TYPE_VARIANT[r.leave_type]}>{LEAVE_TYPE_LABEL[r.leave_type]}</Badge>
              </div>
              <p className="text-sm text-text-primary">
                {dateRange(r)} <span className="text-text-secondary">· {r.days} hari</span>
              </p>
              <p className="text-sm text-text-secondary break-words">{r.reason}</p>
              {tab === 'pending' ? (
                <DecisionButtons
                  row={r}
                  busy={decide.isPending}
                  stretch
                  onApprove={() => decide.mutate({ id: r.id, decision: 'APPROVED' })}
                  onReject={() => setRejecting(r)}
                />
              ) : (
                <StatusBlock row={r} align="start" />
              )}
            </article>
          ))
        )}
      </div>

      <div className="hidden md:block rounded-lg border border-divider overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <Th>Karyawan</Th>
                <Th>Jenis</Th>
                <Th>Tanggal</Th>
                <Th className="hidden md:table-cell">Alasan</Th>
                <Th className="hidden lg:table-cell">Diajukan</Th>
                <Th className="text-right">{tab === 'pending' ? 'Keputusan' : 'Status'}</Th>
              </tr>
            </thead>
            <tbody>
              {active.isLoading ? (
                <SkeletonRows cols={6} />
              ) : active.isError ? (
                <ErrorRow cols={6} onRetry={() => void active.refetch()} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6}><EmptyState tab={tab} /></td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-divider align-top">
                    <td className="px-4 py-3 min-w-[10rem]">
                      <p className="font-medium text-text-primary">{r.employee_name}</p>
                      <p className="text-xs text-text-secondary font-mono">{r.employee_id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={TYPE_VARIANT[r.leave_type]}>{LEAVE_TYPE_LABEL[r.leave_type]}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-primary">
                      {dateRange(r)}
                      <span className="block text-xs text-text-secondary tabular-nums">{r.days} hari</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-text-secondary max-w-sm">
                      <p className="line-clamp-3 break-words">{r.reason}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-text-secondary whitespace-nowrap">
                      {formatDateTime(r.created_at, tz ?? 'Asia/Jakarta')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {tab === 'pending' ? (
                        <DecisionButtons
                          row={r}
                          busy={decide.isPending}
                          onApprove={() => decide.mutate({ id: r.id, decision: 'APPROVED' })}
                          onReject={() => setRejecting(r)}
                        />
                      ) : (
                        <StatusBlock row={r} align="end" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={rejecting !== null} onOpenChange={(open) => { if (!open) { setRejecting(null); setNote('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak pengajuan {rejecting?.employee_name}</DialogTitle>
            <DialogDescription>
              {rejecting && `${LEAVE_TYPE_LABEL[rejecting.leave_type]}, ${dateRange(rejecting)}. `}
              Tulis alasannya; karyawan akan melihat catatan ini di aplikasi.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="leave-reject-note" className="sr-only">Alasan penolakan</label>
          <textarea
            id="leave-reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Contoh: jadwal audit di tanggal tersebut, mohon ajukan di minggu berikutnya"
            className="w-full rounded-lg border border-divider bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejecting(null); setNote('') }}>Batal</Button>
            <Button
              variant="destructive"
              disabled={!note.trim() || decide.isPending}
              onClick={() => rejecting && decide.mutate({ id: rejecting.id, decision: 'REJECTED', note: note.trim() })}
            >
              Tolak pengajuan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="border-t border-divider">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
          ))}
        </tr>
      ))}
    </>
  )
}

function ErrorRow({ cols, onRetry }: { cols: number; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={cols}><ErrorState onRetry={onRetry} /></td>
    </tr>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <AlertCircle className="h-8 w-8 text-red-400" />
      <p className="text-text-secondary text-sm">Gagal memuat data.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" />
        Coba Lagi
      </Button>
    </div>
  )
}

const EMPTY_TEXT: Record<Tab, string> = {
  pending: 'Tidak ada pengajuan yang menunggu keputusan.',
  today: 'Tidak ada anggota tim yang izin atau cuti hari ini.',
  history: 'Belum ada riwayat pengajuan dalam 90 hari terakhir.',
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-text-secondary">
      <CalendarOff className="h-8 w-8 text-text-disabled" />
      <p className="text-sm">{EMPTY_TEXT[tab]}</p>
    </div>
  )
}

function DecisionButtons({
  row, busy, stretch = false, onApprove, onReject,
}: { row: LeaveRequest; busy: boolean; stretch?: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <div className={stretch ? 'grid grid-cols-2 gap-2' : 'inline-flex gap-2'}>
      <Button size="sm" onClick={onApprove} disabled={busy} aria-label={`Setujui pengajuan ${row.employee_name}`}>
        <Check className="h-3.5 w-3.5" />
        Setujui
      </Button>
      <Button size="sm" variant="outline" onClick={onReject} disabled={busy} aria-label={`Tolak pengajuan ${row.employee_name}`}>
        <X className="h-3.5 w-3.5" />
        Tolak
      </Button>
    </div>
  )
}

function StatusBlock({ row, align }: { row: LeaveRequest; align: 'start' | 'end' }) {
  return (
    <div className={`inline-flex flex-col gap-1 ${align === 'end' ? 'items-end text-right' : 'items-start'}`}>
      <Badge variant={STATUS_VARIANT[row.status]}>{LEAVE_STATUS_LABEL[row.status]}</Badge>
      {row.reviewer_name && <span className="text-xs text-text-secondary">oleh {row.reviewer_name}</span>}
      {row.review_note && (
        <span className="text-xs text-text-secondary max-w-[16rem] break-words">“{row.review_note}”</span>
      )}
    </div>
  )
}

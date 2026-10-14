import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, ExternalLink, RefreshCw, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { attendanceApi } from '@/api/attendance.api'
import { formatDateTime } from '@/utils/datetime'
import { showError, showSuccess } from '@/utils/toast'
import type { AttemptReason, CheckinAttempt, TeamAttendanceRecord } from '@/types/attendance'

// ── Labels ───────────────────────────────────────────────────────────────────

const FLAG_LABEL: Record<string, string> = {
  MOCK_LOCATION: 'Lokasi palsu terdeteksi',
  LOW_GPS_ACCURACY: 'GPS kurang akurat',
  GPS_ACCURACY_UNKNOWN: 'Akurasi GPS tidak dikirim',
  FACE_NOT_VERIFIED: 'Wajah belum terverifikasi',
  FACE_MISMATCH: 'Wajah tidak cocok',
  CLOCK_MISMATCH: 'Jam HP tidak sesuai',
  CLOCK_UNVERIFIED: 'Jam belum terbukti',
  OFFLINE_SYNC: 'Dikirim saat sinyal kembali',
}

const INFO_FLAGS = new Set(['OFFLINE_SYNC', 'GPS_ACCURACY_UNKNOWN'])

function flagLabel(flag: string): string {
  const checkout = flag.startsWith('CHECKOUT_')
  const base = checkout ? flag.slice('CHECKOUT_'.length) : flag
  const label = FLAG_LABEL[base] ?? base
  return checkout ? `Pulang: ${label}` : label
}

const REASON_LABEL: Record<AttemptReason, string> = {
  NO_GPS: 'GPS tidak didapat',
  FACE_MISMATCH: 'Wajah tidak dikenali',
  FACE_ERROR: 'Kamera / verifikasi gagal',
  NETWORK: 'Tidak ada koneksi',
  SERVER_ERROR: 'Server bermasalah',
  REJECTED: 'Ditolak server',
  OTHER: 'Lainnya',
}

function mapsUrl(lat: number, lon: number) {
  return `https://www.google.com/maps?q=${lat},${lon}`
}

type Tab = 'pending' | 'history' | 'attempts'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'pending', label: 'Perlu ditinjau' },
  { value: 'history', label: 'Riwayat tinjauan' },
  { value: 'attempts', label: 'Percobaan gagal' },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export function ReviewPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [rejecting, setRejecting] = useState<TeamAttendanceRecord | null>(null)
  const [note, setNote] = useState('')
  const qc = useQueryClient()

  const records = useQuery({
    queryKey: ['attendance-review', tab],
    queryFn: () => attendanceApi.getReviewQueue(tab === 'pending' ? 'pending' : 'all'),
    enabled: tab !== 'attempts',
    staleTime: 15_000,
  })

  const attempts = useQuery({
    queryKey: ['attendance-attempts'],
    queryFn: () => attendanceApi.getAttempts({ limit: 300 }),
    enabled: tab === 'attempts',
    staleTime: 15_000,
  })

  const decide = useMutation({
    mutationFn: (v: { id: number; decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
      attendanceApi.review(v.id, v.decision, v.note),
    onSuccess: (_, v) => {
      showSuccess(v.decision === 'APPROVED' ? 'Absen disetujui' : 'Absen ditolak')
      setRejecting(null)
      setNote('')
      void qc.invalidateQueries({ queryKey: ['attendance-review'] })
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
    onError: () => showError('Gagal menyimpan keputusan'),
  })

  const rows = tab === 'history'
    ? (records.data ?? []).filter((r) => r.review_status !== null)
    : (records.data ?? [])
  const active = tab === 'attempts' ? attempts : records

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Tinjauan Absen</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-2xl">
            Absen yang tidak ditolak, tetapi perlu dilihat orang: GPS meleset, lokasi palsu, wajah
            belum terverifikasi, atau jam HP tidak sesuai. Percobaan yang gagal juga tercatat di sini,
            sehingga karyawan punya bukti saat aplikasi bermasalah.
          </p>
        </div>
        <Button variant="outline" onClick={() => void active.refetch()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-0 border-b border-divider overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.value
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
            {t.value === 'pending' && tab === 'pending' && records.data && (
              <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
                {records.data.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Phones: one card per record, so the decision buttons stay on screen */}
      {tab !== 'attempts' && (
        <div className="md:hidden space-y-3">
          {records.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          ) : records.isError ? (
            <div className="rounded-xl border border-divider bg-white">
              <table className="w-full"><tbody><ErrorRow cols={1} onRetry={() => void records.refetch()} /></tbody></table>
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-divider bg-white px-4 py-12 text-center text-sm text-text-secondary">
              {tab === 'pending' ? 'Tidak ada absen yang perlu ditinjau.' : 'Belum ada riwayat tinjauan.'}
            </p>
          ) : (
            rows.map((r) => (
              <article key={r.id} className="rounded-xl border border-divider bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary truncate">{r.employee_name}</p>
                    <p className="text-xs text-text-secondary font-mono">{r.employee_id}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-sm text-text-primary">
                  {formatDateTime(r.checkin_time, r.site_timezone)}
                  {r.is_offline && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">
                      <WifiOff className="h-3 w-3" />
                      terkirim {r.received_at ? formatDateTime(r.received_at, r.site_timezone) : 'kemudian'}
                    </p>
                  )}
                </div>
                <FlagList record={r} />
                {r.latitude != null && r.longitude != null && (
                  <a
                    href={mapsUrl(r.latitude, r.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-sm text-brand hover:underline"
                  >
                    Lihat di peta <ExternalLink className="h-3.5 w-3.5" />
                    {r.gps_accuracy_m != null && (
                      <span className="ml-1 text-xs text-text-secondary">±{Math.round(r.gps_accuracy_m)} m</span>
                    )}
                  </a>
                )}
                {tab === 'pending' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })} disabled={decide.isPending}>
                      <Check className="h-4 w-4" />
                      Setujui
                    </Button>
                    <Button variant="outline" onClick={() => setRejecting(r)} disabled={decide.isPending}>
                      <X className="h-4 w-4" />
                      Tolak
                    </Button>
                  </div>
                ) : (
                  <Badge variant={r.review_status === 'APPROVED' ? 'success' : 'danger'}>
                    {r.review_status === 'APPROVED' ? 'Disetujui' : 'Ditolak'}
                  </Badge>
                )}
              </article>
            ))
          )}
        </div>
      )}

      <div className={`rounded-lg border border-divider overflow-hidden ${tab === 'attempts' ? '' : 'hidden md:block'}`}>
        <div className="overflow-x-auto">
          {tab === 'attempts' ? (
            <AttemptsTable
              data={attempts.data}
              isLoading={attempts.isLoading}
              isError={attempts.isError}
              onRetry={() => void attempts.refetch()}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-white">
                <tr>
                  <Th>Karyawan</Th>
                  <Th>Masuk</Th>
                  <Th>Status</Th>
                  <Th>Alasan ditandai</Th>
                  <Th className="hidden lg:table-cell">Lokasi</Th>
                  <Th className="text-right">{tab === 'pending' ? 'Keputusan' : 'Hasil'}</Th>
                </tr>
              </thead>
              <tbody>
                {records.isLoading ? (
                  <SkeletonRows cols={6} />
                ) : records.isError ? (
                  <ErrorRow cols={6} onRetry={() => void records.refetch()} />
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-secondary text-sm">
                      {tab === 'pending' ? 'Tidak ada absen yang perlu ditinjau.' : 'Belum ada riwayat tinjauan.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-divider align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{r.employee_name}</p>
                        <p className="text-xs text-text-secondary font-mono">{r.employee_id}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-text-primary">
                        {formatDateTime(r.checkin_time, r.site_timezone)}
                        {r.is_offline && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">
                            <WifiOff className="h-3 w-3" />
                            terkirim {r.received_at ? formatDateTime(r.received_at, r.site_timezone) : 'kemudian'}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3">
                        <FlagList record={r} className="max-w-xs" />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-text-secondary whitespace-nowrap">
                        {r.latitude != null && r.longitude != null ? (
                          <a
                            href={mapsUrl(r.latitude, r.longitude)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            Peta <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : '-'}
                        {r.gps_accuracy_m != null && <span className="ml-2">±{Math.round(r.gps_accuracy_m)} m</span>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {tab === 'pending' ? (
                          <div className="inline-flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })}
                              disabled={decide.isPending}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Setujui
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRejecting(r)} disabled={decide.isPending}>
                              <X className="h-3.5 w-3.5" />
                              Tolak
                            </Button>
                          </div>
                        ) : (
                          <Badge variant={r.review_status === 'APPROVED' ? 'success' : 'danger'}>
                            {r.review_status === 'APPROVED' ? 'Disetujui' : 'Ditolak'}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog open={rejecting !== null} onOpenChange={(open) => { if (!open) { setRejecting(null); setNote('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak absen {rejecting?.employee_name}</DialogTitle>
            <DialogDescription>
              Tulis alasannya. Catatan ini disimpan bersama absen sehingga karyawan tahu kenapa ditolak.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Contoh: tidak berada di lokasi menurut laporan pos jaga"
            className="w-full rounded-lg border border-divider bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejecting(null); setNote('') }}>Batal</Button>
            <Button
              variant="destructive"
              disabled={!note.trim() || decide.isPending}
              onClick={() => rejecting && decide.mutate({ id: rejecting.id, decision: 'REJECTED', note: note.trim() })}
            >
              Tolak absen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TeamAttendanceRecord['status'] }) {
  return (
    <Badge variant={status === 'OUT_OF_RADIUS' ? 'danger' : status === 'LATE' ? 'warning' : 'success'}>
      {status === 'OUT_OF_RADIUS' ? 'Di luar area' : status === 'LATE' ? 'Terlambat' : status === 'EARLY' ? 'Lebih awal' : 'Tepat waktu'}
    </Badge>
  )
}

function FlagList({ record, className = '' }: { record: TeamAttendanceRecord; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {record.risk_flags.map((f) => (
        <Badge key={f} variant={INFO_FLAGS.has(f.replace('CHECKOUT_', '')) ? 'outline' : 'warning'}>
          {flagLabel(f)}
        </Badge>
      ))}
      {record.status === 'OUT_OF_RADIUS' && <Badge variant="danger">Di luar radius lokasi</Badge>}
    </div>
  )
}

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
      <td colSpan={cols} className="px-4 py-12 text-center">
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-text-secondary text-sm">Gagal memuat data.</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" />
            Coba Lagi
          </Button>
        </div>
      </td>
    </tr>
  )
}

function AttemptsTable({
  data, isLoading, isError, onRetry,
}: { data?: CheckinAttempt[]; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-800 text-white">
        <tr>
          <Th>Karyawan</Th>
          <Th>Waktu di HP</Th>
          <Th className="hidden sm:table-cell">Jenis</Th>
          <Th>Penyebab</Th>
          <Th className="hidden md:table-cell">Keterangan</Th>
          <Th className="hidden lg:table-cell">Lokasi</Th>
        </tr>
      </thead>
      <tbody>
        {isLoading ? (
          <SkeletonRows cols={6} />
        ) : isError ? (
          <ErrorRow cols={6} onRetry={onRetry} />
        ) : !data || data.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-12 text-center text-text-secondary text-sm">
              Tidak ada percobaan gagal yang dilaporkan.
            </td>
          </tr>
        ) : (
          data.map((a) => (
            <tr key={a.id} className="border-t border-divider align-top">
              <td className="px-4 py-3">
                <p className="font-medium text-text-primary">{a.employee_name}</p>
                <p className="text-xs text-text-secondary font-mono">{a.employee_id}</p>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-text-primary">
                {formatDateTime(a.captured_at, a.site_timezone)}
                <span className="block text-xs text-text-secondary sm:hidden">
                  {a.kind === 'CHECKIN' ? 'Masuk' : 'Pulang'}
                </span>
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                <Badge variant="outline">{a.kind === 'CHECKIN' ? 'Masuk' : 'Pulang'}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge variant={a.reason === 'REJECTED' ? 'danger' : 'warning'}>{REASON_LABEL[a.reason]}</Badge>
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-xs text-text-secondary max-w-sm">
                {a.detail ?? '-'}
                {a.app_version && <span className="block mt-1 font-mono">app {a.app_version}</span>}
              </td>
              <td className="px-4 py-3 hidden lg:table-cell text-xs whitespace-nowrap">
                {a.latitude != null && a.longitude != null ? (
                  <a
                    href={mapsUrl(a.latitude, a.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-brand hover:underline"
                  >
                    Peta <ExternalLink className="h-3 w-3" />
                  </a>
                ) : <span className="text-text-secondary">-</span>}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

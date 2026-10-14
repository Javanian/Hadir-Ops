import { useMemo, useState } from 'react'
import { ArrowDownWideNarrow, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration, formatPlainDate } from '@/utils/datetime'
import type { RecapRow } from '@/types/reports'

type SortKey = 'absent' | 'late' | 'name'

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'absent', label: 'Tanpa keterangan terbanyak' },
  { value: 'late', label: 'Terlambat terbanyak' },
  { value: 'name', label: 'Nama (A–Z)' },
]

function sortRows(rows: RecapRow[], key: SortKey): RecapRow[] {
  const byName = (a: RecapRow, b: RecapRow) => a.name.localeCompare(b.name, 'id')
  return [...rows].sort((a, b) => {
    if (key === 'absent') return b.absent - a.absent || b.late - a.late || byName(a, b)
    if (key === 'late') return b.late - a.late || b.absent - a.absent || byName(a, b)
    return byName(a, b)
  })
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportRecapCSV(rows: RecapRow[], fromDate: string, toDate: string) {
  const headers = [
    'Nama', 'ID Karyawan', 'Lokasi', 'Hari Kerja', 'Hadir', 'Tepat Waktu', 'Terlambat',
    'Di Luar Radius', 'Sakit', 'Izin', 'Cuti', 'Tanpa Keterangan', 'Tanggal Tanpa Keterangan',
    'Jam Kerja (menit)', 'Lembur (menit)', 'Perlu Ditinjau',
  ]
  const lines = rows.map((r) => [
    r.name, r.employee_id, r.site_name ?? '', r.workdays, r.present, r.ontime, r.late,
    r.out_of_radius, r.sick, r.permit, r.annual, r.absent, r.absent_dates.join(' '),
    r.work_minutes, r.overtime_minutes, r.needs_review,
  ].map(csvCell).join(','))
  const blob = new Blob(['﻿' + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `rekap_kehadiran_${fromDate}_${toDate}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

interface RecapTableProps {
  rows: RecapRow[]
  fromDate: string
  toDate: string
}

export function RecapTable({ rows, fromDate, toDate }: RecapTableProps) {
  const [sort, setSort] = useState<SortKey>('absent')
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({
      absent: t.absent + r.absent,
      late: t.late + r.late,
      leave: t.leave + r.sick + r.permit + r.annual,
      people: t.people + (r.absent > 0 ? 1 : 0),
    }),
    { absent: 0, late: 0, leave: 0, people: 0 },
  ), [rows])

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-soft overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-divider">
        <p className="text-sm text-text-secondary">
          {rows.length} karyawan · {totals.absent} hari tanpa keterangan dari {totals.people} orang ·{' '}
          {totals.leave} hari izin/cuti · {totals.late} kali terlambat
        </p>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-text-secondary sm:flex-none">
            <ArrowDownWideNarrow size={14} aria-hidden />
            <span className="sr-only">Urutkan</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="min-w-0 flex-1 rounded-lg border border-divider bg-white px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => exportRecapCSV(sorted, fromDate, toDate)}
            className="shrink-0 gap-2"
          >
            <Download size={14} />
            Export CSV
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-sm text-text-disabled py-12">Tidak ada karyawan untuk filter yang dipilih.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="px-3 py-2 text-left font-medium">Karyawan</th>
                <Num title="Hari kerja terjadwal sampai hari ini">Hari Kerja</Num>
                <Num>Hadir</Num>
                <Num>Terlambat</Num>
                <Num>Sakit</Num>
                <Num>Izin</Num>
                <Num>Cuti</Num>
                <Num title="Hari kerja yang sudah lewat tanpa absen dan tanpa izin yang disetujui">Tanpa Ket.</Num>
                <Num className="hidden lg:table-cell">Jam Kerja</Num>
                <Num className="hidden lg:table-cell">Lembur</Num>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.user_id} className="border-b border-divider hover:bg-surface align-top">
                  <td className="px-3 py-2 min-w-[11rem]">
                    <p className="font-medium text-text-primary">{r.name}</p>
                    <p className="text-xs text-text-secondary">
                      <span className="font-mono">{r.employee_id}</span>
                      {r.site_name && <> · {r.site_name}</>}
                    </p>
                    {r.needs_review > 0 && (
                      <p className="text-xs text-amber-700 mt-0.5">{r.needs_review} absen perlu ditinjau</p>
                    )}
                  </td>
                  <Cell value={r.workdays} />
                  <Cell value={r.present} />
                  <Cell value={r.late} tone={r.late > 0 ? 'warning' : undefined} />
                  <Cell value={r.sick} />
                  <Cell value={r.permit} />
                  <Cell value={r.annual} />
                  <td className="px-3 py-2 text-center">
                    {r.absent > 0 ? (
                      <span
                        className="inline-flex min-w-7 justify-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 tabular-nums"
                        title={r.absent_dates.map((d) => formatPlainDate(d)).join(', ')}
                      >
                        {r.absent}
                      </span>
                    ) : (
                      <span className="text-text-disabled tabular-nums">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-text-secondary hidden lg:table-cell tabular-nums">
                    {r.work_minutes > 0 ? formatDuration(r.work_minutes) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-text-secondary hidden lg:table-cell tabular-nums">
                    {r.overtime_minutes > 0 ? formatDuration(r.overtime_minutes) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Num({ children, title, className = '' }: { children: React.ReactNode; title?: string; className?: string }) {
  return (
    <th className={`px-3 py-2 text-center font-medium whitespace-nowrap ${className}`} title={title}>
      {children}
    </th>
  )
}

function Cell({ value, tone }: { value: number; tone?: 'warning' }) {
  return (
    <td className={`px-3 py-2 text-center tabular-nums ${
      value === 0 ? 'text-text-disabled' : tone === 'warning' ? 'text-amber-700 font-semibold' : 'text-text-primary'
    }`}
    >
      {value}
    </td>
  )
}

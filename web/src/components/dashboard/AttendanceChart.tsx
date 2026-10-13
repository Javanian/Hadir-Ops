import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TeamAttendanceRecord } from '@/types/attendance'
import { Skeleton } from '@/components/ui/skeleton'

interface AttendanceChartProps {
  records: TeamAttendanceRecord[]
  loading?: boolean
}

interface DayData {
  label: string
  ONTIME: number
  LATE: number
  OUT_OF_RADIUS: number
}

function buildChartData(records: TeamAttendanceRecord[]): DayData[] {
  // Build last 7 days (today inclusive) as YYYY-MM-DD keys
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }

  // Group records by UTC-date (YYYY-MM-DD from checkin_time)
  const grouped: Record<string, DayData> = {}
  for (const day of days) {
    const date = new Date(day + 'T12:00:00Z')
    const label = new Intl.DateTimeFormat('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date)
    grouped[day] = { label, ONTIME: 0, LATE: 0, OUT_OF_RADIUS: 0 }
  }

  for (const rec of records) {
    const day = rec.checkin_time.slice(0, 10)
    if (grouped[day] && rec.status) {
      if (rec.status === 'ONTIME') grouped[day].ONTIME++
      else if (rec.status === 'LATE') grouped[day].LATE++
      else if (rec.status === 'OUT_OF_RADIUS') grouped[day].OUT_OF_RADIUS++
    }
  }

  return days.map((d) => grouped[d])
}

export function AttendanceChart({ records, loading = false }: AttendanceChartProps) {
  if (loading) {
    return <Skeleton className="h-60 w-full rounded-lg" />
  }

  const data = buildChartData(records)

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#475569' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: '#475569' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#E2E8F0' }}
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              ONTIME: 'Tepat Waktu',
              LATE: 'Terlambat',
              OUT_OF_RADIUS: 'Di Luar Radius',
            }
            return [value, labels[name] ?? name]
          }}
        />
        <Legend
          formatter={(value: string) => {
            const labels: Record<string, string> = {
              ONTIME: 'Tepat Waktu',
              LATE: 'Terlambat',
              OUT_OF_RADIUS: 'Di Luar Radius',
            }
            return <span style={{ fontSize: 11, color: '#475569' }}>{labels[value] ?? value}</span>
          }}
        />
        <Bar dataKey="ONTIME" fill="#059669" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="LATE" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="OUT_OF_RADIUS" fill="#DC2626" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

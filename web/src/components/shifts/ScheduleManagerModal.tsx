import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { shiftsApi } from '@/api/shifts.api'
import { showSuccess, showError } from '@/utils/toast'
import { DAY_LABELS } from '@/types/shifts'
import type { ShiftResponse, WorkScheduleResponse } from '@/types/shifts'

interface DayState {
  checked: boolean
  tolerance: number
  scheduleId?: number // undefined = not yet in DB
}

type ScheduleState = Record<number, DayState> // key: day_of_week 0–6

function buildInitialState(schedules: WorkScheduleResponse[]): ScheduleState {
  const state: ScheduleState = {}
  for (let d = 0; d <= 6; d++) {
    const existing = schedules.find((s) => s.day_of_week === d)
    state[d] = existing
      ? { checked: true, tolerance: existing.toleransi_telat_menit, scheduleId: existing.id }
      : { checked: false, tolerance: 0 }
  }
  return state
}

interface Props {
  open: boolean
  onClose: () => void
  shift: ShiftResponse | null
}

export function ScheduleManagerModal({ open, onClose, shift }: Props) {
  const qc = useQueryClient()
  const [state, setState] = useState<ScheduleState>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (shift) {
      setState(buildInitialState(shift.schedules))
    }
  }, [shift, open])

  const toggleDay = (day: number) => {
    setState((prev) => ({
      ...prev,
      [day]: { ...prev[day], checked: !prev[day].checked },
    }))
  }

  const setTolerance = (day: number, value: number) => {
    setState((prev) => ({
      ...prev,
      [day]: { ...prev[day], tolerance: value },
    }))
  }

  const handleSave = async () => {
    if (!shift) return
    setSaving(true)

    // Build diff against original schedules
    const original = buildInitialState(shift.schedules)
    const toDelete: number[] = []
    const toAdd: { day_of_week: number; toleransi_telat_menit: number }[] = []

    for (let d = 0; d <= 6; d++) {
      const cur = state[d]
      const orig = original[d]

      if (orig.checked) {
        if (!cur.checked) {
          // Unchecked → delete
          toDelete.push(orig.scheduleId!)
        } else if (cur.tolerance !== orig.tolerance) {
          // Tolerance changed → delete + re-add
          toDelete.push(orig.scheduleId!)
          toAdd.push({ day_of_week: d, toleransi_telat_menit: cur.tolerance })
        }
        // else: no change
      } else {
        if (cur.checked) {
          // Newly checked → add
          toAdd.push({ day_of_week: d, toleransi_telat_menit: cur.tolerance })
        }
      }
    }

    try {
      await Promise.all(toDelete.map((id) => shiftsApi.deleteSchedule(id)))
      await Promise.all(toAdd.map((item) => shiftsApi.addSchedule(shift.id, item)))
      showSuccess('Jadwal shift berhasil diperbarui')
      void qc.invalidateQueries({ queryKey: ['shifts'] })
      onClose()
    } catch {
      showError('Gagal menyimpan jadwal. Coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  if (!shift) return null

  const checkedCount = Object.values(state).filter((s) => s.checked).length

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Jadwal Shift: {shift.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-xs text-text-secondary">
          <p>Pilih hari kerja dan toleransi keterlambatan (menit).</p>
          <p className="font-medium text-text-primary">
            {checkedCount} hari aktif
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          {Array.from({ length: 7 }, (_, d) => {
            const dayState = state[d]
            if (!dayState) return null
            return (
              <div
                key={d}
                className={`flex items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                  dayState.checked ? 'bg-surface' : ''
                }`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  id={`day-${d}`}
                  checked={dayState.checked}
                  onChange={() => toggleDay(d)}
                  className="h-4 w-4 accent-brand flex-shrink-0 cursor-pointer"
                />
                {/* Day label */}
                <Label
                  htmlFor={`day-${d}`}
                  className="w-20 flex-shrink-0 cursor-pointer font-medium text-sm"
                >
                  {DAY_LABELS[d]}
                </Label>
                {/* Tolerance input — only visible when checked */}
                <div
                  className={`flex items-center gap-2 transition-opacity ${
                    dayState.checked ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={dayState.tolerance}
                    onChange={(e) => setTolerance(d, Math.max(0, parseInt(e.target.value) || 0))}
                    className="h-8 w-16 text-center text-sm"
                    tabIndex={dayState.checked ? 0 : -1}
                  />
                  <span className="text-xs text-text-secondary whitespace-nowrap">menit</span>
                </div>
              </div>
            )
          })}
        </div>

        <Separator />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Jadwal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

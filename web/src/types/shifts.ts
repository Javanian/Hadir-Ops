export interface WorkScheduleResponse {
  id: number
  day_of_week: number // 0=Sun … 6=Sat
  toleransi_telat_menit: number
}

export interface WorkScheduleCreatePayload {
  day_of_week: number
  toleransi_telat_menit: number
}

export interface ShiftResponse {
  id: number
  site_id: number
  name: string | null
  start_time: string // "HH:MM:SS"
  end_time: string   // "HH:MM:SS"
  is_cross_midnight: boolean
  work_hours_standard: number
  created_at: string | null
  schedules: WorkScheduleResponse[]
}

export interface ShiftCreatePayload {
  site_id: number
  name: string
  start_time: string // "HH:MM"
  end_time: string   // "HH:MM"
  work_hours_standard: number
  is_cross_midnight?: boolean
}

export interface ShiftUpdatePayload {
  name?: string
  start_time?: string
  end_time?: string
  work_hours_standard?: number
  is_cross_midnight?: boolean
}

export interface HolidayResponse {
  id: number
  holiday_date: string // "YYYY-MM-DD"
  description: string | null
  is_national: boolean
}

export interface HolidayCreatePayload {
  holiday_date: string
  description?: string
  is_national: boolean
}

export interface HolidayUpdatePayload {
  description?: string
  is_national?: boolean
}

// day_of_week: 0=Sunday … 6=Saturday
export const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const

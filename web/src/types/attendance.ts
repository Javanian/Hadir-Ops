export type AttendanceStatus = 'ONTIME' | 'LATE' | 'OUT_OF_RADIUS'

export interface TeamAttendanceRecord {
  id: number
  user_id: number
  employee_id: string
  employee_name: string
  site_name: string | null
  checkin_time: string        // UTC ISO 8601
  checkout_time: string | null
  work_duration_minutes: number
  overtime_minutes: number
  is_weekend: boolean
  is_holiday: boolean
  status: AttendanceStatus | null
  created_at: string
  site_timezone: string
}

export interface AttendanceDetail {
  id: number
  user_id: number
  site_id: number | null
  shift_id: number | null
  checkin_time: string        // UTC ISO 8601
  checkout_time: string | null
  auto_checkout: boolean
  latitude: number | null
  longitude: number | null
  work_duration_minutes: number
  overtime_minutes: number
  is_weekend: boolean
  is_holiday: boolean
  status: AttendanceStatus | null
  created_at: string
  site_timezone: string
}

export interface AutoCheckoutResult {
  processed: number
  message: string
}

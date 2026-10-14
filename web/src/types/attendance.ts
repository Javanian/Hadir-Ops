export type AttendanceStatus = 'ONTIME' | 'LATE' | 'OUT_OF_RADIUS' | 'EARLY'
export type ReviewStatus = 'APPROVED' | 'REJECTED'

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
  // Durable check-in
  is_offline: boolean
  risk_flags: string[]
  needs_review: boolean
  review_status: ReviewStatus | null
  gps_accuracy_m: number | null
  latitude: number | null
  longitude: number | null
  received_at: string | null
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

export type AttemptReason =
  | 'NO_GPS'
  | 'FACE_MISMATCH'
  | 'FACE_ERROR'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'REJECTED'
  | 'OTHER'

/** A check-in or check-out the mobile app tried and could not complete. */
export interface CheckinAttempt {
  id: number
  user_id: number
  employee_id: string
  employee_name: string
  kind: 'CHECKIN' | 'CHECKOUT'
  reason: AttemptReason
  detail: string | null
  captured_at: string
  received_at: string | null
  latitude: number | null
  longitude: number | null
  gps_accuracy_m: number | null
  app_version: string | null
  site_timezone: string
}

export interface AutoCheckoutResult {
  processed: number
  message: string
}

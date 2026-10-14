import apiClient from './axios'
import type {
  TeamAttendanceRecord,
  AttendanceDetail,
  AutoCheckoutResult,
  CheckinAttempt,
  ReviewStatus,
} from '@/types/attendance'

export interface TeamAttendanceParams {
  from_date?: string   // YYYY-MM-DD
  to_date?: string     // YYYY-MM-DD
  limit?: number
  offset?: number
}

export const attendanceApi = {
  /**
   * GET /attendance/team
   * ADMIN sees all records; SUPERVISOR sees own subordinates only.
   */
  getTeam: async (params: TeamAttendanceParams = {}): Promise<TeamAttendanceRecord[]> => {
    const res = await apiClient.get<TeamAttendanceRecord[]>('/attendance/team', { params })
    return res.data
  },

  /**
   * GET /attendance/{id}
   * Returns full record with lat/lon and auto_checkout flag.
   */
  getById: async (id: number): Promise<AttendanceDetail> => {
    const res = await apiClient.get<AttendanceDetail>(`/attendance/${id}`)
    return res.data
  },

  /**
   * GET /attendance/review
   * Records flagged for review (pending) or already reviewed (all).
   */
  getReviewQueue: async (state: 'pending' | 'all' = 'pending'): Promise<TeamAttendanceRecord[]> => {
    const res = await apiClient.get<TeamAttendanceRecord[]>('/attendance/review', { params: { state } })
    return res.data
  },

  /**
   * POST /attendance/{id}/review
   * A note is required to reject.
   */
  review: async (id: number, decision: ReviewStatus, note?: string): Promise<AttendanceDetail> => {
    const res = await apiClient.post<AttendanceDetail>(`/attendance/${id}/review`, { decision, note })
    return res.data
  },

  /**
   * GET /attendance/attempts
   * Check-ins the app could not complete, reported from employees' phones.
   */
  getAttempts: async (params: { from_date?: string; to_date?: string; limit?: number } = {}): Promise<CheckinAttempt[]> => {
    const res = await apiClient.get<CheckinAttempt[]>('/attendance/attempts', { params })
    return res.data
  },

  /**
   * POST /attendance/trigger-auto-checkout
   * ADMIN only — manually runs the auto-checkout batch job.
   */
  triggerAutoCheckout: async (): Promise<AutoCheckoutResult> => {
    const res = await apiClient.post<AutoCheckoutResult>('/attendance/trigger-auto-checkout')
    return res.data
  },
}

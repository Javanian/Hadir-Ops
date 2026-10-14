import apiClient from './axios'
import type { LeaveRequest, LeaveStatus } from '@/types/leave'

export interface TeamLeaveParams {
  status?: LeaveStatus
  from_date?: string // YYYY-MM-DD: requests that end on or after
  to_date?: string   // YYYY-MM-DD: requests that start on or before
  limit?: number
  offset?: number
}

export const leaveApi = {
  /** GET /leave — SUPERVISOR sees direct reports, ADMIN sees everyone. */
  listTeam: async (params: TeamLeaveParams = {}): Promise<LeaveRequest[]> =>
    (await apiClient.get<LeaveRequest[]>('/leave', { params })).data,

  /** POST /leave/{id}/decision — a rejection needs a note. */
  decide: async (id: number, decision: 'APPROVED' | 'REJECTED', note?: string): Promise<LeaveRequest> =>
    (await apiClient.post<LeaveRequest>(`/leave/${id}/decision`, { decision, note })).data,
}

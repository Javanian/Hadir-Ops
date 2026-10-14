export type LeaveType = 'SICK' | 'PERMIT' | 'ANNUAL'
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface LeaveRequest {
  id: number
  user_id: number
  leave_type: LeaveType
  start_date: string // YYYY-MM-DD
  end_date: string   // YYYY-MM-DD
  days: number
  reason: string
  status: LeaveStatus
  reviewed_by: number | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  employee_id: string | null
  employee_name: string | null
  reviewer_name: string | null
}

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  SICK: 'Sakit',
  PERMIT: 'Izin',
  ANNUAL: 'Cuti tahunan',
}

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING: 'Menunggu',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
}

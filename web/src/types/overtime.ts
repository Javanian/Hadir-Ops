export type OvertimeStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface OvertimeRequest {
  id: number
  user_id: number | null
  attendance_id: number | null   // null for overtime requested before working
  employee_id: string | null
  employee_name: string | null
  notes: string | null
  supervisor_notes: string | null
  requested_start: string     // UTC ISO
  requested_end: string       // UTC ISO
  approved_by: number | null  // user ID of approver (not name)
  status: OvertimeStatus
  created_at: string          // UTC ISO
  requested_minutes: number   // computed by backend: (requested_end - requested_start) in minutes
}

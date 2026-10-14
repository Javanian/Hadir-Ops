export type LeaveType = 'SICK' | 'PERMIT' | 'ANNUAL';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: number;
  user_id: number;
  leave_type: LeaveType;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  days: number;
  reason: string;
  status: LeaveStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  employee_id: string | null;
  employee_name: string | null;
  reviewer_name: string | null;
}

export interface LeaveSubmitPayload {
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
}

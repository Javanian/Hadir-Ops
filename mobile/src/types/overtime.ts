export interface OvertimeRequest {
  id: number;
  user_id: number | null;
  attendance_id: number | null;
  requested_start: string;   // UTC ISO 8601
  requested_end: string;     // UTC ISO 8601
  requested_minutes: number; // computed by backend
  approved_by: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  notes: string | null;
  supervisor_notes: string | null;
  created_at: string;
  // Denormalised from submitter (populated by backend)
  employee_id: string | null;
  employee_name: string | null;
}

export interface OvertimeSubmitPayload {
  requested_start: string;   // UTC ISO 8601
  requested_end: string;     // UTC ISO 8601
  notes?: string;
  attendance_id?: number;    // omit for standalone (today/future) overtime
}

export interface ApprovePayload {
  supervisor_notes?: string;
  approved_start?: string;   // UTC ISO 8601 — optional time-window override
  approved_end?: string;     // UTC ISO 8601 — must be paired with approved_start
}

export interface RejectPayload {
  supervisor_notes?: string;
}

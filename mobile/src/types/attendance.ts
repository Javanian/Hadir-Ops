export interface AttendanceRecord {
  id: number;
  user_id: number;
  site_id: number | null;
  shift_id: number | null;
  checkin_time: string;
  checkout_time: string | null;
  auto_checkout: boolean;
  latitude: number | null;
  longitude: number | null;
  work_duration_minutes: number;
  overtime_minutes: number;
  is_weekend: boolean;
  is_holiday: boolean;
  status: 'ONTIME' | 'LATE' | 'OUT_OF_RADIUS' | 'EARLY' | null;
  created_at: string;
  site_timezone: string;
  overtime_request_id: number | null;
  overtime_request_status: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
}

export interface TeamAttendanceRecord {
  id: number;
  user_id: number;
  employee_id: string;
  employee_name: string;
  checkin_time: string;
  checkout_time: string | null;
  work_duration_minutes: number;
  overtime_minutes: number;
  is_weekend: boolean;
  is_holiday: boolean;
  status: 'ONTIME' | 'LATE' | 'OUT_OF_RADIUS' | null;
  created_at: string;
  site_timezone: string;
}

export interface EmployeeSummary {
  user_id: number;
  employee_id: string;
  employee_name: string;
  ontime_count: number;
  late_count: number;
  out_of_radius_count: number;
  total_days: number;
  records: TeamAttendanceRecord[];
}

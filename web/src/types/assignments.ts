export interface AssignmentUser {
  id:          number
  employee_id: string
  full_name:   string
}

export interface AssignmentSite {
  id:       number
  name:     string
  timezone: string
}

export interface AssignmentShift {
  id:         number
  name:       string
  start_time: string   // "HH:MM:SS"
  end_time:   string
}

export interface AssignmentResponse {
  id:         number
  user_id:    number
  site_id:    number
  shift_id:   number
  start_date: string         // "YYYY-MM-DD"
  end_date:   string
  notes:      string | null
  created_by: number | null
  created_at: string
  user:    AssignmentUser
  site:    AssignmentSite
  shift:   AssignmentShift
  creator: AssignmentUser | null
}

export interface AssignmentCreate {
  user_id:    number
  site_id:    number
  shift_id:   number
  start_date: string
  end_date:   string
  notes?:     string
}

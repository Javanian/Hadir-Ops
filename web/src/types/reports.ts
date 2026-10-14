export interface RecapRow {
  user_id: number
  employee_id: string
  name: string
  role: string
  site_name: string | null
  workdays: number
  present: number
  ontime: number
  late: number
  out_of_radius: number
  sick: number
  permit: number
  annual: number
  absent: number
  absent_dates: string[] // YYYY-MM-DD
  work_minutes: number
  overtime_minutes: number
  needs_review: number
}

import type { UserRole } from './auth'

// Response shape expected from GET /users and GET /users/{id}
// TODO: Backend endpoint GET /users is not yet implemented.
// These types reflect the expected schema when the endpoint is added.
export interface UserListItem {
  id: number
  employee_id: string
  name: string
  email: string
  role: UserRole
  site_id: number | null
  site_name: string | null
  site_timezone: string | null
  is_active: boolean
  has_face: boolean
  is_locked: boolean
}

export interface CreateUserPayload {
  employee_id: string
  name: string
  email: string
  password: string
  role: UserRole
  site_id: number | null
  supervisor_id: number | null
}

export interface UpdateUserPayload {
  name?: string
  email?: string
  role?: UserRole
  site_id?: number | null
  supervisor_id?: number | null
  is_active?: boolean
}

export interface SiteOption {
  id: number
  name: string
  timezone: string
}

export interface UserFilters {
  search: string
  role: UserRole | ''
  site_id: number | ''
  page: number
  page_size: number
}

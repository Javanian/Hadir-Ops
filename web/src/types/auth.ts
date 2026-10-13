export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'SALES'

// Mirrors GET /auth/me response from backend
export interface UserInfo {
  id: number
  employee_id: string
  name: string
  email: string
  role: UserRole
  site_id: number | null
  site_timezone: string | null
  is_active: boolean
}

export interface LoginPayload {
  // Backend accepts email or employee_id in the 'identifier' field
  identifier: string
  password: string
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface UserInfo {
  id: number;
  employee_id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE';
  site_id: number | null;
  site_timezone: string | null;
  is_active: boolean;
}

export interface LoginPayload {
  identifier: string;
  password: string;
}

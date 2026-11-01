import apiClient from './axios'
import type { TokenResponse } from '@/types/auth'

export type DemoRole = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE'

// GET /demo: every server answers; `enabled` is true only on a public demo
export interface DemoInfo {
  enabled: boolean
  roles: DemoRole[]
  last_reset_at: string | null
  next_reset_at: string | null
  mobile_app_url: string | null
}

export const demoApi = {
  info: (): Promise<DemoInfo> => apiClient.get<DemoInfo>('/demo').then((r) => r.data),

  login: (role: DemoRole): Promise<TokenResponse> =>
    apiClient.post<TokenResponse>('/demo/login', { role }).then((r) => r.data),
}

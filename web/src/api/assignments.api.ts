import { apiClient } from './axios'
import type { AssignmentResponse, AssignmentCreate } from '@/types/assignments'

export interface AssignmentListParams {
  user_id?:    number
  site_id?:    number
  active_only?: boolean
  skip?:       number
  limit?:      number
}

export const assignmentsApi = {
  list: (params?: AssignmentListParams): Promise<AssignmentResponse[]> =>
    apiClient.get<AssignmentResponse[]>('/assignments', { params }).then((r) => r.data),

  create: (data: AssignmentCreate): Promise<AssignmentResponse> =>
    apiClient.post<AssignmentResponse>('/assignments', data).then((r) => r.data),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/assignments/${id}`).then(() => undefined),

  getActive: (): Promise<AssignmentResponse | null> =>
    apiClient.get<AssignmentResponse | null>('/assignments/active').then((r) => r.data),
}

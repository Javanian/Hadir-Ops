import { apiClient } from './axios'
import type { OvertimeRequest } from '@/types/overtime'

interface OvertimeListParams {
  status?: string
  limit?: number
  offset?: number
}

export const overtimeApi = {
  list: async (params: OvertimeListParams = {}): Promise<OvertimeRequest[]> =>
    (await apiClient.get<OvertimeRequest[]>('/overtime', { params })).data,

  getById: async (id: number): Promise<OvertimeRequest> =>
    (await apiClient.get<OvertimeRequest>(`/overtime/${id}`)).data,

  approve: async (id: number): Promise<OvertimeRequest> =>
    (await apiClient.patch<OvertimeRequest>(`/overtime/${id}/approve`)).data,

  reject: async (id: number): Promise<OvertimeRequest> =>
    (await apiClient.patch<OvertimeRequest>(`/overtime/${id}/reject`)).data,
}

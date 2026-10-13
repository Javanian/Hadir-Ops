import { apiClient } from './axios';
import {
  ApprovePayload,
  OvertimeRequest,
  OvertimeSubmitPayload,
  RejectPayload,
} from '../types/overtime';

interface ListParams {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  limit?: number;
  offset?: number;
}

export const overtimeApi = {
  /** Current user's own requests (works for all roles). */
  listMine: (params?: ListParams): Promise<OvertimeRequest[]> =>
    apiClient.get<OvertimeRequest[]>('/overtime/me', { params }).then((r) => r.data),

  /** Role-scoped list (EMPLOYEE=own, SUPERVISOR=team, ADMIN=all). */
  listTeam: (params?: ListParams): Promise<OvertimeRequest[]> =>
    apiClient.get<OvertimeRequest[]>('/overtime', { params }).then((r) => r.data),

  getById: (id: number): Promise<OvertimeRequest> =>
    apiClient.get<OvertimeRequest>(`/overtime/${id}`).then((r) => r.data),

  submit: (data: OvertimeSubmitPayload): Promise<OvertimeRequest> =>
    apiClient.post<OvertimeRequest>('/overtime', data).then((r) => r.data),

  approve: (id: number, body: ApprovePayload = {}): Promise<OvertimeRequest> =>
    apiClient.patch<OvertimeRequest>(`/overtime/${id}/approve`, body).then((r) => r.data),

  reject: (id: number, body: RejectPayload = {}): Promise<OvertimeRequest> =>
    apiClient.patch<OvertimeRequest>(`/overtime/${id}/reject`, body).then((r) => r.data),
};

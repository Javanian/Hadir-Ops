import { apiClient } from './axios';
import type { LeaveRequest, LeaveSubmitPayload } from '../types/leave';

export const leaveApi = {
  /** Current user's own requests. */
  listMine: (): Promise<LeaveRequest[]> =>
    apiClient.get<LeaveRequest[]>('/leave/me', { params: { limit: 100 } }).then((r) => r.data),

  submit: (data: LeaveSubmitPayload): Promise<LeaveRequest> =>
    apiClient.post<LeaveRequest>('/leave', data).then((r) => r.data),

  cancel: (id: number): Promise<LeaveRequest> =>
    apiClient.post<LeaveRequest>(`/leave/${id}/cancel`).then((r) => r.data),
};

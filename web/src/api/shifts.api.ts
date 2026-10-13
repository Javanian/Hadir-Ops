import { apiClient } from './axios'
import type {
  ShiftResponse,
  ShiftCreatePayload,
  ShiftUpdatePayload,
  WorkScheduleCreatePayload,
  WorkScheduleResponse,
  HolidayResponse,
  HolidayCreatePayload,
  HolidayUpdatePayload,
} from '@/types/shifts'

// ── Shifts ────────────────────────────────────────────────────────────────────

export const shiftsApi = {
  list: (siteId?: number): Promise<ShiftResponse[]> =>
    apiClient
      .get('/shifts', { params: siteId != null ? { site_id: siteId } : undefined })
      .then((r) => r.data),

  create: (payload: ShiftCreatePayload): Promise<ShiftResponse> =>
    apiClient.post('/shifts', payload).then((r) => r.data),

  // Backend uses PATCH (not PUT)
  update: (id: number, payload: ShiftUpdatePayload): Promise<ShiftResponse> =>
    apiClient.patch(`/shifts/${id}`, payload).then((r) => r.data),

  // ADMIN only
  delete: (id: number): Promise<void> =>
    apiClient.delete(`/shifts/${id}`).then(() => undefined),

  // ── Schedules ──────────────────────────────────────────────────────────────

  // POST /shifts/{shift_id}/schedules
  addSchedule: (shiftId: number, payload: WorkScheduleCreatePayload): Promise<WorkScheduleResponse> =>
    apiClient.post(`/shifts/${shiftId}/schedules`, payload).then((r) => r.data),

  // DELETE /schedules/{schedule_id}  (note: NOT /shifts/{id}/schedules/{id})
  deleteSchedule: (scheduleId: number): Promise<void> =>
    apiClient.delete(`/schedules/${scheduleId}`).then(() => undefined),
}

// ── Holidays ──────────────────────────────────────────────────────────────────

export const holidaysApi = {
  list: (): Promise<HolidayResponse[]> =>
    apiClient.get('/holidays').then((r) => r.data),

  create: (payload: HolidayCreatePayload): Promise<HolidayResponse> =>
    apiClient.post('/holidays', payload).then((r) => r.data),

  // Backend uses PATCH
  update: (id: number, payload: HolidayUpdatePayload): Promise<HolidayResponse> =>
    apiClient.patch(`/holidays/${id}`, payload).then((r) => r.data),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/holidays/${id}`).then(() => undefined),
}

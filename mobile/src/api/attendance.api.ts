import { apiClient } from './axios';
import { AttendanceRecord, TeamAttendanceRecord } from '../types/attendance';

interface GetMyAttendanceParams {
  from_date?: string;
  to_date?: string;
  timezone?: string;
  limit?: number;
  offset?: number;
}

interface GetTeamAttendanceParams {
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

/** Fields the outbox adds to every check-in / check-out (see backend _DeviceEvent). */
export interface DeviceEventFields {
  client_event_id: string;
  captured_at: string;
  capture_age_ms?: number;
  accuracy_m?: number;
  is_mocked?: boolean;
  face_token?: string;
}

export interface CheckinBody extends DeviceEventFields {
  latitude: number;
  longitude: number;
}

export interface CheckoutBody extends DeviceEventFields {
  latitude?: number;
  longitude?: number;
}

export type AttemptReason =
  | 'NO_GPS'
  | 'FACE_MISMATCH'
  | 'FACE_ERROR'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'REJECTED'
  | 'OTHER';

export interface AttemptBody {
  client_event_id: string;
  kind: 'CHECKIN' | 'CHECKOUT';
  reason: AttemptReason;
  detail?: string;
  captured_at: string;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  app_version?: string;
}

// The outbox sends these; it shows its own status, so no error toasts.
const silent = { silent: true } as Record<string, unknown>;

export const attendanceApi = {
  getMyAttendance: (params?: GetMyAttendanceParams): Promise<AttendanceRecord[]> =>
    apiClient
      .get<AttendanceRecord[]>('/attendance/me', { params })
      .then((r) => r.data),

  checkin: (body: CheckinBody): Promise<AttendanceRecord> =>
    apiClient.post<AttendanceRecord>('/attendance/checkin', body, silent).then((r) => r.data),

  checkout: (body: CheckoutBody): Promise<AttendanceRecord> =>
    apiClient.post<AttendanceRecord>('/attendance/checkout', body, silent).then((r) => r.data),

  reportAttempts: (attempts: AttemptBody[]): Promise<{ accepted: number; duplicates: number }> =>
    apiClient
      .post<{ accepted: number; duplicates: number }>('/attendance/attempts', { attempts }, silent)
      .then((r) => r.data),

  getTeamAttendance: (params?: GetTeamAttendanceParams): Promise<TeamAttendanceRecord[]> =>
    apiClient
      .get<TeamAttendanceRecord[]>('/attendance/team', { params })
      .then((r) => r.data),
};

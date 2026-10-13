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

export const attendanceApi = {
  getMyAttendance: (params?: GetMyAttendanceParams): Promise<AttendanceRecord[]> =>
    apiClient
      .get<AttendanceRecord[]>('/attendance/me', { params })
      .then((r) => r.data),

  checkin: (data: { latitude: number; longitude: number }): Promise<AttendanceRecord> => {
    console.log('[attendanceApi] checkin called — coords:', data);
    return apiClient
      .post<AttendanceRecord>('/attendance/checkin', data)
      .then((r) => { console.log('[attendanceApi] checkin — HTTP', r.status); return r.data; });
  },

  checkout: (data: { latitude?: number; longitude?: number }): Promise<AttendanceRecord> =>
    apiClient
      .post<AttendanceRecord>('/attendance/checkout', data)
      .then((r) => r.data),

  getTeamAttendance: (params?: GetTeamAttendanceParams): Promise<TeamAttendanceRecord[]> =>
    apiClient
      .get<TeamAttendanceRecord[]>('/attendance/team', { params })
      .then((r) => r.data),
};

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { attendanceApi } from '../api/attendance.api';
import { AttendanceRecord } from '../types/attendance';

export function useCheckin() {
  const queryClient = useQueryClient();
  return useMutation<AttendanceRecord, Error, { latitude: number; longitude: number }>({
    mutationFn: attendanceApi.checkin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'today'] });
    },
  });
}

export function useCheckout() {
  const queryClient = useQueryClient();
  return useMutation<AttendanceRecord, Error, { latitude?: number; longitude?: number }>({
    mutationFn: attendanceApi.checkout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'today'] });
    },
  });
}

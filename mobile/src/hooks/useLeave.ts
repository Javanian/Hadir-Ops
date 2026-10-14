import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '../api/leave.api';
import type { LeaveRequest, LeaveSubmitPayload } from '../types/leave';

export function useMyLeave() {
  return useQuery<LeaveRequest[]>({
    queryKey: ['leave', 'my'],
    queryFn: leaveApi.listMine,
    staleTime: 30 * 1000,
    retry: false,
  });
}

export function useSubmitLeave() {
  const qc = useQueryClient();
  return useMutation<LeaveRequest, Error, LeaveSubmitPayload>({
    mutationFn: leaveApi.submit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave', 'my'] });
    },
  });
}

export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation<LeaveRequest, Error, number>({
    mutationFn: leaveApi.cancel,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave', 'my'] });
    },
  });
}

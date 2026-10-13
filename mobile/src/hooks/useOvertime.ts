import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { overtimeApi } from '../api/overtime.api';
import type {
  ApprovePayload,
  OvertimeRequest,
  OvertimeSubmitPayload,
  RejectPayload,
} from '../types/overtime';

// ── Queries ───────────────────────────────────────────────────────────────────

/** Current user's own overtime requests (all roles). */
export function useMyOvertimes(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  return useQuery<OvertimeRequest[]>({
    queryKey: ['overtime', 'my', status ?? 'all'],
    queryFn: () => overtimeApi.listMine({ status, limit: 100 }),
    staleTime: 30 * 1000,
    retry: false,
  });
}

/** Role-scoped team list (SUPERVISOR/ADMIN only). */
export function useTeamOvertimes(
  status?: 'PENDING' | 'APPROVED' | 'REJECTED',
  enabled = true,
) {
  return useQuery<OvertimeRequest[]>({
    queryKey: ['overtime', 'team', status ?? 'all'],
    queryFn: () => overtimeApi.listTeam({ status, limit: 200 }),
    staleTime: 30 * 1000,
    enabled,
    retry: false,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useSubmitOvertime() {
  const qc = useQueryClient();
  return useMutation<OvertimeRequest, Error, OvertimeSubmitPayload>({
    mutationFn: overtimeApi.submit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overtime', 'my'] });
    },
  });
}

export function useApproveOvertime() {
  const qc = useQueryClient();
  return useMutation<OvertimeRequest, Error, { id: number; body: ApprovePayload }>({
    mutationFn: ({ id, body }) => overtimeApi.approve(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overtime'] });
    },
  });
}

export function useRejectOvertime() {
  const qc = useQueryClient();
  return useMutation<OvertimeRequest, Error, { id: number; body: RejectPayload }>({
    mutationFn: ({ id, body }) => overtimeApi.reject(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overtime'] });
    },
  });
}

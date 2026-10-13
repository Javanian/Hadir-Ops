import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { attendanceApi } from '../api/attendance.api';
import { AttendanceRecord, TeamAttendanceRecord } from '../types/attendance';

// Default page / initial load size — enough for one month without being excessive
const PAGE_SIZE = 30;

function getTodayString(tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ── Today (HomeScreen) ────────────────────────────────────────────────────────

export function useTodayAttendance(siteTimezone: string = 'Asia/Jakarta') {
  const todayStr = getTodayString(siteTimezone);

  return useQuery<AttendanceRecord | null>({
    queryKey: ['attendance', 'today', todayStr],
    queryFn: async () => {
      const records = await attendanceApi.getMyAttendance({
        from_date: todayStr,
        to_date: todayStr,
        timezone: siteTimezone,
        limit: 1,
      });
      return records[0] ?? null;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

// ── My attendance history (HistoryScreen) ─────────────────────────────────────
//
// fromDate / toDate are 'yyyy-mm-dd' strings (site-local calendar day).
// When both are null the backend returns the most-recent PAGE_SIZE records.

export function useAttendanceHistory(
  fromDate: string | null,
  toDate: string | null,
  siteTimezone: string = 'Asia/Jakarta',
) {
  return useInfiniteQuery<AttendanceRecord[]>({
    queryKey: ['attendance', 'history', fromDate, toDate, siteTimezone],
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      return attendanceApi.getMyAttendance({
        from_date: fromDate ?? undefined,
        to_date: toDate ?? undefined,
        timezone: siteTimezone,
        limit: PAGE_SIZE,
        offset,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.flat().length;
    },
    initialPageParam: 0,
    staleTime: 30 * 1000,
  });
}

// ── Team / subordinate attendance (SubordinateAttendanceScreen) ───────────────
//
// fromDate / toDate are optional date-range filters.
// When null → backend returns the most-recent 30 records across all subordinates.
// When set  → backend returns all records in the range (up to 1 000).

export function useTeamAttendance(
  fromDate: string | null,
  toDate: string | null,
) {
  const hasFilter = fromDate !== null || toDate !== null;
  return useQuery<TeamAttendanceRecord[]>({
    queryKey: ['attendance', 'team', fromDate, toDate],
    queryFn: async () =>
      attendanceApi.getTeamAttendance({
        from_date: fromDate ?? undefined,
        to_date: toDate ?? undefined,
        limit: hasFilter ? 1000 : PAGE_SIZE,
      }),
    staleTime: 30 * 1000,
    retry: false,
  });
}

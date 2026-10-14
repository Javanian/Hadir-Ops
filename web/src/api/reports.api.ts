import apiClient from './axios'
import type { RecapRow } from '@/types/reports'

export const reportsApi = {
  /** GET /reports/recap — per-employee recap (max 62 days). */
  recap: async (fromDate: string, toDate: string): Promise<RecapRow[]> =>
    (await apiClient.get<RecapRow[]>('/reports/recap', { params: { from_date: fromDate, to_date: toDate } })).data,
}

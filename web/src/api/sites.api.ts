import { apiClient } from './axios'
import type { SiteResponse, SiteCreatePayload, SiteUpdatePayload } from '@/types/sites'

export const sitesApi = {
  list: (): Promise<SiteResponse[]> =>
    apiClient.get('/sites').then((r) => r.data),

  create: (payload: SiteCreatePayload): Promise<SiteResponse> =>
    apiClient.post('/sites', payload).then((r) => r.data),

  // Backend uses PATCH (not PUT)
  update: (id: number, payload: SiteUpdatePayload): Promise<SiteResponse> =>
    apiClient.patch(`/sites/${id}`, payload).then((r) => r.data),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/sites/${id}`).then(() => undefined),
}

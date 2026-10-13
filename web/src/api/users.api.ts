/**
 * User Management API
 *
 * NOTE: The following backend endpoints are NOT yet implemented in the backend:
 *   - GET  /users          (list all users with pagination + filters)
 *   - POST /users          (admin user creation)
 *   - PUT  /users/{id}     (update user)
 *   - DELETE /users/{id}   (delete user)
 *   - GET  /users/{id}     (user detail)
 *
 * TODO: Add a users router to backend/app/routers/users.py and register it in main.py.
 *
 * Available (implemented) endpoints used here:
 *   - GET  /sites              → for site assignment dropdown
 *   - GET  /face/status/{id}  → face registration status
 *   - DELETE /face/{id}       → remove face embedding (ADMIN only)
 */

import { apiClient } from './axios'
import type { UserListItem, CreateUserPayload, UpdateUserPayload, SiteOption } from '@/types/users'

export interface UserListResponse {
  items: UserListItem[]
  total: number
  page: number
  page_size: number
}

export interface UserFiltersParams {
  search?: string
  role?: string
  site_id?: number
  page?: number
  page_size?: number
}

export const usersApi = {
  // TODO: GET /users not implemented in backend yet
  list: (params?: UserFiltersParams): Promise<UserListResponse> =>
    apiClient.get('/users', { params }).then((r) => r.data),

  // TODO: GET /users/{id} not implemented in backend yet
  getById: (id: number): Promise<UserListItem> =>
    apiClient.get(`/users/${id}`).then((r) => r.data),

  // TODO: POST /users not implemented in backend yet
  create: (payload: CreateUserPayload): Promise<UserListItem> =>
    apiClient.post('/users', payload).then((r) => r.data),

  // TODO: PUT /users/{id} not implemented in backend yet
  update: (id: number, payload: UpdateUserPayload): Promise<UserListItem> =>
    apiClient.put(`/users/${id}`, payload).then((r) => r.data),

  // TODO: DELETE /users/{id} not implemented in backend yet
  delete: (id: number): Promise<void> =>
    apiClient.delete(`/users/${id}`).then(() => undefined),

  // ✅ Available: GET /sites (for dropdown)
  listSites: (): Promise<SiteOption[]> =>
    apiClient.get('/sites').then((r) => r.data),

  // ✅ Available: GET /face/status/{user_id}
  getFaceStatus: (userId: number): Promise<{ user_id: number; name: string; has_face: boolean }> =>
    apiClient.get(`/face/status/${userId}`).then((r) => r.data),

  // ✅ Available: DELETE /face/{user_id} (ADMIN only)
  deleteFace: (userId: number): Promise<void> =>
    apiClient.delete(`/face/${userId}`).then(() => undefined),
}

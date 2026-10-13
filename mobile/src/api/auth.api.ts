import { apiClient } from './axios';
import { LoginPayload, TokenResponse, UserInfo } from '../types/auth';

export const authApi = {
  login: (payload: LoginPayload): Promise<TokenResponse> =>
    apiClient.post<TokenResponse>('/auth/login', payload).then((r) => r.data),

  refresh: (refreshToken: string): Promise<TokenResponse> =>
    apiClient
      .post<TokenResponse>('/auth/refresh', { refresh_token: refreshToken })
      .then((r) => r.data),

  me: (): Promise<UserInfo> =>
    apiClient.get<UserInfo>('/auth/me').then((r) => r.data),

  changePassword: (payload: { current_password: string; new_password: string }): Promise<void> =>
    apiClient.post('/auth/change-password', payload).then(() => undefined),
};

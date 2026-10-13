import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth.api';
import { isAxiosError } from '../api/axios';
import { clearTokens, persistTokens, setAuthUser, setInitialized } from '../store/authStore';
import { LoginPayload } from '../types/auth';
import { showSuccess } from '../utils/toast';

export const AUTH_QUERY_KEYS = {
  me: ['auth', 'me'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: AUTH_QUERY_KEYS.me,
    queryFn: authApi.me,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: async (data) => {
      await persistTokens(data);
      try {
        const user = await authApi.me();
        setAuthUser(user);
        queryClient.setQueryData(AUTH_QUERY_KEYS.me, user);
      } catch (meError) {
        if (__DEV__) console.error('[useLogin] authApi.me() failed after login:', meError);
        // Only allow offline navigation for genuine network errors (server unreachable).
        // For any auth/token error the interceptor has already called clearTokens(),
        // leaving SecureStore empty. Setting isAuthenticated=true with no tokens would
        // cause every subsequent API call to throw "No refresh token available".
        const isNetworkError = isAxiosError(meError) && meError.response === undefined;
        if (isNetworkError) {
          setInitialized(true);
        } else {
          await clearTokens();
          setInitialized(false);
        }
      }
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return async () => {
    await clearTokens();
    setAuthUser(null);
    queryClient.clear();
  };
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { current_password: string; new_password: string }) =>
      authApi.changePassword(payload),
    onSuccess: async () => {
      showSuccess('Silakan login kembali dengan password baru.', 'Password diperbarui');
      await clearTokens();
      setAuthUser(null);
      queryClient.clear();
    },
  });
}

import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/auth.api'
import { isAxiosError } from '@/api/axios'
import { tokenAccessors, REFRESH_TOKEN_KEY, useAuthStore } from '@/store/authStore'
import { queryClient } from '@/lib/queryClient'
import type { LoginPayload, UserRole } from '@/types/auth'

export function useLogin() {
  const { login } = useAuthStore()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),

    onSuccess: async (tokenData) => {
      // Step 1: put access token into the module-level ref IMMEDIATELY so that
      // the subsequent /auth/me request has a Bearer token in its header.
      // (We can't call login() first because that's a setState — async, not immediate)
      tokenAccessors.setTokens(tokenData.access_token, tokenData.refresh_token)

      try {
        const user = await authApi.me()

        // Step 2: commit to full login state (sets React state + sessionStorage again)
        login(tokenData, user)
        queryClient.setQueryData(['auth', 'me'], user)
        navigate('/dashboard', { replace: true })
      } catch (meError) {
        // /auth/me failed — roll back the token injection
        if (!import.meta.env.PROD) {
          console.error('[useLogin] /auth/me failed after login:', meError)
        }
        tokenAccessors.setTokens('', '')
        sessionStorage.removeItem(REFRESH_TOKEN_KEY)
      }
    },
    // Note: login errors are handled inline in LoginPage via mutation.error,
    // NOT via the Axios error toast interceptor (which fires for all requests).
    // The interceptor fires first, but the component can also catch the error.
  })
}

export function useLogout() {
  const { logout } = useAuthStore()
  const navigate = useNavigate()

  return () => {
    logout()
    queryClient.clear()
    navigate('/login', { replace: true })
  }
}

export function useCurrentUser() {
  const { user } = useAuthStore()
  return user
}

// Helper to check if current user has a given role
export function useHasRole(...roles: UserRole[]) {
  const { user } = useAuthStore()
  if (!user) return false
  return roles.includes(user.role)
}

// Helper: extract a human-readable error message from a login error
export function getLoginErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    if (!error.response) {
      return 'Tidak dapat terhubung ke server. Pastikan backend berjalan.'
    }

    // Try to read the detail field from response body first
    const detail = (error.response.data as { detail?: string })?.detail
    if (detail) return detail

    switch (error.response.status) {
      case 401:
        return 'Email/ID atau password salah.'
      case 403:
        return 'Akun terkunci karena terlalu banyak percobaan. Coba lagi nanti.'
      case 423:
        return 'Akun terkunci karena terlalu banyak percobaan. Coba lagi dalam 30 menit.'
      case 429:
        return 'Terlalu banyak percobaan login. Silakan tunggu sebentar.'
      default:
        if (error.response.status >= 500) {
          return 'Server error. Silakan coba lagi nanti.'
        }
    }
  }
  return 'Terjadi kesalahan. Silakan coba lagi.'
}

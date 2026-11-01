import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { authApi } from '@/api/auth.api'
import { isAxiosError } from '@/api/axios'
import { tokenAccessors, REFRESH_TOKEN_KEY, useAuthStore } from '@/store/authStore'
import { queryClient } from '@/lib/queryClient'
import type { LoginPayload, TokenResponse, UserRole } from '@/types/auth'
import { t } from '@/i18n'

/** Finishes a sign-in once tokens arrive (password or one-click demo login). */
export function useCompleteLogin() {
  const { login } = useAuthStore()
  const navigate = useNavigate()

  return async (tokenData: TokenResponse) => {
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
  }
}

export function useLogin() {
  const completeLogin = useCompleteLogin()

  return useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: completeLogin,
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
      return t('auth.cannotReachTheServerMake')
    }

    // Try to read the detail field from response body first
    const detail = (error.response.data as { detail?: string })?.detail
    if (detail) return detail

    switch (error.response.status) {
      case 401:
        return t('auth.wrongEmailIdOrPassword')
      case 403:
        return t('auth.theAccountIsLockedAfter2')
      case 423:
        return t('auth.theAccountIsLockedAfter')
      case 429:
        return t('auth.tooManySignInAttempts')
      default:
        if (error.response.status >= 500) {
          return t('auth.serverErrorPleaseTryAgain')
        }
    }
  }
  return t('auth.somethingWentWrongPleaseTry')
}

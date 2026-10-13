import { createContext, useContext } from 'react'
import type { UserInfo, TokenResponse } from '@/types/auth'

// ─── sessionStorage key ────────────────────────────────────────────────────────
export const REFRESH_TOKEN_KEY = 'presensiv2_refresh_token'

// ─── Module-level token accessors (for Axios interceptors) ────────────────────
// Axios interceptors run outside React — they cannot call useContext.
// AuthProvider (in AuthProvider.tsx) injects getter/setter on mount via injectTokenAccessors().
// The getter reads accessTokenRef.current which is updated on every render — never stale.
let _getAccessToken: () => string | null = () => null
let _setTokens: (accessToken: string, refreshToken: string) => void = () => {}

export function injectTokenAccessors(
  getter: () => string | null,
  setter: (access: string, refresh: string) => void,
) {
  _getAccessToken = getter
  _setTokens = setter
}

/**
 * Called by Axios interceptors (outside React).
 * getAccessToken: reads current access token (never stale — uses a ref)
 * setTokens:      updates token in React state + sessionStorage
 */
export const tokenAccessors = {
  getAccessToken: () => _getAccessToken(),
  setTokens: (access: string, refresh: string) => _setTokens(access, refresh),
}

// ─── Auth Context ──────────────────────────────────────────────────────────────
export interface AuthContextValue {
  user: UserInfo | null
  accessToken: string | null
  isInitialized: boolean
  isAuthenticated: boolean
  login: (tokens: TokenResponse, user: UserInfo) => void
  logout: () => void
  updateTokens: (tokens: TokenResponse) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

// ─── Hook ──────────────────────────────────────────────────────────────────────
export function useAuthStore(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthStore must be used within <AuthProvider>')
  return ctx
}

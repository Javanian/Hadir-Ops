import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import {
  AuthContext,
  REFRESH_TOKEN_KEY,
  injectTokenAccessors,
  tokenAccessors,
  type AuthContextValue,
} from './authStore'
import type { UserInfo, TokenResponse } from '@/types/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Mutable ref so the module-level getter never has a stale closure.
  // Updated synchronously on every render (before any useEffect runs).
  const accessTokenRef = useRef<string | null>(null)
  accessTokenRef.current = accessToken

  const logout = useCallback(() => {
    setAccessToken(null)
    accessTokenRef.current = null
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
    setUser(null)
  }, [])

  const login = useCallback((tokens: TokenResponse, userInfo: UserInfo) => {
    setAccessToken(tokens.access_token)
    accessTokenRef.current = tokens.access_token
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
    setUser(userInfo)
  }, [])

  const updateTokens = useCallback((tokens: TokenResponse) => {
    setAccessToken(tokens.access_token)
    accessTokenRef.current = tokens.access_token
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
  }, [])

  // Inject module-level accessors once so Axios interceptors can reach them.
  // The getter uses accessTokenRef.current — always fresh, no stale closure.
  useEffect(() => {
    injectTokenAccessors(
      () => accessTokenRef.current,
      (access, refresh) => {
        setAccessToken(access)
        accessTokenRef.current = access
        sessionStorage.setItem(REFRESH_TOKEN_KEY, refresh)
      },
    )
  }, []) // empty deps — inject once; ref handles freshness

  // Listen for forced logout event dispatched by Axios interceptor on refresh failure.
  useEffect(() => {
    function handleForceLogout() {
      logout()
    }
    window.addEventListener('auth:logout-required', handleForceLogout)
    return () => window.removeEventListener('auth:logout-required', handleForceLogout)
  }, [logout])

  // Session restoration on app init — runs once on mount.
  // Uses raw fetch (not apiClient) to avoid the 401 interceptor loop.
  useEffect(() => {
    async function restoreSession() {
      const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY)
      if (!refreshToken) {
        setIsInitialized(true)
        return
      }

      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (!refreshRes.ok) throw new Error('refresh failed')

        const tokens = (await refreshRes.json()) as TokenResponse

        // Put access token in ref immediately so /auth/me request has a Bearer header
        accessTokenRef.current = tokens.access_token
        sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
        // Also update the module-level accessor so subsequent calls work
        tokenAccessors.setTokens(tokens.access_token, tokens.refresh_token)

        const meRes = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        if (!meRes.ok) throw new Error('me failed')

        const userInfo = (await meRes.json()) as UserInfo
        setAccessToken(tokens.access_token)
        setUser(userInfo)
      } catch {
        // Refresh or /me failed — clear the stale token and start unauthenticated
        sessionStorage.removeItem(REFRESH_TOKEN_KEY)
        accessTokenRef.current = null
      } finally {
        setIsInitialized(true)
      }
    }

    void restoreSession()
  }, []) // runs once on mount

  const value: AuthContextValue = {
    user,
    accessToken,
    isInitialized,
    isAuthenticated: user !== null && accessToken !== null,
    login,
    logout,
    updateTokens,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

import React, { useEffect } from 'react';
import LoadingScreen from './LoadingScreen';
import { authApi } from '../api/auth.api';
import { isAxiosError } from '../api/axios';
import {
  getStoredTokens,
  setAuthUser,
  setInitialized,
} from '../store/authStore';

export default function SplashScreen() {
  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const { access, refresh } = await getStoredTokens();

        // Both tokens must be present. If only the access token survived
        // (SecureStore inconsistency, partial write, etc.) the session will
        // fail as soon as the access token expires — the interceptor cannot
        // refresh without a refresh token. Force re-login in that case.
        if (!access || !refresh) {
          if (!cancelled) setInitialized(false);
          return;
        }

        try {
          const user = await authApi.me();
          if (!cancelled) setAuthUser(user);
        } catch (authError: unknown) {
          if (!cancelled) {
            // Network error (no response) — allow offline access with stored tokens
            const isNetworkError =
              isAxiosError(authError) && authError.response === undefined;
            if (isNetworkError) {
              setInitialized(true);
            } else {
              // Auth error (401, refresh also failed in interceptor) — force login
              setInitialized(false);
            }
          }
        }
      } catch {
        if (!cancelled) setInitialized(false);
      }
    }

    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  return <LoadingScreen message="Connecting..." />;
}

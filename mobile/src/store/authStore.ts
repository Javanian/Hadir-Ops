import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { TokenResponse, UserInfo } from '../types/auth';

// expo-secure-store tidak support web — fallback ke localStorage
const storage = {
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value);
  },
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async deleteItem(key: string) {
    if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
    await SecureStore.deleteItemAsync(key);
  },
};

export const TOKEN_KEYS = {
  ACCESS: 'presensiv2_access_token',
  REFRESH: 'presensiv2_refresh_token',
} as const;

interface AuthState {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
}

let state: AuthState = {
  user: null,
  isAuthenticated: false,
  isInitialized: false,
};

type Listener = (state: AuthState) => void;
const listeners: Set<Listener> = new Set();

function notify() {
  listeners.forEach((listener) => listener({ ...state }));
}

export function getAuthState(): AuthState {
  return { ...state };
}

function getAuthSnapshot(): AuthState {
  return state;
}

export function subscribeToAuthState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribeToAuthState, getAuthSnapshot, getAuthSnapshot);
}

export function setAuthUser(user: UserInfo | null): void {
  state = {
    user,
    isAuthenticated: user !== null,
    isInitialized: true,
  };
  notify();
}

export function setInitialized(isAuthenticated: boolean): void {
  state = {
    ...state,
    isAuthenticated: isAuthenticated && state.user !== null,
    isInitialized: true,
  };
  notify();
}

export async function persistTokens(tokens: TokenResponse): Promise<void> {
  await Promise.all([
    storage.setItem(TOKEN_KEYS.ACCESS, tokens.access_token),
    storage.setItem(TOKEN_KEYS.REFRESH, tokens.refresh_token),
  ]);
}

export async function getStoredTokens(): Promise<{
  access: string | null;
  refresh: string | null;
}> {
  const [access, refresh] = await Promise.all([
    storage.getItem(TOKEN_KEYS.ACCESS),
    storage.getItem(TOKEN_KEYS.REFRESH),
  ]);
  return { access, refresh };
}

export async function clearTokens(): Promise<void> {
  const stack = new Error('clearTokens called').stack ?? '(no stack)';
  console.log('[authStore] clearTokens() —', stack);
  await Promise.all([
    storage.deleteItem(TOKEN_KEYS.ACCESS),
    storage.deleteItem(TOKEN_KEYS.REFRESH),
  ]);
  state = {
    user: null,
    isAuthenticated: false,
    isInitialized: true,
  };
  notify();
}

import axios, {
  AxiosError,
  InternalAxiosRequestConfig,
  isAxiosError,
} from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { TOKEN_KEYS, clearTokens, persistTokens, getStoredTokens } from '../store/authStore';
import { TokenResponse } from '../types/auth';
import { showError } from '../utils/toast';

const API_BASE_OVERRIDE = process.env['EXPO_PUBLIC_API_BASE_URL']?.trim();
const API_PORT = process.env['EXPO_PUBLIC_API_PORT']?.trim() || '8000';
const TIMEOUT = Number(process.env['EXPO_PUBLIC_API_TIMEOUT'] ?? 10000);

function getExpoHost(): string | null {
  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest?: { debuggerHost?: string; hostUri?: string };
    manifest2?: {
      extra?: {
        expoClient?: { hostUri?: string };
        expoGo?: { debuggerHost?: string };
      };
    };
  };

  const hostUri =
    constants.expoConfig?.hostUri ??
    constants.manifest2?.extra?.expoClient?.hostUri ??
    constants.manifest2?.extra?.expoGo?.debuggerHost ??
    constants.manifest?.debuggerHost ??
    constants.manifest?.hostUri;

  if (!hostUri) return null;
  const hostWithPort = hostUri.replace(/^https?:\/\//, '').split('/')[0];
  return hostWithPort?.split(':')[0] || null;
}

function resolveBaseUrl(): string {
  if (API_BASE_OVERRIDE && API_BASE_OVERRIDE.toLowerCase() !== 'auto') {
    const raw = API_BASE_OVERRIDE.replace(/\/+$/, '');
    if (/^https?:\/\//i.test(raw)) return raw;
    return `http://${raw}:${API_PORT}`;
  }

  const expoHost = getExpoHost();
  if (expoHost) return `http://${expoHost}:${API_PORT}`;

  if (Platform.OS === 'android') return `http://10.0.2.2:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

export const BASE_URL = resolveBaseUrl();
console.log('[axios] AXIOS INTERCEPTOR LOADED — BASE_URL:', BASE_URL);

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});


apiClient.interceptors.request.use(async (config) => {
  const { access: token } = await getStoredTokens();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});


type QueueEntry = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

let isRefreshing = false;
let failedQueue: QueueEntry[] = [];

function setIsRefreshing(value: boolean, reason: string) {
  console.log(`[axios] isRefreshing: ${isRefreshing} → ${value} (${reason})`);
  isRefreshing = value;
}

function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error !== null) {
      reject(error);
    } else {
      resolve(token as string);
    }
  });
  failedQueue = [];
}

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;

    // Never attempt refresh for auth endpoints — pass the original error straight through
    const url = originalRequest?.url ?? '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh');

    if (
      error.response?.status !== 401 ||
      originalRequest == null ||
      originalRequest._retry === true ||
      isAuthEndpoint
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return apiClient(originalRequest);
      });
    }

    originalRequest._retry = true;
    setIsRefreshing(true, `401 on ${originalRequest.url ?? 'unknown'}`);

    try {
      const { refresh: refreshToken } = await getStoredTokens();
      console.log(
        `[axios] refresh token from storage: ${refreshToken ? refreshToken.slice(0, 10) + '…' : 'null'}`
      );
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

     
      const { data } = await axios.post<TokenResponse>(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      });

      await persistTokens(data);

      processQueue(null, data.access_token);

   
      if (originalRequest.data instanceof FormData) {
        (error as any).__formDataGuard = true;
        return Promise.reject(error);
      }

      originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
      return apiClient(originalRequest);
    } catch (refreshError: unknown) {
      processQueue(refreshError, null);
      showError('Sesi habis, silakan login ulang', 'Sesi Berakhir');
      await clearTokens();
      return Promise.reject(refreshError);
    } finally {
      setIsRefreshing(false, 'refresh complete');
    }
  }
);

// ── Non-401 error toast handler ──────────────────────────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const url = error.config?.url ?? '';

    // 401 is handled by the refresh interceptor above — skip here
    if (status === 401) return Promise.reject(error);

    // Auth endpoints handle their own errors in the screen — skip toasts for them
    if (url.includes('/auth/login') || url.includes('/auth/change-password')) {
      return Promise.reject(error);
    }

    if (!error.response) {
      // Network error / timeout
      showError('Tidak ada koneksi internet atau server tidak dapat dijangkau', 'Koneksi Gagal');
    } else if (status === 403) {
      showError('Anda tidak memiliki izin untuk melakukan tindakan ini', 'Akses Ditolak');
    } else if (status === 422) {
      const detail = (error.response.data as any)?.detail;
      let msg = 'Data yang dikirim tidak valid';
      if (typeof detail === 'string') {
        msg = detail;
      } else if (Array.isArray(detail) && detail.length > 0) {
        msg = detail.map((d: any) => d?.msg ?? String(d)).join(', ');
      }
      showError(msg, 'Validasi Gagal');
    } else if (status != null && status >= 500) {
      showError('Terjadi kesalahan server. Silakan coba lagi', 'Server Error');
    }

    return Promise.reject(error);
  }
);

export { isAxiosError };

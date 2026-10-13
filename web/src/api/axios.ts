import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
  isAxiosError,
} from 'axios'
import { toast } from 'sonner'
import { tokenAccessors, REFRESH_TOKEN_KEY } from '@/store/authStore'
import type { TokenResponse } from '@/types/auth'

export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'
const TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT ?? 15000)

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
})

// ─── Request interceptor: attach Bearer token ──────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = tokenAccessors.getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ─── 401 Refresh queue ────────────────────────────────────────────────────────
// Prevents parallel refresh races — mirrors mobile/src/api/axios.ts pattern.
type QueueEntry = {
  resolve: (token: string) => void
  reject: (error: unknown) => void
}

let isRefreshing = false
let failedQueue: QueueEntry[] = []

function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error !== null) {
      reject(error)
    } else {
      resolve(token as string)
    }
  })
  failedQueue = []
}

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined

    if (
      error.response?.status !== 401 ||
      originalRequest == null ||
      originalRequest._retry === true
    ) {
      return Promise.reject(error)
    }

    // If another refresh is already in flight, queue this request
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`
        return apiClient(originalRequest)
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY)
      if (!refreshToken) throw new Error('No refresh token available')

      if (!import.meta.env.PROD) {
        console.log('[axios] attempting token refresh')
      }

      // Use raw axios (not apiClient) to avoid triggering this interceptor again
      const { data } = await axios.post<TokenResponse>(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      })

      // Update React Context via the injected setter
      tokenAccessors.setTokens(data.access_token, data.refresh_token)

      processQueue(null, data.access_token)
      originalRequest.headers.Authorization = `Bearer ${data.access_token}`
      return apiClient(originalRequest)
    } catch (refreshError: unknown) {
      processQueue(refreshError, null)
      // Notify AuthProvider to clear session (Axios cannot call React state directly)
      window.dispatchEvent(new CustomEvent('auth:logout-required'))
      toast.error('Sesi habis. Silakan login kembali.', { description: 'Sesi Berakhir' })
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

// ─── Error toast interceptor ──────────────────────────────────────────────────
// Runs after the 401 interceptor; skip 401 (already handled above)
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status

    // 401 is handled by the refresh interceptor above
    if (status === 401) return Promise.reject(error)

    if (!error.response) {
      toast.error('Tidak ada koneksi internet atau server tidak dapat dijangkau.', {
        description: 'Koneksi Gagal',
      })
    } else if (status === 403) {
      toast.error('Anda tidak memiliki izin untuk melakukan tindakan ini.', {
        description: 'Akses Ditolak',
      })
    } else if (status === 422) {
      const detail = (error.response.data as { detail?: unknown })?.detail
      let msg = 'Data yang dikirim tidak valid.'
      if (typeof detail === 'string') {
        msg = detail
      } else if (Array.isArray(detail) && detail.length > 0) {
        msg = (detail as Array<{ msg?: string }>)
          .map((d) => d?.msg ?? String(d))
          .join(', ')
      }
      toast.error(msg, { description: 'Validasi Gagal' })
    } else if (status != null && status >= 500) {
      toast.error('Terjadi kesalahan server. Silakan coba lagi.', {
        description: 'Server Error',
      })
    }

    return Promise.reject(error)
  },
)

export { isAxiosError }
export default apiClient

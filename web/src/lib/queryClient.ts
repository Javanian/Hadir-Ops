import { QueryClient } from '@tanstack/react-query'
import { isAxiosError } from '@/api/axios'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,        // 1 minute — backend is source of truth
      gcTime: 5 * 60_000,       // 5 minutes cache retention
      retry: (failureCount, error) => {
        // Don't retry auth errors — they won't resolve by retrying
        if (isAxiosError(error)) {
          const status = error.response?.status ?? 0
          if (status === 401 || status === 403) return false
        }
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
    },
  },
})

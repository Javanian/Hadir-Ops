import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

/**
 * PublicRoute wraps pages that should only be visible to unauthenticated users.
 * If the user is already authenticated → redirect to /dashboard.
 * While session is being restored → render nothing (avoid flash).
 */
export function PublicRoute() {
  const { isAuthenticated, isInitialized } = useAuthStore()

  // Don't render anything while session is being restored to avoid flash
  if (!isInitialized) return null

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

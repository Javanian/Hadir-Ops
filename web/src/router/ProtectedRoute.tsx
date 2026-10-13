import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types/auth'

interface ProtectedRouteProps {
  allowedRoles?: UserRole[]
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, isInitialized, user } = useAuthStore()
  const location = useLocation()

  // Session is still being restored (AuthProvider is calling /auth/refresh + /auth/me)
  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-brand border-t-transparent" />
          <p className="text-sm text-text-secondary">Memuat...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Role guard — if roles are specified, user must have one of them
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    // Redirect down to dashboard rather than to /login (user IS authenticated)
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

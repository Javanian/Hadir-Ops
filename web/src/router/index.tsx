import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { PublicRoute } from './PublicRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/LoginPage'

// Pages are split into their own chunks so the login screen does not pay for
// recharts (dashboard) or leaflet (sites); each loads on first visit.
export const router = createBrowserRouter([
  // Public routes
  {
    element: <PublicRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
    ],
  },

  // Protected routes — require ADMIN or SUPERVISOR
  {
    element: <ProtectedRoute allowedRoles={['ADMIN', 'SUPERVISOR']} />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: '/dashboard',
            lazy: async () => ({ Component: (await import('@/pages/DashboardPage')).DashboardPage }),
          },

          // ADMIN only
          {
            element: <ProtectedRoute allowedRoles={['ADMIN']} />,
            children: [
              {
                path: '/users',
                lazy: async () => ({ Component: (await import('@/pages/users/UsersPage')).UsersPage }),
              },
              {
                path: '/users/:id',
                lazy: async () => ({ Component: (await import('@/pages/users/UserDetailPage')).UserDetailPage }),
              },
              {
                path: '/sites',
                lazy: async () => ({ Component: (await import('@/pages/sites/SitesPage')).SitesPage }),
              },
              {
                path: '/holidays',
                lazy: async () => ({ Component: (await import('@/pages/holidays/HolidaysPage')).HolidaysPage }),
              },
              {
                path: '/assignments',
                lazy: async () => ({ Component: (await import('@/pages/assignments/AssignmentsPage')).AssignmentsPage }),
              },
            ],
          },

          // ADMIN + SUPERVISOR
          {
            path: '/shifts',
            lazy: async () => ({ Component: (await import('@/pages/shifts/ShiftsPage')).ShiftsPage }),
          },
          {
            path: '/attendance',
            lazy: async () => ({ Component: (await import('@/pages/attendance/AttendancePage')).AttendancePage }),
          },
          {
            path: '/review',
            lazy: async () => ({ Component: (await import('@/pages/review/ReviewPage')).ReviewPage }),
          },
          {
            path: '/leave',
            lazy: async () => ({ Component: (await import('@/pages/leave/LeavePage')).LeavePage }),
          },
          {
            path: '/overtime',
            lazy: async () => ({ Component: (await import('@/pages/overtime/OvertimePage')).OvertimePage }),
          },
          {
            path: '/reports',
            lazy: async () => ({ Component: (await import('@/pages/reports/ReportsPage')).ReportsPage }),
          },
        ],
      },
    ],
  },

  // Root redirect
  { path: '/', element: <Navigate to="/dashboard" replace /> },

  // 404 fallback
  { path: '*', element: <Navigate to="/dashboard" replace /> },
])

import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { PublicRoute } from './PublicRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { UsersPage } from '@/pages/users/UsersPage'
import { UserDetailPage } from '@/pages/users/UserDetailPage'
import { SitesPage } from '@/pages/sites/SitesPage'
import { ShiftsPage } from '@/pages/shifts/ShiftsPage'
import { HolidaysPage } from '@/pages/holidays/HolidaysPage'
import { AttendancePage } from '@/pages/attendance/AttendancePage'
import { OvertimePage } from '@/pages/overtime/OvertimePage'
import { ReportsPage } from '@/pages/reports/ReportsPage'
import { AssignmentsPage } from '@/pages/assignments/AssignmentsPage'

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
          { path: '/dashboard', element: <DashboardPage /> },

          // ADMIN only
          {
            element: <ProtectedRoute allowedRoles={['ADMIN']} />,
            children: [
              { path: '/users', element: <UsersPage /> },
              { path: '/users/:id', element: <UserDetailPage /> },
              { path: '/sites', element: <SitesPage /> },
              { path: '/holidays', element: <HolidaysPage /> },
              { path: '/assignments', element: <AssignmentsPage /> },
            ],
          },

          // ADMIN + SUPERVISOR
          { path: '/shifts', element: <ShiftsPage /> },
          { path: '/attendance', element: <AttendancePage /> },
          { path: '/overtime', element: <OvertimePage /> },
          { path: '/reports', element: <ReportsPage /> },
        ],
      },
    ],
  },

  // Root redirect
  { path: '/', element: <Navigate to="/dashboard" replace /> },

  // 404 fallback
  { path: '*', element: <Navigate to="/dashboard" replace /> },
])

import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/store/AuthProvider'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/router'
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import '@fontsource/fira-code/latin-500.css'
import './index.css'

// Provider hierarchy:
// AuthProvider (outermost — provides token accessors to Axios interceptors via module-level injection)
//   QueryClientProvider (server state, can read auth via hooks)
//     RouterProvider (route guards read auth via useAuthStore)
//       Toaster (global toast renderer)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          duration={4000}
        />
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
)

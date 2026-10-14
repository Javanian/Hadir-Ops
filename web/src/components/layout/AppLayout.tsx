import { useState } from 'react'
import { Outlet, useNavigation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Pages load lazily; show a thin bar while the next page's code arrives.
  const loading = useNavigation().state === 'loading'

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Desktop sidebar — always visible on lg+ */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Sidebar panel */}
          <div className="relative z-50">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <div className="relative h-0.5 flex-shrink-0 overflow-hidden" role="progressbar" aria-hidden={!loading} aria-label="Memuat halaman">
          {loading && <div className="absolute inset-y-0 w-1/3 bg-brand animate-route-progress" />}
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-surface">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

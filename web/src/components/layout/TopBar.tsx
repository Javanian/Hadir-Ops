import { Menu, LogOut, User } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useLogout } from '@/hooks/useAuth'

interface TopBarProps {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { user } = useAuthStore()
  const logout = useLogout()
  const { pathname } = useLocation()
  const pageTitle = ({ dashboard: 'Ringkasan kehadiran', users: 'Pengguna', sites: 'Lokasi kerja', assignments: 'Penugasan', shifts: 'Jadwal shift', holidays: 'Hari libur', attendance: 'Presensi', overtime: 'Pengajuan lembur', reports: 'Laporan' } as Record<string, string>)[pathname.split('/')[1]] ?? 'Ruang kerja'

  return (
    <header className="h-16 flex items-center px-4 md:px-8 border-b border-slate-200/80 bg-white/75 backdrop-blur-md gap-4 flex-shrink-0">
      {/* Hamburger — mobile/tablet only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden h-11 w-11 flex items-center justify-center -ml-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
        aria-label="Buka menu navigasi"
      >
        <Menu size={20} />
      </button>

      <p className="flex-1 min-w-0 truncate text-base font-bold tracking-tight text-text-primary">{pageTitle}</p>

      {/* User info + logout */}
      <div className="flex items-center gap-3">
        {/* User avatar + info — hidden on small mobile */}
        <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 shadow-sm">
          <div className="h-8 w-8 rounded-full bg-brand/10 flex items-center justify-center flex-shrink-0 order-first">
            <User size={16} className="text-brand" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-text-primary leading-tight">{user?.name}</p>
            <p className="text-xs text-text-secondary leading-tight">{user?.role}</p>
          </div>
        </div>

        {/* Logout button */}
        <button
          onClick={logout}
          className="h-11 w-11 flex items-center justify-center rounded-full text-text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
          aria-label="Keluar dari akun"
          title="Keluar dari akun"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}

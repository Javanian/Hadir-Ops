import { Menu, LogOut, User } from 'lucide-react'
import { useLocation } from 'react-router'
import { useAuthStore } from '@/store/authStore'
import { useLogout } from '@/hooks/useAuth'
import { t } from '@/i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

interface TopBarProps {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { user } = useAuthStore()
  const logout = useLogout()
  const { pathname } = useLocation()
  const pageTitle = ({ dashboard: t('topBar.attendanceOverview'), users: t('common.users'), sites: t('topBar.workSites'), assignments: t('common.assignments'), shifts: t('topBar.shiftSchedules'), holidays: t('topBar.holidays'), attendance: t('topBar.attendance'), review: t('topBar.attendanceReview'), leave: t('topBar.leave'), overtime: t('common.overtimeRequests'), reports: t('common.reports') } as Record<string, string>)[pathname.split('/')[1]] ?? t('topBar.workspace')

  return (
    <header className="h-16 flex items-center px-4 md:px-8 border-b border-slate-200/80 bg-white/75 backdrop-blur-md gap-4 shrink-0">
      {/* Hamburger — mobile/tablet only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden h-11 w-11 flex items-center justify-center -ml-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
        aria-label={t('topBar.openTheNavigationMenu')}
      >
        <Menu size={20} />
      </button>

      <p className="flex-1 min-w-0 truncate text-base font-bold tracking-tight text-text-primary">{pageTitle}</p>

      {/* Language, user info and logout */}
      <div className="flex items-center gap-3">
        <LanguageSwitcher className="hidden md:inline-flex" />
        {/* User avatar + info — hidden on small mobile */}
        <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 shadow-sm">
          <div className="h-8 w-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0 order-first">
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
          aria-label={t('topBar.signOut')}
          title={t('topBar.signOut')}
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}

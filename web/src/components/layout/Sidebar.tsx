import { NavLink } from 'react-router'
import {
  type LucideIcon,
  LayoutDashboard,
  Users,
  MapPin,
  Clock,
  CalendarDays,
  CalendarClock,
  ClipboardList,
  Timer,
  BarChart2,
  ShieldCheck,
  CalendarX,
  X,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const ADMIN_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/users', label: t('common.users'), icon: Users },
  { to: '/sites', label: t('common.site'), icon: MapPin },
  { to: '/assignments', label: t('common.assignments'), icon: CalendarClock },
  { to: '/shifts', label: 'Shift', icon: Clock },
  { to: '/holidays', label: t('common.holiday'), icon: CalendarDays },
  { to: '/attendance', label: t('sidebar.attendance'), icon: ClipboardList },
  { to: '/review', label: t('sidebar.review'), icon: ShieldCheck },
  { to: '/leave', label: t('sidebar.leave'), icon: CalendarX },
  { to: '/overtime', label: t('common.overtime'), icon: Timer },
  { to: '/reports', label: t('common.reports'), icon: BarChart2 },
]

const SUPERVISOR_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/shifts', label: 'Shift', icon: Clock },
  { to: '/attendance', label: t('sidebar.attendance'), icon: ClipboardList },
  { to: '/review', label: t('sidebar.review'), icon: ShieldCheck },
  { to: '/leave', label: t('sidebar.leave'), icon: CalendarX },
  { to: '/overtime', label: t('common.overtime'), icon: Timer },
  { to: '/reports', label: t('common.reports'), icon: BarChart2 },
]

interface SidebarProps {
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const { user } = useAuthStore()
  const navItems = user?.role === 'ADMIN' ? ADMIN_NAV : SUPERVISOR_NAV

  return (
    <nav aria-label={t('sidebar.mainNavigation')} className="flex flex-col h-full w-[248px] bg-chrome text-slate-300">
      {/* Brand header */}
      <div className="h-16 flex items-center px-4 gap-3 border-b border-white/5 shrink-0">
        <img src="/rollproof-logo.svg" alt="" className="h-9 w-9 shrink-0 rounded-xl shadow-glow" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-base tracking-tight leading-tight truncate">
            Rollproof
          </p>
          <p className="text-slate-400 text-xs leading-tight mt-0.5">{t('common.attendanceWithProof')}</p>
        </div>

        {/* Close button — mobile only */}
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 h-11 w-11 flex items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white transition-colors lg:hidden"
            aria-label={t('sidebar.closeSidebar')}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Navigation items */}
      <ul className="flex-1 py-3 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              onClick={onClose}
              end={to === '/dashboard'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 mx-3 my-0.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand text-white shadow-glow'
                    : 'text-slate-300 hover:bg-white/6 hover:text-white',
                )
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      {/* User info footer */}
      <div className="m-3 p-3 rounded-xl bg-white/4 border border-white/5 shrink-0">
        <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
        <p className="text-xs text-slate-400 mt-0.5">{user?.role}</p>
      </div>
    </nav>
  )
}

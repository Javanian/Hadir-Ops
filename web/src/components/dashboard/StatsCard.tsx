import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

type StatsCardVariant = 'default' | 'success' | 'warning' | 'danger'

interface StatsCardProps {
  icon: React.ReactNode
  title: string
  value: number | string
  loading?: boolean
  variant?: StatsCardVariant
  subtitle?: string
}

const variantStyles: Record<StatsCardVariant, { bg: string; icon: string }> = {
  default: { bg: 'bg-brand/10', icon: 'text-brand' },
  success: { bg: 'bg-green-100', icon: 'text-green-600' },
  warning: { bg: 'bg-amber-100', icon: 'text-amber-600' },
  danger: { bg: 'bg-red-100', icon: 'text-red-600' },
}

export function StatsCard({
  icon,
  title,
  value,
  loading = false,
  variant = 'default',
  subtitle,
}: StatsCardProps) {
  const styles = variantStyles[variant]

  return (
    <div className="group bg-white rounded-2xl border border-slate-200/80 shadow-soft p-5 flex items-center gap-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-lift">
      <div
        className={cn(
          'h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-slate-900/5',
          styles.bg,
        )}
      >
        {/* Decorative: the title next to it says what the number is */}
        <span className={styles.icon} aria-hidden="true">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-secondary truncate">{title}</p>
        {loading ? (
          <Skeleton className="h-6 w-14 mt-1" />
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight tabular-nums text-text-primary leading-tight mt-0.5">{value}</p>
            {subtitle && (
              <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

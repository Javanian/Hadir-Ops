import { FlaskConical } from 'lucide-react'
import { useDemoInfo } from '@/hooks/useDemo'
import { intlLocale, t } from '@/i18n'

/** A strip above every page of the public demo: what it is and when it resets. */
export function DemoBanner() {
  const { data } = useDemoInfo()
  if (!data?.enabled) return null

  const resetAt = data.next_reset_at
    ? new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(
        new Date(data.next_reset_at),
      )
    : null

  return (
    <div role="note" className="flex shrink-0 items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-900 border-b border-amber-200 md:px-8">
      <FlaskConical size={14} aria-hidden="true" className="shrink-0" />
      <p className="min-w-0">
        <span className="font-semibold">{t('demo.bannerTitle')}</span>{' '}
        {resetAt ? t('demo.bannerResetAt', { time: resetAt }) : t('demo.bannerReset')}
      </p>
    </div>
  )
}

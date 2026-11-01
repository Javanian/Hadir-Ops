import { t } from '@/i18n'
export function PageLoading() {
  return (
    <div role="status" className="grid min-h-screen place-items-center bg-surface text-sm text-text-secondary">
      {t('pageLoading.loading')}
    </div>
  )
}

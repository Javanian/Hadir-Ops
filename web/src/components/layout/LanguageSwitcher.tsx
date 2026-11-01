import { Languages } from 'lucide-react'
import { LOCALES, locale, setLocale, t, type Locale } from '@/i18n'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">{t('common.language')}</span>
      <Languages size={16} aria-hidden="true" className="pointer-events-none absolute left-3 text-text-secondary" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="h-11 appearance-none rounded-full border border-slate-200 bg-white pl-9 pr-4 text-sm text-text-primary shadow-sm hover:border-slate-300 focus:outline-hidden focus:ring-4 focus:ring-brand/15"
      >
        {(Object.keys(LOCALES) as Locale[]).map((code) => (
          <option key={code} value={code}>{LOCALES[code]}</option>
        ))}
      </select>
    </label>
  )
}

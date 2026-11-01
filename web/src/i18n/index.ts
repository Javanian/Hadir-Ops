/**
 * Translations without a library: en.ts holds every message (the default
 * language) and id.ts is typed against it, so a key missing from a language
 * fails `tsc`. Messages take `{name}` placeholders: t('users.deleteConfirm', { name }).
 *
 * The language is chosen once at startup (saved choice, then the browser's
 * language) and switching reloads the page, so `t` also works at module level
 * (form schemas, label maps).
 */
import { en, type MessageKey } from './en'
import { id } from './id'

export type { MessageKey }
export type Locale = 'en' | 'id'

export const LOCALES: Record<Locale, string> = { en: 'English', id: 'Bahasa Indonesia' }

const STORAGE_KEY = 'rollproof_locale'

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'id') return saved
  } catch {
    // storage blocked: fall through to the browser language
  }
  return navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en'
}

export const locale: Locale = detectLocale()

/** BCP 47 tag for Intl formatting in the current language. */
export const intlLocale = locale === 'id' ? 'id-ID' : navigator.language?.startsWith('en') ? navigator.language : 'en-US'

const messages: Record<MessageKey, string> = locale === 'id' ? id : en

if (typeof document !== 'undefined') document.documentElement.lang = locale

export function t(key: MessageKey, vars?: Record<string, string | number | null | undefined>): string {
  const text = messages[key] ?? en[key] ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name] ?? "") : match))
}

export function setLocale(next: Locale): void {
  if (next === locale) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  window.location.reload()
}

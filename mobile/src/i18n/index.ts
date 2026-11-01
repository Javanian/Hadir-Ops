/**
 * Translations without a library: en.ts holds every message (the default
 * language) and id.ts is typed against it, so a key missing from a language
 * fails `tsc`. Messages take `{name}` placeholders: t('leave.maxDays', { days }).
 *
 * The language is chosen once at startup (saved choice, then the phone's
 * language) and switching reloads the app, so `t` also works at module level.
 */
import { reloadAppAsync } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { en, type MessageKey } from './en';
import { id } from './id';

export type { MessageKey };
export type Locale = 'en' | 'id';

export const LOCALES: Record<Locale, string> = { en: 'English', id: 'Bahasa Indonesia' };

const STORAGE_KEY = 'rollproof_locale';

function savedLocale(): string | null {
  try {
    return Platform.OS === 'web' ? localStorage.getItem(STORAGE_KEY) : SecureStore.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function deviceLanguage(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? 'en';
  } catch {
    return 'en';
  }
}

function detectLocale(): Locale {
  const saved = savedLocale();
  if (saved === 'en' || saved === 'id') return saved;
  return deviceLanguage().toLowerCase().startsWith('id') ? 'id' : 'en';
}

export const locale: Locale = detectLocale();

/** BCP 47 tag for Intl formatting in the current language. */
export const intlLocale = locale === 'id' ? 'id-ID' : deviceLanguage().startsWith('en') ? deviceLanguage() : 'en-US';

const messages: Record<MessageKey, string> = locale === 'id' ? id : en;

export function t(key: MessageKey, vars?: Record<string, string | number | null | undefined>): string {
  const text = messages[key] ?? en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name] ?? '') : match));
}

export async function setLocale(next: Locale): Promise<void> {
  if (next === locale) return;
  try {
    if (Platform.OS === 'web') localStorage.setItem(STORAGE_KEY, next);
    else await SecureStore.setItemAsync(STORAGE_KEY, next);
  } catch {
    // storage unavailable: the choice lasts until the app restarts
  }
  if (Platform.OS === 'web') window.location.reload();
  else await reloadAppAsync('language changed');
}

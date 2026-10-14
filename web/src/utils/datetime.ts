// Always use site_timezone from API — never device timezone or hardcoded "Asia/Jakarta"

export function formatDateTime(isoString: string, siteTimezone: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: siteTimezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString))
}

export function formatDate(isoString: string, siteTimezone: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: siteTimezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(isoString))
}

export function formatTime(isoString: string, siteTimezone: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: siteTimezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString))
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}j ${m}m` : `${m}m`
}

/**
 * Calendar date (YYYY-MM-DD) of an instant in a timezone. Without a timezone
 * the browser's own is used. Never use toISOString().slice(0, 10) for this:
 * that is the UTC date, which is yesterday before 07:00 in WIB.
 */
export function localDateISO(instant: Date | string = new Date(), timeZone?: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Local calendar date `n` days before today (n = 0 is today). */
export function daysAgoISO(n: number, timeZone?: string): string {
  const [y, m, d] = localDateISO(new Date(), timeZone).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d - n))
  return date.toISOString().slice(0, 10)
}

/** Format a plain YYYY-MM-DD date (no time, no timezone shift). */
export function formatPlainDate(isoDate: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...opts,
  }).format(new Date(`${isoDate}T00:00:00Z`))
}

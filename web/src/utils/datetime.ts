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

export interface SiteResponse {
  id: number
  name: string
  latitude: number
  longitude: number
  radius_meter: number
  timezone: string
  created_at: string | null
}

export interface SiteCreatePayload {
  name: string
  latitude: number
  longitude: number
  radius_meter: number
  timezone: string
}

export type SiteUpdatePayload = Partial<SiteCreatePayload>

/** Current UTC offset of an IANA time zone, e.g. "UTC+7" or "UTC-5:30". */
export function timezoneOffset(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value
    return (part ?? 'GMT').replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0')
  } catch {
    return ''
  }
}

// Every IANA zone the browser knows; a site anywhere in the world gets its own.
const ZONES = Array.from(new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]))

export const TIMEZONE_OPTIONS = ZONES.map((value) => ({ value, label: `${value} (${timezoneOffset(value)})` }))

export function isKnownTimezone(value: string): boolean {
  return ZONES.includes(value)
}

/** The browser's own zone, a sensible default for a new site. */
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

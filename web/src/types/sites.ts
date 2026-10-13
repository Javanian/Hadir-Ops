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

export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta — WIB (UTC+7)' },
  { value: 'Asia/Makassar', label: 'Asia/Makassar — WITA (UTC+8)' },
  { value: 'Asia/Jayapura', label: 'Asia/Jayapura — WIT (UTC+9)' },
] as const

export const TIMEZONE_SHORT: Record<string, string> = {
  'Asia/Jakarta': 'WIB (UTC+7)',
  'Asia/Makassar': 'WITA (UTC+8)',
  'Asia/Jayapura': 'WIT (UTC+9)',
}

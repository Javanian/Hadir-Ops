import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// Fix default marker icon paths broken by Vite bundling
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Default: central Jakarta
const DEFAULT_CENTER: L.LatLngTuple = [-6.1754, 106.8272]
const ZOOM = 15

interface SiteMapPickerProps {
  latitude: number | null
  longitude: number | null
  radiusMeter: number
  onChange: (lat: number, lng: number) => void
}

interface NominatimResult {
  lat: string
  lon: string
}

export function SiteMapPicker({ latitude, longitude, radiusMeter, onChange }: SiteMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  // True once the viewport has been set to real (non-default) coordinates.
  // Starts false so the sync effect can call setView when RHF reset() fires
  // after mount with the saved site coords.
  const viewCenteredRef = useRef(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasCoords = latitude !== null && longitude !== null

  // Place or move marker. Also places/moves the circle only when coords are real (not default-only).
  const placeMarker = useCallback(
    (lat: number, lng: number, radiusM: number, withCircle: boolean) => {
      const map = mapRef.current
      if (!map) return

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
      } else {
        markerRef.current = L.marker([lat, lng], { draggable: true })
          .addTo(map)
          .on('dragend', (e) => {
            const pos = (e.target as L.Marker).getLatLng()
            onChange(pos.lat, pos.lng)
          })
      }

      if (!withCircle) return

      const radius = radiusM > 0 ? radiusM : 100
      if (circleRef.current) {
        circleRef.current.setLatLng([lat, lng]).setRadius(radius)
      } else {
        circleRef.current = L.circle([lat, lng], {
          radius,
          color: '#2563EB',
          fillColor: '#2563EB',
          fillOpacity: 0.15,
          weight: 2,
        }).addTo(map)
      }
    },
    [onChange],
  )

  // ── Init map once on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current !== null) return

    const center: L.LatLngTuple = hasCoords ? [latitude!, longitude!] : DEFAULT_CENTER
    const map = L.map(containerRef.current, { center, zoom: ZOOM })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    // Place marker on mount:
    // - edit mode  → real coords + circle (and mark viewport as centered)
    // - create mode → default visual marker only, no circle, no onChange
    placeMarker(center[0], center[1], radiusMeter, hasCoords)
    if (hasCoords) viewCenteredRef.current = true

    map.on('click', (e: L.LeafletMouseEvent) => {
      onChange(e.latlng.lat, e.latlng.lng)
    })

    // Fix blank-tile bug when Leaflet renders inside a flex container
    setTimeout(() => mapRef.current?.invalidateSize(), 100)

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
      viewCenteredRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync marker + circle when lat/lng props change ─────────────────────────
  // This also handles edit mode: RHF reset() fires after mount, changing props
  // from null → real coords. If the viewport hasn't been centered yet (init ran
  // with null props), call setView now so the map jumps to the saved location.
  useEffect(() => {
    if (!mapRef.current || latitude === null || longitude === null) return
    if (!viewCenteredRef.current) {
      mapRef.current.setView([latitude, longitude], ZOOM)
      viewCenteredRef.current = true
    }
    placeMarker(latitude, longitude, radiusMeter, true)
  }, [latitude, longitude, placeMarker]) // radiusMeter handled separately

  // ── Update circle radius reactively ────────────────────────────────────────
  useEffect(() => {
    if (circleRef.current && radiusMeter > 0) {
      circleRef.current.setRadius(radiusMeter)
    }
  }, [radiusMeter])

  // ── Nominatim geocode search ────────────────────────────────────────────────
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) return
    setIsFetching(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'id',
          'User-Agent': 'presensiv2-webadmin',
        },
      })
      const data: NominatimResult[] = await res.json()
      if (data.length > 0 && mapRef.current) {
        mapRef.current.flyTo([parseFloat(data[0].lat), parseFloat(data[0].lon)], ZOOM)
      }
    } catch {
      // silently ignore network errors
    } finally {
      setIsFetching(false)
    }
  }, [])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void doSearch(value), 500)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      void doSearch(searchQuery)
    }
  }

  const handleSearchClick = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    void doSearch(searchQuery)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search bar — NOT a <form> to avoid nested form inside SiteFormModal */}
      <div className="flex gap-2 p-2 border-b border-border shrink-0">
        <Input
          placeholder="Cari lokasi (cth. Jakarta, Bandung)…"
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          className="flex-1 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isFetching || !searchQuery.trim()}
          onClick={handleSearchClick}
          className="shrink-0"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {/* Coordinate readout */}
      {hasCoords && (
        <div className="px-2 py-1 shrink-0 border-b border-border">
          <p className="text-xs text-muted-foreground font-mono">
            Lat: {latitude!.toFixed(6)}, Lng: {longitude!.toFixed(6)}
          </p>
        </div>
      )}

      {/* Map — fills all remaining space */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />
    </div>
  )
}

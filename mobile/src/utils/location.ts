import * as Location from 'expo-location';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;   // metres, as reported by the OS
  mocked: boolean;           // Android reports mock location providers
  stale: boolean;            // came from the last known position
}

export class LocationError extends Error {
  constructor(public reason: 'PERMISSION' | 'NO_FIX', message: string) {
    super(message);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Current position with its accuracy. Falls back to the last known position
 * (up to 10 minutes old) when a fresh fix does not arrive in time, which is
 * common indoors and under factory roofs. The server weighs the accuracy;
 * the app does not reject a poor fix.
 */
export async function getFix(timeoutMs = 15_000): Promise<Fix> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new LocationError(
      'PERMISSION',
      'Izin lokasi diperlukan untuk absensi. Aktifkan di Pengaturan > Aplikasi > Izin Lokasi.',
    );
  }

  const fresh = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    timeoutMs,
  );
  if (fresh) {
    return {
      latitude: fresh.coords.latitude,
      longitude: fresh.coords.longitude,
      accuracy: fresh.coords.accuracy ?? null,
      mocked: fresh.mocked === true,
      stale: false,
    };
  }

  const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
  if (last) {
    return {
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
      accuracy: last.coords.accuracy ?? null,
      mocked: last.mocked === true,
      stale: true,
    };
  }

  throw new LocationError('NO_FIX', 'Lokasi belum didapat. Pastikan GPS aktif, lalu coba di tempat terbuka.');
}

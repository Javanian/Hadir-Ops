const LABELS: Record<string, string> = {
  LOW_GPS_ACCURACY: 'sinyal GPS kurang akurat',
  MOCK_LOCATION: 'aplikasi lokasi palsu terdeteksi',
  FACE_NOT_VERIFIED: 'wajah belum terverifikasi',
  FACE_MISMATCH: 'wajah tidak cocok',
  CLOCK_MISMATCH: 'jam HP tidak sesuai',
  CLOCK_UNVERIFIED: 'absen terkirim terlambat',
};

/** Short Indonesian explanation of why a record went to supervisor review. */
export function reviewReason(flags: string[] | undefined, status?: string | null): string {
  const reasons = (flags ?? [])
    .map((f) => LABELS[f.replace(/^CHECKOUT_/, '')])
    .filter((x): x is string => Boolean(x));
  if (status === 'OUT_OF_RADIUS') reasons.unshift('lokasi di luar area');
  const unique = Array.from(new Set(reasons));
  return unique.length ? unique.join(', ') : 'perlu pengecekan';
}

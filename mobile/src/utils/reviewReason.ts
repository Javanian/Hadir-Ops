import { t } from '../i18n'
const LABELS: Record<string, string> = {
  LOW_GPS_ACCURACY: t('reviewReason.theGpsSignalWasWeak'),
  MOCK_LOCATION: t('reviewReason.aMockLocationAppWas'),
  FACE_NOT_VERIFIED: t('reviewReason.theFaceIsNotVerified'),
  FACE_MISMATCH: t('reviewReason.theFaceDidNotMatch'),
  CLOCK_MISMATCH: t('reviewReason.thePhoneClockDisagrees'),
  CLOCK_UNVERIFIED: t('reviewReason.itWasDeliveredLate'),
};

/** Short Indonesian explanation of why a record went to supervisor review. */
export function reviewReason(flags: string[] | undefined, status?: string | null): string {
  const reasons = (flags ?? [])
    .map((f) => LABELS[f.replace(/^CHECKOUT_/, '')])
    .filter((x): x is string => Boolean(x));
  if (status === 'OUT_OF_RADIUS') reasons.unshift(t('reviewReason.theLocationIsOutsideThe'));
  const unique = Array.from(new Set(reasons));
  return unique.length ? unique.join(', ') : t('reviewReason.itNeedsACheck');
}

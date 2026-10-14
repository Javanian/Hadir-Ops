/**
 * Sends outbox items to the server.
 *
 * Rules:
 *  - An item is written to the outbox before the first send, so killing the
 *    app mid-request cannot lose it.
 *  - Check-ins and check-outs go in the order they happened. A check-out is
 *    never sent while an earlier check-in is still waiting.
 *  - No network, timeouts, 401, 429 and 5xx are retried with backoff.
 *  - Any other 4xx is final: the item is marked failed, shown to the user,
 *    and reported to the server as a failed attempt for the supervisor.
 */
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { isAxiosError } from 'axios';
import { attendanceApi, AttemptBody, AttemptReason, CheckinBody, CheckoutBody } from '../api/attendance.api';
import { faceApi } from '../api/face.api';
import { getAuthState, subscribeToAuthState } from '../store/authStore';
import { AttendanceRecord } from '../types/attendance';
import { newEventId } from '../utils/eventId';
import { addItem, getItems, loadOutbox, OutboxItem, OutboxKind, removeItem, updateItem } from './outbox';

const SESSION = newEventId();
const APP_VERSION = Constants.expoConfig?.version ?? 'dev';
const MAX_FACE_TRIES = 30;

export type SendOutcome =
  | { status: 'sent'; record?: AttendanceRecord }
  | { status: 'queued'; reason: string }
  | { status: 'rejected'; message: string };

function mono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Create an item stamped with the moment of capture. Not stored until `submit`. */
export function capture(
  kind: OutboxKind,
  userId: number,
  body: Record<string, unknown>,
  extra: Partial<OutboxItem> = {},
): OutboxItem {
  return {
    id: newEventId(),
    userId,
    kind,
    body,
    capturedAt: new Date().toISOString(),
    capturedMono: mono(),
    session: SESSION,
    tries: 0,
    nextTryAt: 0,
    state: 'pending',
    ...extra,
  };
}

function timing(item: OutboxItem) {
  // The monotonic age is only meaningful inside the process that captured it.
  const age = item.session === SESSION ? Math.max(0, Math.round(mono() - item.capturedMono)) : undefined;
  return { client_event_id: item.id, captured_at: item.capturedAt, capture_age_ms: age };
}

function backoffMs(tries: number): number {
  const base = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(tries, 8));
  return base + Math.floor(Math.random() * 1_000);
}

type Failure = 'network' | 'retry' | 'reject';

function classify(e: unknown): Failure {
  if (!isAxiosError(e) || !e.response) return 'network';
  const s = e.response.status;
  if (s === 401 || s === 408 || s === 429 || s >= 500) return 'retry';
  return 'reject';
}

export function errorMessage(e: unknown): string {
  if (isAxiosError(e)) {
    const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string') return detail;
    if (!e.response) return 'Tidak ada koneksi ke server';
    return `HTTP ${e.response.status}`;
  }
  return e instanceof Error ? e.message : String(e);
}

async function deliver(item: OutboxItem): Promise<AttendanceRecord | undefined> {
  switch (item.kind) {
    case 'checkin':
      return attendanceApi.checkin({ ...item.body, ...timing(item) } as unknown as CheckinBody);
    case 'checkout':
      return attendanceApi.checkout({ ...item.body, ...timing(item) } as unknown as CheckoutBody);
    case 'attempt':
      await attendanceApi.reportAttempts([
        {
          ...(item.body as Omit<AttemptBody, 'client_event_id' | 'captured_at'>),
          client_event_id: item.id,
          captured_at: item.capturedAt,
          app_version: APP_VERSION,
        },
      ]);
      return undefined;
    case 'face':
      if (item.attendanceId == null || !item.photoPath) return undefined;
      return faceApi.attachToAttendance(item.attendanceId, item.photoPath);
  }
}

async function afterDelivered(item: OutboxItem, record?: AttendanceRecord) {
  if (item.kind === 'checkin' && item.photoPath && record?.risk_flags?.includes('FACE_NOT_VERIFIED')) {
    // The check-in was made without face proof; send the photo taken with it.
    await addItem(capture('face', item.userId, {}, { photoPath: item.photoPath, attendanceId: record.id }));
    await updateItem(item.id, { photoPath: undefined }); // keep the file for the face item
  }
  await removeItem(item.id);
}

const inflight = new Set<string>();

async function sendOnce(item: OutboxItem): Promise<SendOutcome> {
  if (inflight.has(item.id)) return { status: 'queued', reason: 'sending' };
  inflight.add(item.id);
  try {
    const record = await deliver(item);
    await afterDelivered(item, record);
    return { status: 'sent', record };
  } catch (e) {
    const failure = classify(e);
    const message = errorMessage(e);
    if (failure === 'reject') {
      if (item.kind === 'checkin' || item.kind === 'checkout') {
        await updateItem(item.id, { state: 'failed', lastError: message });
        reportAttempt(item.userId, item.kind === 'checkin' ? 'CHECKIN' : 'CHECKOUT', 'REJECTED', message, item.body);
      } else {
        await removeItem(item.id); // nothing the user can do about these
      }
      return { status: 'rejected', message };
    }
    const tries = item.tries + 1;
    if (item.kind === 'face' && tries >= MAX_FACE_TRIES) {
      await removeItem(item.id);
    } else {
      await updateItem(item.id, { tries, nextTryAt: Date.now() + backoffMs(tries), lastError: message });
    }
    return { status: 'queued', reason: message };
  } finally {
    inflight.delete(item.id);
  }
}

/** Store the item, then try to send it right away. */
export async function submit(item: OutboxItem): Promise<SendOutcome> {
  await addItem(item);
  const outcome = await sendOnce(item);
  if (outcome.status === 'sent') notifySynced();
  return outcome;
}

/**
 * Record a check-in or check-out the user could not complete (no GPS, face
 * not recognised, refused by the server). It is queued like everything else,
 * so it reaches the supervisor even if the failure was caused by no signal.
 */
export function reportAttempt(
  userId: number,
  kind: 'CHECKIN' | 'CHECKOUT',
  reason: AttemptReason,
  detail?: string,
  where?: Record<string, unknown>,
) {
  const body: Record<string, unknown> = { kind, reason, detail: detail?.slice(0, 500) };
  if (typeof where?.latitude === 'number') body.latitude = where.latitude;
  if (typeof where?.longitude === 'number') body.longitude = where.longitude;
  if (typeof where?.accuracy_m === 'number') body.accuracy_m = where.accuracy_m;
  addItem(capture('attempt', userId, body))
    .then(() => flush())
    .catch((e) => console.warn('[sync] could not queue attempt', e));
}

const ORDERED: OutboxKind[] = ['checkin', 'checkout'];
let flushing: Promise<void> | null = null;

/** Send what is due. `force` ignores the backoff timer (the user pressed "send now"). */
export function flush(force = false): Promise<void> {
  if (!flushing) {
    flushing = runFlush(force).finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function runFlush(force: boolean) {
  await loadOutbox();
  const user = getAuthState().user;
  if (!user) return;

  const pending = getItems()
    .filter((i) => i.userId === user.id && i.state === 'pending')
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  let blocked = false; // an earlier check-in/out is still waiting
  let delivered = false;
  for (const item of pending) {
    const ordered = ORDERED.includes(item.kind);
    if (ordered && blocked) continue;
    if (!force && item.nextTryAt > Date.now()) {
      if (ordered) blocked = true;
      continue;
    }
    const outcome = await sendOnce(item);
    if (outcome.status === 'sent' && ordered) delivered = true;
    if (outcome.status !== 'sent' && ordered) blocked = true;
  }
  if (delivered) notifySynced();
}

// ── Engine ────────────────────────────────────────────────────────────────────

const syncedListeners = new Set<() => void>();

function notifySynced() {
  syncedListeners.forEach((l) => l());
}

/**
 * Start background delivery: on launch, when the app returns to the
 * foreground, when the network comes back, after login, and every 20 s.
 * `onSynced` runs after a check-in or check-out reaches the server.
 */
export function startOutboxSync(onSynced: () => void): () => void {
  syncedListeners.add(onSynced);
  const tick = () => {
    flush().catch((e) => console.warn('[sync] flush failed', e));
  };

  tick();
  const interval = setInterval(tick, 20_000);
  const appSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') tick();
  });
  const unsubAuth = subscribeToAuthState((s) => {
    if (s.user) tick();
  });

  let unsubNet: (() => void) | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require('@react-native-community/netinfo');
    let wasConnected = true;
    unsubNet = NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
      const connected = state.isConnected !== false;
      if (connected && !wasConnected) tick();
      wasConnected = connected;
    });
  } catch {
    // NetInfo unavailable (web): the interval still runs
  }

  return () => {
    syncedListeners.delete(onSynced);
    clearInterval(interval);
    appSub.remove();
    unsubAuth();
    unsubNet?.();
  };
}

/**
 * Outbox: check-ins, check-outs and failed-attempt reports waiting to reach
 * the server. Stored as a JSON file in the app's document directory so it
 * survives the app being closed, the phone restarting and the user logging out.
 *
 * Every item carries a client event id. The server treats a repeated id as the
 * same event, so an item can be sent again after a timeout without creating a
 * second record.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export type OutboxKind = 'checkin' | 'checkout' | 'attempt' | 'face';

export interface OutboxItem {
  id: string;                      // client_event_id
  userId: number;                  // only sent while this user is logged in
  kind: OutboxKind;
  body: Record<string, unknown>;   // request body without timing fields
  capturedAt: string;              // device wall clock at capture (ISO)
  capturedMono: number;            // performance.now() at capture
  session: string;                 // app process that captured it
  photoPath?: string;              // face photo kept for an offline check-in
  attendanceId?: number;           // for 'face': record to attach the photo to
  tries: number;
  nextTryAt: number;               // epoch ms
  state: 'pending' | 'failed';
  lastError?: string;
}

const FILE_NAME = 'hadirops-outbox.json';
const WEB_KEY = 'hadirops_outbox';

let items: OutboxItem[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

async function fileUri(): Promise<string> {
  const FileSystem = await import('expo-file-system/legacy');
  return `${FileSystem.documentDirectory}${FILE_NAME}`;
}

async function readStore(): Promise<OutboxItem[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(WEB_KEY);
      return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    }
    const FileSystem = await import('expo-file-system/legacy');
    const uri = await fileUri();
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as OutboxItem[];
  } catch (e) {
    console.warn('[outbox] could not read store, starting empty', e);
    return [];
  }
}

async function writeStore(snapshot: OutboxItem[]): Promise<void> {
  const json = JSON.stringify(snapshot);
  if (Platform.OS === 'web') {
    localStorage.setItem(WEB_KEY, json);
    return;
  }
  const FileSystem = await import('expo-file-system/legacy');
  const uri = await fileUri();
  // Write to a temp file first so a crash mid-write cannot corrupt the queue.
  const tmp = `${uri}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, json);
  await FileSystem.moveAsync({ from: tmp, to: uri });
}

function emit() {
  listeners.forEach((l) => l());
}

function persist(): Promise<void> {
  const snapshot = items;
  writeChain = writeChain.then(() => writeStore(snapshot)).catch((e) => {
    console.warn('[outbox] write failed', e);
  });
  return writeChain;
}

export async function loadOutbox(): Promise<void> {
  if (loaded) return;
  if (!loading) {
    loading = readStore().then((stored) => {
      // Keep anything added while the file was being read.
      const ids = new Set(items.map((i) => i.id));
      items = [...stored.filter((i) => !ids.has(i.id)), ...items];
      loaded = true;
      emit();
    });
  }
  await loading;
}

export async function addItem(item: OutboxItem): Promise<void> {
  await loadOutbox();
  items = [...items, item];
  emit();
  await persist();
}

export async function updateItem(id: string, patch: Partial<OutboxItem>): Promise<void> {
  items = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  emit();
  await persist();
}

export async function removeItem(id: string): Promise<void> {
  const item = items.find((i) => i.id === id);
  items = items.filter((i) => i.id !== id);
  emit();
  await persist();
  if (item?.photoPath && Platform.OS !== 'web') {
    const FileSystem = await import('expo-file-system/legacy');
    await FileSystem.deleteAsync(item.photoPath, { idempotent: true }).catch(() => undefined);
  }
}

export function getItems(): OutboxItem[] {
  return items;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Items of the given user, oldest first. */
export function useOutbox(userId: number | undefined): OutboxItem[] {
  const all = useSyncExternalStore(subscribe, getItems, getItems);
  return userId == null ? [] : all.filter((i) => i.userId === userId);
}

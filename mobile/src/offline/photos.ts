import { Platform } from 'react-native';

/**
 * Copy a camera photo out of the cache (which the OS may clear) into the
 * app's document directory, so it can be uploaded when the check-in syncs.
 * Returns undefined on web or if the copy fails; the check-in still goes ahead.
 */
export async function keepPhoto(cacheUri: string, eventId: string): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const { Directory, File, Paths } = await import('expo-file-system');
    // Same folder the legacy API used, so photos queued before an update still sync.
    const dir = new Directory(Paths.document, 'outbox-photos');
    dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, `${eventId}.jpg`);
    await new File(cacheUri).copy(target, { overwrite: true });
    return target.uri;
  } catch (e) {
    console.warn('[photos] could not keep photo', e);
    return undefined;
  }
}

import { Platform } from 'react-native';

/**
 * Copy a camera photo out of the cache (which the OS may clear) into the
 * app's document directory, so it can be uploaded when the check-in syncs.
 * Returns undefined on web or if the copy fails; the check-in still goes ahead.
 */
export async function keepPhoto(cacheUri: string, eventId: string): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const dir = `${FileSystem.documentDirectory}outbox-photos/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
    const target = `${dir}${eventId}.jpg`;
    await FileSystem.copyAsync({ from: cacheUri, to: target });
    return target;
  } catch (e) {
    console.warn('[photos] could not keep photo', e);
    return undefined;
  }
}

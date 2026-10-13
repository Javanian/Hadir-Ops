/**
 * exportCsv — write a 2-D array as a UTF-8 CSV file and share / save it.
 *
 * Strategy (Android):
 *   1. Write to documentDirectory (FileProvider exposes this on all Android versions)
 *   2. Share via expo-sharing (ACTION_SEND with content:// URI)
 *   Fallback: if sharing module unavailable, use StorageAccessFramework to
 *   let the user pick a Downloads / storage folder and save directly.
 *
 * Strategy (iOS): same share-sheet approach via expo-sharing.
 *
 * Adds a UTF-8 BOM (\uFEFF) so Excel recognises the encoding on Windows
 * (important for Indonesian characters).
 */

import { Platform } from 'react-native';

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvString(rows: unknown[][]): string {
  return rows
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');
}

export async function exportCsv(rows: unknown[][], filename: string): Promise<void> {
  const [
    { documentDirectory, writeAsStringAsync, EncodingType, StorageAccessFramework },
    Sharing,
  ] = await Promise.all([
    import('expo-file-system/legacy'),
    import('expo-sharing'),
  ]);

  const csv = '\uFEFF' + buildCsvString(rows);

  const dir = documentDirectory ?? '';
  const uri = `${dir}${filename}`;

  await writeAsStringAsync(uri, csv, { encoding: EncodingType.UTF8 });

  const isAvailable = await Sharing.isAvailableAsync();

  if (isAvailable) {
    await Sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Ekspor ke Excel / CSV',
      UTI: 'public.comma-separated-values-text',
    });
    return;
  }

  if (Platform.OS === 'android') {
    const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permissions.granted) {
      throw new Error('Izin penyimpanan ditolak.');
    }
    const destUri = await StorageAccessFramework.createFileAsync(
      permissions.directoryUri,
      filename,
      'text/csv',
    );
    await writeAsStringAsync(destUri, csv, { encoding: EncodingType.UTF8 });
    return;
  }

  throw new Error('Berbagi file tidak tersedia di perangkat ini.');
}

/**
 * exportCsv — write a 2-D array as a UTF-8 CSV file and share / save it.
 *
 * Strategy (Android):
 *   1. Write to the document directory (FileProvider exposes it on all Android versions)
 *   2. Share via expo-sharing (ACTION_SEND with content:// URI)
 *   Fallback: if sharing is unavailable, let the user pick a Downloads /
 *   storage folder (Storage Access Framework) and save there directly.
 *
 * Strategy (iOS): same share-sheet approach via expo-sharing.
 *
 * Adds a UTF-8 BOM (\uFEFF) so Excel recognises the encoding on Windows
 * (important for Indonesian characters).
 */

import { Platform } from 'react-native';
import { t } from '../i18n'

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
  const [{ Directory, File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);

  const csv = '\uFEFF' + buildCsvString(rows);

  const file = new File(Paths.document, filename);
  file.create({ overwrite: true });
  await file.write(csv);
  const uri = file.uri;

  const isAvailable = await Sharing.isAvailableAsync();

  if (isAvailable) {
    await Sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      dialogTitle: t('exportCsv.exportToExcelCsv'),
      UTI: 'public.comma-separated-values-text',
    });
    return;
  }

  if (Platform.OS === 'android') {
    let folder;
    try {
      folder = await Directory.pickDirectoryAsync();
    } catch {
      throw new Error(t('exportCsv.storageAccessDenied'));
    }
    await folder.createFile(filename, 'text/csv').write(csv);
    return;
  }

  throw new Error(t('exportCsv.fileSharingIsNotAvailable'));
}

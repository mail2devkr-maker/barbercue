import * as FileSystem from 'expo-file-system/legacy';
import { Share } from 'react-native';
import type * as DocumentPickerModule from 'expo-document-picker';
import { hasExpoNativeModule } from './native-availability';
import { readServiceSheet, SERVICE_SHEET_TEMPLATE_CSV, type SheetImportResult } from './service-sheet-import';

// Loaded only on a binary that contains the native picker (see lib/native-availability.ts).
function loadDocumentPicker(): typeof DocumentPickerModule | null {
  if (!hasExpoNativeModule('ExpoDocumentPicker')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-document-picker') as typeof DocumentPickerModule;
  } catch {
    return null;
  }
}

/** False on an older binary without the native document picker: the import button stays hidden. */
export function canPickServiceSheet(): boolean {
  return loadDocumentPicker() !== null;
}

/**
 * Lets the user choose an .xlsx / .csv file and reads its services on the phone. Nothing is
 * uploaded. Resolves null when the user cancels; throws an Error with a readable message.
 */
export async function pickServiceSheet(): Promise<(SheetImportResult & { fileName: string }) | null> {
  const DocumentPicker = loadDocumentPicker();
  if (!DocumentPicker) throw new Error('This app version cannot open files. Update the app from the store.');
  const picked = await DocumentPicker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/comma-separated-values',
      'text/tab-separated-values',
      'application/vnd.ms-excel',
      '*/*',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const file = picked.assets[0];
  const fileName = file.name ?? 'services';
  try {
    const result = await readServiceSheet({
      name: fileName,
      size: file.size,
      readBase64: () => FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 }),
    });
    return { ...result, fileName };
  } finally {
    // The picker copied the file into the app cache; do not keep it.
    void FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
  }
}

/** Shares the CSV template as text (paste into Excel / Google Sheets, or save as .csv). */
export async function shareServiceSheetTemplate(): Promise<void> {
  await Share.share({ title: 'FastQue services template', message: SERVICE_SHEET_TEMPLATE_CSV.replace(/\r\n/g, '\n') });
}

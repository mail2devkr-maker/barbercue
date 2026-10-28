import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Share } from 'react-native';
import { apiFetchResponse } from './api';

export class FileShareUnavailableError extends Error {
  constructor() {
    super('Secure file sharing is not available on this platform build.');
    this.name = 'FileShareUnavailableError';
  }
}

type SharedFile =
  | { kind: 'text'; path: string; fileName: string; contentType: 'text/csv' | 'application/vnd.ms-excel' }
  | { kind: 'pdf'; path: string; fileName: string; contentType: 'application/pdf' };

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'fastque-export';
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    encoded += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? '=' : alphabet[third & 63];
  }
  return encoded;
}

/**
 * Fetches an owner-authorized export through the authenticated API client, writes it only to the
 * app's temporary cache, opens the native iOS share sheet, then removes the temporary copy.
 * Android 1.0.3 is deliberately not given an unsupported file-URI share path.
 */
export async function shareOwnerFile(file: SharedFile): Promise<void> {
  if (Platform.OS !== 'ios') throw new FileShareUnavailableError();
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error('Temporary file storage is unavailable.');

  const response = await apiFetchResponse(file.path);
  const responseType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (responseType !== file.contentType) throw new Error('The server returned an unexpected file type.');

  let contents: string;
  let encoding: FileSystem.EncodingType;
  if (file.kind === 'pdf') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
      throw new Error('The server response is not a valid PDF.');
    }
    contents = bytesToBase64(bytes);
    encoding = FileSystem.EncodingType.Base64;
  } else {
    contents = await response.text();
    if (!contents.trim()) throw new Error('The server returned an empty export.');
    encoding = FileSystem.EncodingType.UTF8;
  }

  const fileName = safeFileName(file.fileName);
  const cachePrefix = cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`;
  const uri = `${cachePrefix}${Date.now()}-${fileName}`;
  await FileSystem.writeAsStringAsync(uri, contents, { encoding });
  try {
    await Share.share({ title: fileName, url: uri });
  } finally {
    // The system share sheet has consumed the file by the time its promise resolves. Do not leave
    // invoices or revenue exports in persistent application storage.
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

import type { ImagePickerAsset } from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

export const IMAGE_UPLOAD_PREPARATION_MESSAGE =
  'Could not prepare this image for upload. Please choose another image and try again.';

/**
 * Raised before fetch when a picker URI cannot be inspected or copied into an uploadable local
 * file. Keeping this distinct from apiFetch's network error lets the UI give an actionable local
 * recovery message instead of claiming the whole app is offline.
 */
export class ImageUploadPreparationError extends Error {
  readonly code = 'IMAGE_UPLOAD_PREPARATION_FAILED';

  constructor(cause?: unknown) {
    super(IMAGE_UPLOAD_PREPARATION_MESSAGE);
    this.name = 'ImageUploadPreparationError';
    // Keep the native error available only to development diagnostics; callers should show the
    // stable, non-technical message above.
    if (cause !== undefined) this.cause = cause;
  }

  readonly cause?: unknown;
}

export interface PreparedImageUpload {
  uri: string;
  name: string;
  type: string;
  cleanup: () => Promise<void>;
}

let temporaryFileSequence = 0;

function uriScheme(uri: string): string {
  const match = /^([a-z][a-z\d+.-]*):/i.exec(uri);
  return match?.[1]?.toLowerCase() ?? 'unknown';
}

function extensionFromName(name: string): string | null {
  const match = /\.([a-z\d]{1,8})$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? null;
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return 'jpg';
  }
}

function safeUploadName(asset: ImagePickerAsset, fallbackName: string): string {
  const candidate = asset.fileName?.trim().split(/[\\/]/).pop() || fallbackName;
  const sanitized = candidate.replace(/[^a-z\d._-]/gi, '_');
  return sanitized || fallbackName;
}

function uploadMimeType(asset: ImagePickerAsset, name: string): string {
  const supplied = typeof asset.mimeType === 'string' ? asset.mimeType.trim() : '';
  // Preserve the picker-provided MIME type so server-side validation remains authoritative. The
  // fallback only fills the gap when Android's ContentProvider could not provide one.
  if (supplied) return supplied;
  switch (extensionFromName(name)) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    default:
      return 'image/jpeg';
  }
}

function temporaryFileUri(mimeType: string, name: string): string {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error('Device cache directory is unavailable');
  const extension = extensionFromName(name) ?? extensionFromMimeType(mimeType);
  temporaryFileSequence += 1;
  return `${cacheDirectory}barbercue-upload-${Date.now()}-${temporaryFileSequence}.${extension}`;
}

async function removeTemporaryFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[image-upload] temporary file cleanup failed', {
        scheme: uriScheme(uri),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function reportPreparationFailure(asset: ImagePickerAsset, error: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.warn('[image-upload] local preparation failed', {
    scheme: uriScheme(asset.uri),
    hasFileName: Boolean(asset.fileName),
    hasMimeType: Boolean(asset.mimeType),
    fileSize: asset.fileSize ?? null,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Converts an ImagePicker asset into a stable file:// URI for React Native multipart transport.
 * Android document providers may return content:// URIs whose temporary access/serialization can
 * fail later during fetch; copying them while picker permission is active makes that failure
 * deterministic and local. Existing file:// assets are only inspected, never copied or changed.
 */
export async function prepareImageUpload(asset: ImagePickerAsset, fallbackName: string): Promise<PreparedImageUpload> {
  const uri = typeof asset.uri === 'string' ? asset.uri.trim() : '';
  const name = safeUploadName(asset, fallbackName);
  const type = uploadMimeType(asset, name);
  let temporaryUri: string | null = null;

  try {
    if (!uri) throw new Error('Picker returned an empty URI');

    const sourceInfo = await FileSystem.getInfoAsync(uri);
    if (!sourceInfo.exists || sourceInfo.isDirectory) throw new Error('Picked image is not readable');

    if (uriScheme(uri) === 'file') {
      return { uri, name, type, cleanup: async () => {} };
    }

    temporaryUri = temporaryFileUri(type, name);
    await FileSystem.copyAsync({ from: uri, to: temporaryUri });
    const copiedInfo = await FileSystem.getInfoAsync(temporaryUri);
    if (!copiedInfo.exists || copiedInfo.isDirectory || copiedInfo.size <= 0) {
      throw new Error('Copied image is not readable');
    }

    const preparedUri = temporaryUri;
    temporaryUri = null;
    return { uri: preparedUri, name, type, cleanup: () => removeTemporaryFile(preparedUri) };
  } catch (error) {
    if (temporaryUri) await removeTemporaryFile(temporaryUri);
    reportPreparationFailure(asset, error);
    throw new ImageUploadPreparationError(error);
  }
}

/**
 * Keeps a copied picker file alive until the request (including an auth-refresh retry) is done.
 * The native sender receives the verified file URI and controls the multipart transport.
 */
export async function uploadImageAsset<T>(
  asset: ImagePickerAsset,
  fallbackName: string,
  send: (prepared: Pick<PreparedImageUpload, 'uri' | 'name' | 'type'>) => Promise<T>,
): Promise<T> {
  const prepared = await prepareImageUpload(asset, fallbackName);
  try {
    return await send(prepared);
  } finally {
    await prepared.cleanup();
  }
}

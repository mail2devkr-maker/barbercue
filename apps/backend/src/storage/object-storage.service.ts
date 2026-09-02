import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { StorageDriver } from './storage-driver';
import { LocalDiskStorageDriver } from './local-disk-storage-driver';
import {
  S3CompatibleStorageDriver,
  missingS3EnvVars,
} from './s3-compatible-storage-driver';

export const OBJECT_STORAGE_NOT_CONFIGURED = 'OBJECT_STORAGE_NOT_CONFIGURED';

/**
 * Facade in front of whichever StorageDriver is actually active. SalonPhotosService (and anything
 * else that ends up storing an owner-uploaded file) depends on this class only — never on a
 * concrete driver — so the storage backend is a deployment-time configuration choice, not a code
 * choice. See storage-driver.ts for the full rationale.
 *
 * Selection, checked once at boot, driven by the optional STORAGE_DRIVER variable:
 *   - STORAGE_DRIVER=r2   → S3CompatibleStorageDriver only. Never falls back to local storage even
 *                           if LOCAL_STORAGE_* also happens to be set — an operator who explicitly
 *                           asked for R2 must not be silently served from a stray local volume. If
 *                           any of the five required OBJECT_STORAGE_* variables is missing, the
 *                           driver stays unconfigured (uploads fail loudly) and the boot log names
 *                           exactly which variables are missing.
 *   - STORAGE_DRIVER=local → LocalDiskStorageDriver only, ignoring any OBJECT_STORAGE_* vars.
 *   - unset (the default)  → LocalDiskStorageDriver.fromEnv() ?? S3CompatibleStorageDriver.fromEnv(),
 *                           preserved unchanged for backward compatibility with every existing
 *                           deployment that predates this selector (nothing here changes behavior
 *                           for a deployment that never sets STORAGE_DRIVER).
 *   - anything else        → treated as unconfigured; the boot log names the unrecognized value.
 *
 * Whichever branch resolves with neither driver configured is a first-class, safe state, following
 * UnconfiguredAiImageProvider's precedent: the app boots fine, every other feature works, and only
 * an actual upload attempt fails — loudly and truthfully, never with a fabricated URL or a silent
 * no-op. Linking an existing https photo URL keeps working regardless.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly driver: StorageDriver | null;

  constructor() {
    const explicitDriver = process.env.STORAGE_DRIVER?.trim().toLowerCase();

    if (explicitDriver === 'r2') {
      this.driver = S3CompatibleStorageDriver.fromEnv();
      if (!this.driver) {
        this.logger.error(
          `STORAGE_DRIVER=r2 but required variable(s) missing: ${missingS3EnvVars().join(', ')}. ` +
            'Uploads will be rejected until all five OBJECT_STORAGE_* variables are set — not ' +
            'falling back to local storage.',
        );
      }
    } else if (explicitDriver === 'local') {
      this.driver = LocalDiskStorageDriver.fromEnv();
      if (!this.driver) {
        this.logger.error(
          'STORAGE_DRIVER=local but LOCAL_STORAGE_DIR and/or LOCAL_STORAGE_PUBLIC_BASE_URL is ' +
            'missing. Uploads will be rejected until both are set.',
        );
      }
    } else if (explicitDriver) {
      this.logger.error(
        `STORAGE_DRIVER="${explicitDriver}" is not a recognized value (expected "r2" or "local"). ` +
          'No storage driver will be active; uploads will be rejected.',
      );
      this.driver = null;
    } else {
      // No explicit selector: unchanged pre-existing behavior.
      this.driver =
        LocalDiskStorageDriver.fromEnv() ?? S3CompatibleStorageDriver.fromEnv();
    }

    if (!this.driver && !explicitDriver) {
      this.logger.warn(
        'No photo storage driver is configured — uploads will be rejected with a clear error. ' +
          'For launch, set LOCAL_STORAGE_DIR and LOCAL_STORAGE_PUBLIC_BASE_URL (a Railway Volume ' +
          'mount). Alternatively set STORAGE_DRIVER=r2 and all five OBJECT_STORAGE_* variables. ' +
          'Linking an existing https photo URL works either way.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.driver !== null;
  }

  /**
   * Stores bytes under `key` and returns the public https URL a customer's browser will load.
   *
   * `contentType` must be the caller's *sniffed* type, not the client's declared one — see
   * StorageDriver's doc comment.
   */
  async putPublicObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.driver) {
      throw new AppException(
        OBJECT_STORAGE_NOT_CONFIGURED,
        'Photo uploads are not available yet — image storage is still being set up. You can add a photo by pasting a link to one you already have online.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      return await this.driver.putPublicObject(key, body, contentType);
    } catch {
      // The driver already logged the real cause (bucket/path, credential hints) — the browser
      // gets only a generic, safe message.
      throw new AppException(
        'PHOTO_UPLOAD_FAILED',
        'Could not save that photo. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Best-effort cleanup for a Photo row being removed. Never throws: SalonPhotosService.remove()
   * calls this after the database row is already gone, so a storage-side failure here must not
   * turn a successful "photo removed" into an error response, and a linked (non-uploaded) photo's
   * URL simply won't match any configured driver's prefix and is left untouched.
   */
  async deleteObject(url: string): Promise<void> {
    if (!this.driver) return;
    await this.driver.deleteObject(url);
  }
}

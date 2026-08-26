import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { StorageDriver } from './storage-driver';
import { LocalDiskStorageDriver } from './local-disk-storage-driver';
import { S3CompatibleStorageDriver } from './s3-compatible-storage-driver';

export const OBJECT_STORAGE_NOT_CONFIGURED = 'OBJECT_STORAGE_NOT_CONFIGURED';

/**
 * Facade in front of whichever StorageDriver is actually active. SalonPhotosService (and anything
 * else that ends up storing an owner-uploaded file) depends on this class only — never on a
 * concrete driver — so the storage backend is a deployment-time configuration choice, not a code
 * choice. See storage-driver.ts for the full rationale.
 *
 * Selection order, checked once at boot:
 *   1. LocalDiskStorageDriver — the launch driver. A Railway persistent Volume mounted at
 *      LOCAL_STORAGE_DIR, served back out through the backend's own static middleware (main.ts).
 *      Chosen first because it is what production actually runs at launch; no object-storage
 *      account or credentials needed.
 *   2. S3CompatibleStorageDriver — Cloudflare R2 (or any S3-compatible provider), for whenever the
 *      product outgrows a single-instance/single-volume deployment. Fully implemented today;
 *      switching to it is a config change (unset the LOCAL_STORAGE_* vars, set the five
 *      OBJECT_STORAGE_* vars), never a code change.
 *   3. Neither configured — unconfigured is a first-class, safe state, following
 *      UnconfiguredAiImageProvider's precedent: the app boots fine, every other feature works, and
 *      only an actual upload attempt fails — loudly and truthfully, never with a fabricated URL or
 *      a silent no-op. Linking an existing https photo URL keeps working regardless.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly driver: StorageDriver | null;

  constructor() {
    this.driver =
      LocalDiskStorageDriver.fromEnv() ?? S3CompatibleStorageDriver.fromEnv();

    if (!this.driver) {
      this.logger.warn(
        'No photo storage driver is configured — uploads will be rejected with a clear error. ' +
          'For launch, set LOCAL_STORAGE_DIR and LOCAL_STORAGE_PUBLIC_BASE_URL (a Railway Volume ' +
          'mount). Alternatively set all five OBJECT_STORAGE_* variables for R2/S3. Linking an ' +
          'existing https photo URL works either way.',
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

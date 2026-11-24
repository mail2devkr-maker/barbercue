import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppException } from '../common/exceptions/app.exception';

export const PRIVATE_STORAGE_NOT_CONFIGURED = 'PRIVATE_STORAGE_NOT_CONFIGURED';

/**
 * Storage for files that must never be publicly reachable: salon onboarding photos and menu
 * cards before an admin approves them for public display. Deliberately separate from
 * ObjectStorageService, whose objects are public by design (main.ts statically serves the whole
 * LOCAL_STORAGE_DIR, and R2 objects there get a public URL). Callers receive bytes only through an
 * authenticated API route; this service never returns a URL.
 */
export interface PrivateStorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class LocalPrivateStorageDriver implements PrivateStorageDriver {
  constructor(private readonly dir: string) {}

  /**
   * PRIVATE_STORAGE_DIR, provided it is not inside LOCAL_STORAGE_DIR (which main.ts serves
   * publicly). A private directory nested in the public one would silently publish every file.
   */
  static fromEnv(): LocalPrivateStorageDriver | null {
    const publicDir = process.env.LOCAL_STORAGE_DIR?.trim();
    const configured = process.env.PRIVATE_STORAGE_DIR?.trim();
    const dir =
      configured ||
      (S3PrivateStorageDriver.fromEnv()
        ? undefined
        : LocalPrivateStorageDriver.volumeDir(publicDir));
    if (!dir) return null;
    if (!configured) return new LocalPrivateStorageDriver(resolve(dir));
    if (publicDir) {
      const root = resolve(publicDir) + sep;
      if ((resolve(dir) + sep).startsWith(root)) return null;
    }
    return new LocalPrivateStorageDriver(resolve(dir));
  }

  /**
   * Nothing configured: keep private files on the same persistent Railway volume as the public
   * photos. When the photos use a sub-folder, a sibling folder is never served. When they use the
   * whole volume, a dot-folder is used - main.ts refuses every dotfile path under the static mount.
   * No volume means no safe default, so uploads stay off.
   */
  static volumeDir(publicDir: string | undefined): string | undefined {
    const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
    if (!mount) return undefined;
    const root = resolve(mount);
    if (!publicDir) return join(root, 'private-files');
    const pub = resolve(publicDir);
    if (pub === root) return join(root, '.private-files');
    // A public folder elsewhere, or inside the volume: a sibling folder is outside it.
    const sibling = join(root, 'private-files');
    return (sibling + sep).startsWith(pub + sep) ? undefined : sibling;
  }

  private path(key: string): string {
    const resolved = normalize(join(this.dir, key));
    if (!resolved.startsWith(normalize(this.dir) + sep)) {
      throw new Error(
        'Refusing to access a path outside the private storage directory.',
      );
    }
    return resolved;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: 'wx' });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** A separate, non-public bucket (OBJECT_STORAGE_PRIVATE_BUCKET) using the existing credentials. */
export class S3PrivateStorageDriver implements PrivateStorageDriver {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  static fromEnv(): S3PrivateStorageDriver | null {
    const bucket = process.env.OBJECT_STORAGE_PRIVATE_BUCKET?.trim();
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim();
    const key = process.env.OBJECT_STORAGE_KEY?.trim();
    const secret = process.env.OBJECT_STORAGE_SECRET?.trim();
    if (!bucket || !endpoint || !key || !secret) return null;
    return new S3PrivateStorageDriver(bucket, endpoint, key, secret);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'private, no-store',
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

@Injectable()
export class PrivateObjectStorageService {
  private readonly logger = new Logger(PrivateObjectStorageService.name);
  private readonly driver: PrivateStorageDriver | null;

  constructor() {
    this.driver =
      LocalPrivateStorageDriver.fromEnv() ?? S3PrivateStorageDriver.fromEnv();
    if (!this.driver) {
      this.logger.warn(
        'No private storage is configured, so onboarding photo uploads will be rejected. Set ' +
          'PRIVATE_STORAGE_DIR (outside LOCAL_STORAGE_DIR) or OBJECT_STORAGE_PRIVATE_BUCKET.',
      );
    }
  }

  /** Test seam: lets specs inject an in-memory driver. */
  static withDriver(
    driver: PrivateStorageDriver | null,
  ): PrivateObjectStorageService {
    const service = Object.create(
      PrivateObjectStorageService.prototype,
    ) as PrivateObjectStorageService;
    Object.assign(service, {
      driver,
      logger: new Logger(PrivateObjectStorageService.name),
    });
    return service;
  }

  get isConfigured(): boolean {
    return this.driver !== null;
  }

  private require(): PrivateStorageDriver {
    if (!this.driver) {
      throw new AppException(
        PRIVATE_STORAGE_NOT_CONFIGURED,
        'Photo uploads are not available yet because private file storage is not configured. You can still enter services manually and save the draft.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.driver;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const driver = this.require();
    try {
      await driver.put(key, body, contentType);
    } catch (err) {
      this.logger.error(
        `Private upload failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new AppException(
        'PRIVATE_UPLOAD_FAILED',
        'Could not save that file. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async get(key: string): Promise<Buffer | null> {
    return this.require().get(key);
  }

  /** Best effort: a storage-side failure never turns a completed DB change into an error. */
  async delete(key: string): Promise<void> {
    if (!this.driver) return;
    try {
      await this.driver.delete(key);
    } catch (err) {
      this.logger.warn(
        `Private delete failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}

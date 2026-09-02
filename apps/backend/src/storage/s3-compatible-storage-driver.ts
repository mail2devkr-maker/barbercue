import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { StorageDriver } from './storage-driver';

interface S3DriverConfig {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  publicBaseUrl: string;
}

const REQUIRED_ENV_VARS = [
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_KEY',
  'OBJECT_STORAGE_SECRET',
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_PUBLIC_BASE_URL',
] as const;

/**
 * Which of the five required OBJECT_STORAGE_* variables are absent or blank — names only, never
 * values. Used by ObjectStorageService to report a precise, actionable diagnostic when
 * STORAGE_DRIVER=r2 is explicitly requested but not fully configured, rather than the generic
 * "not configured" message that fits the implicit/unset-selector case.
 */
export function missingS3EnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());
}

/**
 * S3-compatible object storage — Cloudflare R2, AWS S3, or Backblaze B2, since all three speak
 * the same PutObject/DeleteObject API and only the endpoint differs. Not the launch driver (see
 * ObjectStorageService's selection order — a Railway-mounted volume is, via LocalDiskStorageDriver),
 * but left fully implemented and selectable by env var alone so switching to R2 later needs no
 * code change, only configuration.
 */
export class S3CompatibleStorageDriver implements StorageDriver {
  private readonly logger = new Logger(S3CompatibleStorageDriver.name);
  private readonly client: S3Client;

  private constructor(private readonly config: S3DriverConfig) {
    this.client = new S3Client({
      // R2 has no meaningful region but the S3 protocol requires the field to be set.
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /** All five OBJECT_STORAGE_* variables present and non-empty, or null — never a half-built client. */
  static fromEnv(): S3CompatibleStorageDriver | null {
    const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
    const accessKeyId = process.env.OBJECT_STORAGE_KEY?.trim();
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET?.trim();
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim();
    const publicBaseUrl = process.env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim();
    if (
      !bucket ||
      !accessKeyId ||
      !secretAccessKey ||
      !endpoint ||
      !publicBaseUrl
    ) {
      return null;
    }
    return new S3CompatibleStorageDriver({
      bucket,
      accessKeyId,
      secretAccessKey,
      endpoint,
      // Trailing slash normalised once here so callers can always join with a single '/'.
      publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
    });
  }

  async putPublicObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Salon photos are public by nature — they are the pictures on a shop's public profile.
          // Long-lived caching is safe because every key carries a random component, so a new
          // upload is always a new URL and nothing ever needs invalidating.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (err) {
      // The provider's own error can carry bucket names and credential hints — log it for the
      // operator, never return it to the browser. The caller (ObjectStorageService) turns any
      // thrown error here into the generic PHOTO_UPLOAD_FAILED response.
      this.logger.error(
        `R2/S3 upload failed for key "${key}": ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw err;
    }
    return `${this.config.publicBaseUrl}/${key}`;
  }

  async deleteObject(url: string): Promise<void> {
    const prefix = `${this.config.publicBaseUrl}/`;
    if (!url.startsWith(prefix)) return; // Not one of ours — e.g. an owner-linked URL.
    const key = url.slice(prefix.length);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch (err) {
      // Deletion is cleanup, not the operation the caller asked for — a failure here must never
      // surface as "could not remove your photo" when the database row is already gone.
      this.logger.warn(
        `R2/S3 delete failed for key "${key}" (photo row was already removed): ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}

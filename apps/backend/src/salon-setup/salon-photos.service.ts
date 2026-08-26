import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PhotoType, SALON_PHOTO_UPLOAD } from '@barbercue/shared';
import type {
  CreateSalonPhotoInput,
  PhotoDto,
  SalonPhotoUploadMetaInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  detectImageMimeType,
  extensionForMimeType,
} from '../storage/image-signature';

// A shop needs a handful of good photos, not an album. Capping keeps the profile page fast and
// stops one salon filling discovery with fifty near-identical shots.
const MAX_PHOTOS_PER_SALON = 12;

/**
 * Owner-side salon photos, same assertAccess-first shape as the rest of salon-setup.
 *
 * A photo reaches a salon by one of two routes, and both end at the same `Photo` row with the
 * same {url, altText, type} shape — there is one photo model here, not two:
 *
 *   1. `create` — the owner links an image they already host (Google Business profile, Instagram,
 *      a CDN). The backend never fetches that URL, only the visitor's browser does, so it is not
 *      an SSRF surface; salonPhotoUrlSchema decides what we are willing to store and render
 *      (https only, no embedded credentials).
 *   2. `createFromUpload` — the owner picks a file off their phone or laptop. The bytes go
 *      through ObjectStorageService to whichever StorageDriver is active (a Railway-mounted
 *      volume at launch, R2 later — see that service's own doc comment) and the resulting public
 *      https URL is stored in exactly the same column route 1 writes.
 *
 * Uploads are typed by their magic bytes, never by the filename or the browser-declared MIME
 * type, and are capped at SALON_PHOTO_UPLOAD.maxBytes by multer before a byte reaches this
 * service.
 *
 * WHAT STILL REMAINS for a fully hardened pipeline: re-encoding through an image library to strip
 * EXIF (phone cameras embed GPS coordinates, and a shop owner photographing their own shop is
 * publishing their workplace's location), pixel-dimension limits to blunt decompression bombs, and
 * a virus scan. None of that is stubbed or faked here.
 *
 * Unlike Service and Chair, Photo has no inbound foreign keys anywhere in the schema, so removing
 * one is a genuine delete rather than a status flip; nothing can be orphaned by it.
 */
@Injectable()
export class SalonPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly storage: ObjectStorageService,
  ) {}

  async list(userId: string, salonId: string): Promise<PhotoDto[]> {
    await this.salonAccess.assertAccess(userId, salonId);
    const photos = await this.prisma.photo.findMany({
      where: { salonId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return photos.map((p) => this.toDto(p));
  }

  /** Route 1: link an image the owner already hosts. Unchanged contract. */
  async create(
    userId: string,
    salonId: string,
    input: CreateSalonPhotoInput,
  ): Promise<PhotoDto> {
    await this.salonAccess.assertAccess(userId, salonId);
    const count = await this.assertUnderLimit(salonId);
    return this.insert(salonId, input.url, input.altText, input.type, count);
  }

  /**
   * Route 2: the owner picks a file off their device.
   *
   * Ordering matters. Access, then the photo cap, then file validation all happen BEFORE anything
   * is written to object storage, so a rejected upload never leaves an orphaned object in the
   * bucket that nothing in the database refers to and nothing ever cleans up.
   */
  async createFromUpload(
    userId: string,
    salonId: string,
    file: Express.Multer.File | undefined,
    meta: SalonPhotoUploadMetaInput,
  ): Promise<PhotoDto> {
    await this.salonAccess.assertAccess(userId, salonId);
    const count = await this.assertUnderLimit(salonId);

    if (!file || file.size === 0) {
      throw new AppException(
        'PHOTO_FILE_REQUIRED',
        'Please choose a photo to upload.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // multer's own `limits.fileSize` truncates rather than throwing in some configurations, so the
    // size is checked again here against the real buffer rather than assumed to have been enforced.
    if (file.size > SALON_PHOTO_UPLOAD.maxBytes) {
      throw new AppException(
        'PHOTO_TOO_LARGE',
        `That photo is too large. Please choose one under ${Math.floor(SALON_PHOTO_UPLOAD.maxBytes / (1024 * 1024))} MB.`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // The decisive check: what the bytes ARE, not what the upload claims. file.mimetype and the
    // original filename are both client-controlled and are never consulted.
    const detected = detectImageMimeType(file.buffer);
    if (!detected) {
      throw new AppException(
        'PHOTO_UNSUPPORTED_TYPE',
        'That file is not a supported image. Please upload a JPG, PNG or WebP.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    // Random key, never the uploaded filename: a client-supplied name could collide with an
    // existing object, contain path separators, or leak whatever the owner happened to call the
    // file. Scoped by salon so a bucket listing stays readable.
    const key = `salons/${salonId}/photos/${randomUUID()}.${extensionForMimeType(detected)}`;
    const url = await this.storage.putPublicObject(key, file.buffer, detected);

    return this.insert(salonId, url, meta.altText, meta.type, count);
  }

  /** Current photo count, or a typed error when the salon is already at the cap. */
  private async assertUnderLimit(salonId: string): Promise<number> {
    const count = await this.prisma.photo.count({ where: { salonId } });
    if (count >= MAX_PHOTOS_PER_SALON) {
      throw new AppException(
        'PHOTO_LIMIT_REACHED',
        `You can add up to ${MAX_PHOTOS_PER_SALON} photos. Remove one to add another.`,
        HttpStatus.CONFLICT,
      );
    }
    return count;
  }

  /**
   * The single write path both routes share, so a linked photo and an uploaded one are the same
   * kind of row with the same cover semantics.
   *
   * Exactly one cover: it is the image discovery cards and the profile hero use, so a second one
   * would make "the" cover ambiguous. Promoting a new cover demotes the old one to gallery rather
   * than deleting it — the owner keeps the picture, it just stops being the headline.
   */
  private async insert(
    salonId: string,
    url: string,
    altText: string | undefined,
    type: PhotoType,
    sortOrder: number,
  ): Promise<PhotoDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      if (type === PhotoType.COVER) {
        await tx.photo.updateMany({
          where: { salonId, type: PhotoType.COVER },
          data: { type: PhotoType.GALLERY },
        });
      }
      return tx.photo.create({
        data: { salonId, url, altText: altText ?? null, type, sortOrder },
      });
    });

    return this.toDto(created);
  }

  async remove(
    userId: string,
    salonId: string,
    photoId: string,
  ): Promise<void> {
    await this.salonAccess.assertAccess(userId, salonId);
    // deleteMany scoped by salonId, not delete-by-id: an id alone would let an owner of salon A
    // delete a photo belonging to salon B. url is selected out first (deleteMany itself cannot
    // return the row) so the storage-side cleanup below knows what to remove.
    const [photo] = await this.prisma.photo.findMany({
      where: { id: photoId, salonId },
      select: { url: true },
    });
    if (!photo) {
      throw new AppException(
        'PHOTO_NOT_FOUND',
        'Photo not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.photo.deleteMany({ where: { id: photoId, salonId } });
    // Best-effort and after the database is already updated. ObjectStorageService.deleteObject is
    // documented as never-throwing, but that contract is enforced here too rather than trusted
    // blindly — a surprise rejection from a future/misbehaving driver must not turn an already-
    // successful "photo removed" into a 500 for the owner.
    try {
      await this.storage.deleteObject(photo.url);
    } catch {
      // Nothing else to do: the row is already gone, and the driver itself already logged
      // whatever went wrong.
    }
  }

  private toDto(photo: {
    id: string;
    url: string;
    altText: string | null;
    type: PhotoType;
  }): PhotoDto {
    return {
      id: photo.id,
      url: photo.url,
      altText: photo.altText,
      type: photo.type,
    };
  }
}

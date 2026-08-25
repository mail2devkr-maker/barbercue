import { HttpStatus, Injectable } from '@nestjs/common';
import { PhotoType } from '@barbercue/shared';
import type { CreateSalonPhotoInput, PhotoDto } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

// A shop needs a handful of good photos, not an album. Capping keeps the profile page fast and
// stops one salon filling discovery with fifty near-identical shots.
const MAX_PHOTOS_PER_SALON = 12;

/**
 * Owner-side salon photos, same assertAccess-first shape as the rest of salon-setup.
 *
 * Photos are referenced by URL rather than uploaded: no object storage is configured for this
 * deployment, and inventing one is an infrastructure decision, not a code one. An owner links an
 * image they already host (Google Business profile, Instagram, a CDN). The backend never fetches
 * the URL — only the visitor's browser does — so this is not an SSRF surface; validation is about
 * what we are willing to store and render, and is enforced by salonPhotoUrlSchema (https only,
 * no embedded credentials).
 *
 * WHAT REMAINS for a full upload pipeline: an object-storage bucket plus credentials, a
 * multipart endpoint with real image sniffing (magic bytes, not the declared MIME type),
 * re-encoding to strip EXIF, size/dimension limits, and a virus scan. None of that is stubbed or
 * faked here — the URL path is a complete, working feature on its own.
 *
 * Unlike Service and Chair, Photo has no inbound foreign keys anywhere in the schema, so removing
 * one is a genuine delete rather than a status flip; nothing can be orphaned by it.
 */
@Injectable()
export class SalonPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async list(userId: string, salonId: string): Promise<PhotoDto[]> {
    await this.salonAccess.assertAccess(userId, salonId);
    const photos = await this.prisma.photo.findMany({
      where: { salonId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return photos.map((p) => this.toDto(p));
  }

  async create(
    userId: string,
    salonId: string,
    input: CreateSalonPhotoInput,
  ): Promise<PhotoDto> {
    await this.salonAccess.assertAccess(userId, salonId);

    const count = await this.prisma.photo.count({ where: { salonId } });
    if (count >= MAX_PHOTOS_PER_SALON) {
      throw new AppException(
        'PHOTO_LIMIT_REACHED',
        `You can add up to ${MAX_PHOTOS_PER_SALON} photos. Remove one to add another.`,
        HttpStatus.CONFLICT,
      );
    }

    // Exactly one cover: it is the image discovery cards and the profile hero use, so a second
    // one would make "the" cover ambiguous. Promoting a new cover demotes the old one to gallery
    // rather than deleting it — the owner keeps the picture, it just stops being the headline.
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.type === PhotoType.COVER) {
        await tx.photo.updateMany({
          where: { salonId, type: PhotoType.COVER },
          data: { type: PhotoType.GALLERY },
        });
      }
      return tx.photo.create({
        data: {
          salonId,
          url: input.url,
          altText: input.altText ?? null,
          type: input.type,
          sortOrder: count,
        },
      });
    });

    return this.toDto(created);
  }

  async remove(userId: string, salonId: string, photoId: string): Promise<void> {
    await this.salonAccess.assertAccess(userId, salonId);
    // deleteMany scoped by salonId, not delete-by-id: an id alone would let an owner of salon A
    // delete a photo belonging to salon B.
    const result = await this.prisma.photo.deleteMany({
      where: { id: photoId, salonId },
    });
    if (result.count === 0) {
      throw new AppException(
        'PHOTO_NOT_FOUND',
        'Photo not found.',
        HttpStatus.NOT_FOUND,
      );
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

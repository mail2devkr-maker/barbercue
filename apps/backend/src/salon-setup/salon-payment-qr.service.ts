import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { SalonPaymentQrDto, SetSalonPaymentQrInput } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  detectImageMimeType,
  extensionForMimeType,
} from '../storage/image-signature';

/**
 * Owner-facing counterpart to BookingErrorCode.PAYMENT_QR_REQUIRED (FastQue Credits / Wallet V1):
 * until an owner sets this, BookingsService.create refuses every ONLINE (APP/WEB-sourced) booking
 * at their salon. Same link-or-upload dual path and same assertOwnerAccess-first shape as
 * SalonPhotosService, minus the multi-row/cover-photo complexity — this is exactly one column on
 * SalonPaymentPolicy, not a list.
 *
 * SalonPaymentPolicy has no row for a salon until something writes one (nothing does today except
 * this service) — every method here upserts rather than assuming the row already exists.
 */
@Injectable()
export class SalonPaymentQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly storage: ObjectStorageService,
  ) {}

  async get(userId: string, salonId: string): Promise<SalonPaymentQrDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const policy = await this.prisma.salonPaymentPolicy.findUnique({
      where: { salonId },
      select: { paymentQrImageUrl: true },
    });
    return { salonId, paymentQrImageUrl: policy?.paymentQrImageUrl ?? null };
  }

  /** Route 1: link an image the owner already hosts. */
  async setLink(
    userId: string,
    salonId: string,
    input: SetSalonPaymentQrInput,
  ): Promise<SalonPaymentQrDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const before = actor === 'PLATFORM_ADMIN' ? await this.currentUrl(salonId) : null;
    const result = await this.upsert(salonId, input.url);
    if (actor === 'PLATFORM_ADMIN') {
      await this.logAdminAudit(userId, salonId, 'link', before, result.paymentQrImageUrl);
    }
    return result;
  }

  /** Route 2: the owner picks a file off their device — same magic-byte validation as
   * SalonPhotosService.createFromUpload, so a mislabeled or corrupt file is rejected the same way. */
  async setFromUpload(
    userId: string,
    salonId: string,
    file: Express.Multer.File | undefined,
  ): Promise<SalonPaymentQrDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);

    if (!file || file.size === 0) {
      throw new AppException(
        'PAYMENT_QR_FILE_REQUIRED',
        'Please choose a QR code image to upload.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const detected = detectImageMimeType(file.buffer);
    if (!detected) {
      throw new AppException(
        'PAYMENT_QR_UNSUPPORTED_TYPE',
        'That file is not a supported image. Please upload a JPG, PNG or WebP.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    const before = actor === 'PLATFORM_ADMIN' ? await this.currentUrl(salonId) : null;
    const key = `salons/${salonId}/payment-qr/${randomUUID()}.${extensionForMimeType(detected)}`;
    const url = await this.storage.putPublicObject(key, file.buffer, detected);
    const result = await this.upsert(salonId, url);
    if (actor === 'PLATFORM_ADMIN') {
      await this.logAdminAudit(userId, salonId, 'upload', before, result.paymentQrImageUrl);
    }
    return result;
  }

  async remove(userId: string, salonId: string): Promise<void> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const policy = await this.prisma.salonPaymentPolicy.findUnique({
      where: { salonId },
      select: { paymentQrImageUrl: true },
    });
    if (!policy?.paymentQrImageUrl) return;
    await this.prisma.salonPaymentPolicy.update({
      where: { salonId },
      data: { paymentQrImageUrl: null },
    });
    if (actor === 'PLATFORM_ADMIN') {
      await this.logAdminAudit(userId, salonId, 'remove', policy.paymentQrImageUrl, null);
    }
    try {
      await this.storage.deleteObject(policy.paymentQrImageUrl);
    } catch {
      // Best-effort, same contract as SalonPhotosService.remove — the row is already updated.
    }
  }

  private async currentUrl(salonId: string): Promise<string | null> {
    const policy = await this.prisma.salonPaymentPolicy.findUnique({
      where: { salonId },
      select: { paymentQrImageUrl: true },
    });
    return policy?.paymentQrImageUrl ?? null;
  }

  // Part 2 — every delegated admin mutation gets an AuditLog row with the real admin actor. Logs
  // the image URL (already public/owner-shared, never a secret), never file bytes/EXIF/anything
  // from the multipart upload itself.
  private async logAdminAudit(
    adminUserId: string,
    salonId: string,
    via: 'link' | 'upload' | 'remove',
    before: string | null,
    after: string | null,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'ADMIN_PAYMENT_QR_UPDATED',
        entityType: 'Salon',
        entityId: salonId,
        metadata: { via, before, after },
      },
    });
  }

  private async upsert(
    salonId: string,
    url: string,
  ): Promise<SalonPaymentQrDto> {
    const updated = await this.prisma.salonPaymentPolicy.upsert({
      where: { salonId },
      create: { salonId, paymentQrImageUrl: url },
      update: { paymentQrImageUrl: url },
      select: { paymentQrImageUrl: true },
    });
    return { salonId, paymentQrImageUrl: updated.paymentQrImageUrl };
  }
}

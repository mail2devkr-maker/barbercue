import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BookingErrorCode, isValidPostalCode, postalCodeRuleFor } from '@barbercue/shared';
import type { SalonProfileDetailDto, UpdateSalonProfileInput } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

/**
 * Owner/admin-shared basic shop profile (Part 2, admin delegated shop management). No endpoint for
 * this existed before this file — an owner had no self-service way to correct a typo in their
 * shop's name, address or contact details after registration, and building an admin-only version
 * of that would itself be the "inconsistent owner-vs-admin behavior" this mission asks to avoid.
 * One service, one schema (updateSalonProfileSchema), used identically by both callers via
 * assertOwnerOrAdminAccess — exactly the same pattern as SalonTimezoneService/SalonServicesService.
 *
 * Deliberately narrow: only name/phone/email/addressLine/postalCode/description are writable here.
 * slug, cityId/localityId, publicId, ownerUserId and status are never touched — each is either
 * immutable in practice (publicId/slug: nothing else in the codebase ever updates them post-
 * create) or would break a public URL, a routing invariant, or an ownership/lifecycle guarantee
 * enforced elsewhere (SalonActivationService owns status; SalonTimezoneService owns timezone).
 */
@Injectable()
export class SalonProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async get(userId: string, salonId: string): Promise<SalonProfileDetailDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        addressLine: true,
        postalCode: true,
        description: true,
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return salon;
  }

  async update(
    userId: string,
    salonId: string,
    input: UpdateSalonProfileInput,
  ): Promise<SalonProfileDetailDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const existing = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true,
        phone: true,
        email: true,
        addressLine: true,
        postalCode: true,
        description: true,
        city: { select: { countryCode: true } },
      },
    });
    if (!existing) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Shape-only in the shared schema (mirrors registerSalonSchema's own split) — the real,
    // country-aware check happens here, against the salon's own stored country, same "schema
    // checks shape, service checks reality" split SalonTimezoneService.updateTimezone uses for
    // isValidTimeZone.
    if (input.postalCode !== undefined && input.postalCode !== '' && !isValidPostalCode(existing.city.countryCode, input.postalCode)) {
      const rule = postalCodeRuleFor(existing.city.countryCode);
      throw new AppException(
        'SALON_POSTAL_CODE_INVALID',
        rule.example
          ? `Enter a valid ${rule.label} (for example ${rule.example})`
          : `Enter a valid ${rule.label}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const data = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone || null }),
      ...(input.email !== undefined && { email: input.email || null }),
      ...(input.addressLine !== undefined && { addressLine: input.addressLine }),
      ...(input.postalCode !== undefined && { postalCode: input.postalCode || null }),
      ...(input.description !== undefined && { description: input.description || null }),
    };
    const updated = await this.prisma.salon.update({
      where: { id: salonId },
      data,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        addressLine: true,
        postalCode: true,
        description: true,
      },
    });

    // Part 2 — every delegated admin mutation gets an AuditLog row with the real admin actor; an
    // owner editing their own shop is unchanged (no new logging for that path).
    if (actor === 'PLATFORM_ADMIN') {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const field of Object.keys(data) as (keyof typeof data)[]) {
        before[field] = existing[field as keyof typeof existing];
        after[field] = updated[field as keyof typeof updated];
      }
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_SALON_PROFILE_UPDATED',
          entityType: 'Salon',
          entityId: salonId,
          metadata: { before, after } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return updated;
  }
}

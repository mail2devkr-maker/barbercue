import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  type SalonTimezoneResultDto,
  type UpdateSalonTimezoneInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { isValidTimeZone } from '../common/timezone/timezone';
import { resolveAutoTimezone } from '../common/timezone/timezone-resolution';

/**
 * Owner-facing counterpart to the Global timezone correctness work: booking availability,
 * analytics, isOpenNow and queue token numbering all resolve the salon's real IANA zone (or throw
 * SALON_TIMEZONE_REQUIRED for a booking-critical path) via resolveSalonTimeZone, but until this
 * existed there was no way for an owner of a non-India salon to actually set one — the column was
 * writable only by direct DB access or the seed script. India salons keep working unchanged either
 * way, since resolveSalonTimeZone already falls back to Asia/Kolkata for them without an explicit
 * value.
 *
 * SALON_OWNER-only at the controller level (SalonSetupController's class-level @Roles), same as
 * every other setup endpoint — staff run the operational floor, they don't reconfigure the shop.
 */
@Injectable()
export class SalonTimezoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async getTimezone(
    userId: string,
    salonId: string,
  ): Promise<SalonTimezoneResultDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        timezone: true,
        timezoneAutoDetected: true,
        timezoneManuallyOverridden: true,
        lat: true,
        lng: true,
        city: { select: { countryCode: true, timezone: true } },
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: salon.id,
      timezone: salon.timezone,
      countryCode: salon.city.countryCode,
      timezoneAutoDetected: salon.timezoneAutoDetected,
      timezoneManuallyOverridden: salon.timezoneManuallyOverridden,
      // Computed fresh every call, never persisted on its own — see SalonTimezoneResultDto's
      // doc comment for why this is offered even when `timezone` is already set.
      suggestion: resolveAutoTimezone({
        latitude: salon.lat,
        longitude: salon.lng,
        cityTimezone: salon.city.timezone,
        countryCode: salon.city.countryCode,
      }),
    };
  }

  async updateTimezone(
    userId: string,
    salonId: string,
    input: UpdateSalonTimezoneInput,
  ): Promise<SalonTimezoneResultDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        timezone: true,
        lat: true,
        lng: true,
        city: { select: { countryCode: true, timezone: true } },
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    // The schema only checks shape (non-empty, "Area/Location"-like) — this is the real check, the
    // same one every booking/analytics/isOpenNow consumer already trusts via resolveSalonTimeZone.
    // Rejecting an unrecognized zone here is what keeps that later, booking-critical check from
    // ever throwing SALON_TIMEZONE_REQUIRED for a value the owner *thought* they'd already set.
    const requestedTimezone = input.timezone;
    if (!isValidTimeZone(requestedTimezone)) {
      // isValidTimeZone's `value is string` guard narrows `requestedTimezone` itself to `never` in
      // this branch (its declared type was already `string`) — a separate, un-narrowed copy keeps
      // the rejected value available to quote back in the error message.
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        `"${input.timezone}" is not a recognized time zone. Use a name like "Asia/Kolkata" or "America/New_York".`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const previousTimezone = salon.timezone;
    // Any explicit PATCH — whether the owner typed a value or clicked "use detected timezone" and
    // then saved — is a deliberate confirmation, never an automatic write. Once this has happened,
    // the stored value is authoritative and must never be silently replaced by a future
    // auto-detect pass (Part 4, section 7/5).
    const updated = await this.prisma.salon.update({
      where: { id: salonId },
      data: {
        timezone: input.timezone,
        timezoneAutoDetected: false,
        timezoneManuallyOverridden: true,
      },
      select: { id: true, timezone: true, timezoneAutoDetected: true, timezoneManuallyOverridden: true },
    });
    // Part 2 — every delegated admin mutation gets an AuditLog row with the real actor; an owner
    // editing their own shop is unchanged (no new logging for that path).
    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_SALON_TIMEZONE_UPDATED',
          entityType: 'Salon',
          entityId: salonId,
          metadata: { field: 'timezone', before: previousTimezone, after: updated.timezone },
        },
      });
    }
    return {
      ...updated,
      countryCode: salon.city.countryCode,
      suggestion: resolveAutoTimezone({
        latitude: salon.lat,
        longitude: salon.lng,
        cityTimezone: salon.city.timezone,
        countryCode: salon.city.countryCode,
      }),
    };
  }
}

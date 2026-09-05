import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  OperatingHoursDto,
  SetOperatingHoursInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

// 0 = Sunday .. 6 = Saturday — the JS Date.getUTCDay() convention AvailabilityService already
// uses (see istDateToDayOfWeek). Not a new convention.
const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

// Shown for a day that has no row yet. Deliberately CLOSED with placeholder times rather than a
// guessed 09:00-21:00: inventing trading hours for a real business is fabricated data, and a
// closed default fails safe — an owner who never opens this screen simply has no bookable slots,
// which is the behaviour that already exists today.
const UNSET_DAY: Omit<OperatingHoursDto, 'dayOfWeek'> = {
  openTime: '09:00',
  closeTime: '21:00',
  isClosed: true,
};

/**
 * Owner-side weekly opening hours — the missing piece that made booking impossible for every
 * self-registered salon.
 *
 * AvailabilityService resolves bookable slots per IST calendar day and treats a day with no
 * OperatingHours row (or `isClosed`) as shut, returning zero slots and rejecting direct booking
 * attempts with OUTSIDE_OPERATING_HOURS. Nothing outside prisma/seed.ts ever wrote this table, so
 * a shop registered through the product could take walk-ins via the queue but could never be
 * booked. This service is the write path.
 *
 * Same shape as SalonServicesService/SalonChairsService: assertOwnerAccess first, everything scoped by
 * salonId. The whole week is replaced in one transaction rather than exposing per-day CRUD — an
 * owner edits a schedule as a unit, and a partial save (Monday written, Tuesday failed) would
 * leave a shop half-open in a way nobody asked for.
 */
@Injectable()
export class SalonOperatingHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  /** Always returns exactly 7 entries, ordered Sunday..Saturday, so the UI has a stable shape. */
  async list(userId: string, salonId: string): Promise<OperatingHoursDto[]> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const rows = await this.prisma.operatingHours.findMany({
      where: { salonId },
    });
    const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
    return DAYS_OF_WEEK.map((dayOfWeek) => {
      const row = byDay.get(dayOfWeek);
      return row
        ? {
            dayOfWeek,
            openTime: row.openTime,
            closeTime: row.closeTime,
            isClosed: row.isClosed,
          }
        : { dayOfWeek, ...UNSET_DAY };
    });
  }

  /**
   * Replaces the salon's whole week. Upserts rather than delete-then-insert: OperatingHours rows
   * are keyed by (salonId, dayOfWeek), so upserting keeps each row's identity stable and avoids a
   * window where a concurrent availability lookup sees a salon with no hours at all.
   */
  async set(
    userId: string,
    salonId: string,
    input: SetOperatingHoursInput,
  ): Promise<OperatingHoursDto[]> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const before = actor === 'PLATFORM_ADMIN' ? await this.list(userId, salonId) : null;

    await this.prisma.$transaction(
      input.days.map((day) =>
        this.prisma.operatingHours.upsert({
          where: {
            salonId_dayOfWeek: { salonId, dayOfWeek: day.dayOfWeek },
          },
          update: {
            openTime: day.openTime,
            closeTime: day.closeTime,
            isClosed: day.isClosed,
          },
          create: {
            salonId,
            dayOfWeek: day.dayOfWeek,
            openTime: day.openTime,
            closeTime: day.closeTime,
            isClosed: day.isClosed,
          },
        }),
      ),
    );

    const after = await this.list(userId, salonId);
    // Part 2 — every delegated admin mutation gets an AuditLog row with the real admin actor.
    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_OPERATING_HOURS_UPDATED',
          entityType: 'Salon',
          entityId: salonId,
          metadata: { before, after } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return after;
  }
}

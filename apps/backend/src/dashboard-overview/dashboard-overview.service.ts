import { Injectable } from '@nestjs/common';
import {
  QueueEntryStatus,
  Role,
  SalonStatus,
  type OwnerMultiShopOverviewDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { resolveSalonTimeZone, zonedDayBounds } from '../common/timezone/timezone';

/**
 * Multi-branch aggregate overview (Phase 10) — every count here is a plain sum across the salons
 * THIS user's own UserRole rows say they own (derived from the authenticated user, never a
 * client-supplied salon list), so there is no separate authorization check to get wrong: an owner
 * can only ever see totals for shops they already have SalonAccessService-equivalent access to.
 * Deliberately aggregate-only — no per-salon breakdown — so this can never become a way to read
 * one specific shop's numbers through a differently-authorized route.
 */
@Injectable()
export class DashboardOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string): Promise<OwnerMultiShopOverviewDto> {
    const ownedRoles = await this.prisma.userRole.findMany({
      where: { userId, role: Role.SALON_OWNER },
      select: { salonId: true },
    });
    const salonIds = [
      ...new Set(
        ownedRoles
          .map((r) => r.salonId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (salonIds.length === 0) {
      return {
        totalShops: 0,
        openShops: 0,
        todaysBookingsTotal: 0,
        activeQueueTotal: 0,
      };
    }

    const now = new Date();
    const [salons, activeQueueTotal] = await Promise.all([
      this.prisma.salon.findMany({
        where: { id: { in: salonIds } },
        select: {
          id: true,
          status: true,
          timezone: true,
          city: { select: { countryCode: true } },
        },
      }),
      this.prisma.queueEntry.count({
        where: {
          salonId: { in: salonIds },
          status: {
            in: [
              QueueEntryStatus.WAITING,
              QueueEntryStatus.CALLED,
              QueueEntryStatus.IN_SERVICE,
            ],
          },
        },
      }),
    ]);

    const todaysBookingsTotal = await this.sumTodaysBookings(salons, now);

    return {
      totalShops: salonIds.length,
      openShops: salons.filter((s) => s.status === SalonStatus.ACTIVE).length,
      todaysBookingsTotal,
      activeQueueTotal,
    };
  }

  /**
   * Owned shops can be in different timezones, so "today" is not one shared window across them —
   * each salon's own local calendar day is resolved independently and OR'd into a single query.
   * Returns null (never a silently partial sum) the moment any owned salon lacks a trustworthy
   * timezone — a total that quietly excluded one shop's bookings would look like a real, complete
   * number while actually under-reporting it.
   */
  private async sumTodaysBookings(
    salons: {
      id: string;
      timezone: string | null;
      city: { countryCode: string };
    }[],
    now: Date,
  ): Promise<number | null> {
    const perSalonRanges: { salonId: string; start: Date; end: Date }[] = [];
    for (const salon of salons) {
      const timeZone = resolveSalonTimeZone({
        timezone: salon.timezone,
        countryCode: salon.city.countryCode,
      });
      const bounds = timeZone ? zonedDayBounds(now, timeZone) : null;
      if (!bounds) return null;
      perSalonRanges.push({ salonId: salon.id, start: bounds.start, end: bounds.end });
    }
    if (perSalonRanges.length === 0) return 0;

    return this.prisma.booking.count({
      where: {
        OR: perSalonRanges.map((r) => ({
          salonId: r.salonId,
          slotStart: { gte: r.start, lt: r.end },
        })),
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import {
  QueueEntryStatus,
  Role,
  SalonStatus,
  type OwnerMultiShopOverviewDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  istWallTimeToUtc,
  utcToIstDateStr,
} from '../bookings/availability.service';

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

    // Same fixed +05:30 IST convention used throughout this codebase.
    const todayIst = utcToIstDateStr(new Date());
    const todayStart = istWallTimeToUtc(todayIst, '00:00');
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60_000);

    const [salons, todaysBookingsTotal, activeQueueTotal] = await Promise.all([
      this.prisma.salon.findMany({
        where: { id: { in: salonIds } },
        select: { status: true },
      }),
      this.prisma.booking.count({
        where: {
          salonId: { in: salonIds },
          slotStart: { gte: todayStart, lt: todayEnd },
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

    return {
      totalShops: salonIds.length,
      openShops: salons.filter((s) => s.status === SalonStatus.ACTIVE).length,
      todaysBookingsTotal,
      activeQueueTotal,
    };
  }
}

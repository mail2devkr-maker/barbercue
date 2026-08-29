import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  BookingStatus,
  QueueEntrySource,
  ServiceSessionStatus,
  type HourCountDto,
  type OwnerAnalyticsDto,
  type OwnerAnalyticsRange,
  type ServicePopularityDto,
  type UtilizationEntryDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  istWallTimeToUtc,
  utcToIstDateStr,
} from '../bookings/availability.service';

const PEAK_SLOW_HOUR_COUNT = 5;
// Same fixed +05:30 offset convention used throughout this codebase (no salon timezone field is
// populated yet — see availability.service.ts's own doc comment).
const IST_OFFSET_MINUTES = 330;

function istHourOf(date: Date): number {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return ist.getUTCHours();
}

/**
 * Owner operational analytics (Phase 9) — real DB aggregates only, no external analytics provider
 * and no invented numbers. Every query is scoped by salonId via SalonAccessService.assertAccess,
 * same isolation guarantee as every other owner dashboard endpoint.
 *
 * estimatedServiceValue is a clearly-labeled estimate (listed price x completed bookings) — never
 * a record of money actually collected, since BarberCue does not process payment. See its own doc
 * comment on OwnerAnalyticsDto.
 */
@Injectable()
export class DashboardAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async getAnalytics(
    userId: string,
    salonId: string,
    rangeRaw: string | undefined,
    fromRaw: string | undefined,
    toRaw: string | undefined,
  ): Promise<OwnerAnalyticsDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);

    const { from, to } = this.resolveRange(rangeRaw, fromRaw, toRaw);

    const [
      salon,
      statusCounts,
      completedBookings,
      walkInCount,
      allBookingsInRange,
      queueWaitSamples,
      completedSessions,
    ] = await Promise.all([
      this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { currency: true },
      }),
      this.prisma.booking.groupBy({
        by: ['status'],
        where: { salonId, slotStart: { gte: from, lt: to } },
        _count: { _all: true },
      }),
      this.prisma.booking.findMany({
        where: {
          salonId,
          status: BookingStatus.COMPLETED,
          slotStart: { gte: from, lt: to },
        },
        select: {
          customerId: true,
          serviceId: true,
          service: { select: { name: true, price: true } },
        },
      }),
      this.prisma.queueEntry.count({
        where: {
          salonId,
          source: QueueEntrySource.WALK_IN,
          joinedAt: { gte: from, lt: to },
        },
      }),
      this.prisma.booking.findMany({
        where: { salonId, slotStart: { gte: from, lt: to } },
        select: { slotStart: true },
      }),
      this.prisma.queueEntry.findMany({
        where: {
          salonId,
          joinedAt: { gte: from, lt: to },
          calledAt: { not: null },
        },
        select: { joinedAt: true, calledAt: true },
      }),
      this.prisma.serviceSession.findMany({
        where: {
          status: ServiceSessionStatus.COMPLETED,
          startedAt: { gte: from, lt: to },
          chair: { salonId },
        },
        select: {
          staffId: true,
          chairId: true,
          startedAt: true,
          endedAt: true,
          staff: { select: { displayName: true } },
          chair: { select: { label: true } },
        },
      }),
    ]);

    const countByStatus = new Map<string, number>();
    for (const row of statusCounts)
      countByStatus.set(row.status, row._count._all);

    const { newCustomerCount, repeatCustomerCount } =
      await this.classifyCustomers(salonId, completedBookings, from);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      currency: salon?.currency ?? null,
      appointmentsBooked: allBookingsInRange.length,
      completedCount: countByStatus.get(BookingStatus.COMPLETED) ?? 0,
      cancelledCount: countByStatus.get(BookingStatus.CANCELLED) ?? 0,
      noShowCount: countByStatus.get(BookingStatus.NO_SHOW) ?? 0,
      walkInCount,
      newCustomerCount,
      repeatCustomerCount,
      averageWaitMinutes: this.averageWaitMinutes(queueWaitSamples),
      averageServiceDurationMinutes:
        this.averageServiceDurationMinutes(completedSessions),
      barberUtilization: this.utilizationBy(
        completedSessions,
        (s) => s.staffId,
        (s) => s.staff?.displayName ?? null,
      ),
      chairUtilization: this.utilizationBy(
        completedSessions,
        (s) => s.chairId,
        (s) => s.chair?.label ?? null,
      ),
      ...this.hourDistribution(allBookingsInRange),
      servicePopularity: this.servicePopularity(completedBookings),
      estimatedServiceValue: completedBookings.reduce(
        (sum, b) => sum + (b.service ? Number(b.service.price) : 0),
        0,
      ),
    };
  }

  private resolveRange(
    rangeRaw: string | undefined,
    fromRaw: string | undefined,
    toRaw: string | undefined,
  ): { from: Date; to: Date } {
    const range: OwnerAnalyticsRange =
      rangeRaw === '7d' || rangeRaw === '30d' || rangeRaw === 'custom'
        ? rangeRaw
        : 'today';

    if (range === 'custom' && fromRaw && toRaw) {
      const from = new Date(fromRaw);
      const to = new Date(toRaw);
      if (
        !Number.isNaN(from.getTime()) &&
        !Number.isNaN(to.getTime()) &&
        from < to
      ) {
        return { from, to };
      }
      throw new AppException(
        BookingErrorCode.SLOT_IN_PAST,
        'Provide a valid from/to range (from must be before to).',
        HttpStatus.BAD_REQUEST,
      );
    }

    const todayIst = utcToIstDateStr(new Date());
    const todayStart = istWallTimeToUtc(todayIst, '00:00');
    const to = new Date(todayStart.getTime() + 24 * 60 * 60_000);
    const daysBack = range === '7d' ? 7 : range === '30d' ? 30 : 1;
    const from = new Date(
      todayStart.getTime() - (daysBack - 1) * 24 * 60 * 60_000,
    );
    return { from, to };
  }

  /**
   * A customer is "new" in this range if the completed booking(s) they have here are their only
   * ones ever — i.e. no completed booking at this salon strictly before `from`. Everyone else who
   * completed a visit in-range is "repeat". Purely a completed-visit-count fact, same principle as
   * OwnerCustomerSummaryDto's segment field.
   */
  private async classifyCustomers(
    salonId: string,
    completedBookings: { customerId: string }[],
    from: Date,
  ): Promise<{ newCustomerCount: number; repeatCustomerCount: number }> {
    const customerIds = [
      ...new Set(completedBookings.map((b) => b.customerId)),
    ];
    if (customerIds.length === 0) {
      return { newCustomerCount: 0, repeatCustomerCount: 0 };
    }
    const priorVisitors = await this.prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        salonId,
        status: BookingStatus.COMPLETED,
        customerId: { in: customerIds },
        slotStart: { lt: from },
      },
      _count: { _all: true },
    });
    const priorIds = new Set(priorVisitors.map((r) => r.customerId));
    const repeatCustomerCount = customerIds.filter((id) =>
      priorIds.has(id),
    ).length;
    return {
      newCustomerCount: customerIds.length - repeatCustomerCount,
      repeatCustomerCount,
    };
  }

  private averageWaitMinutes(
    samples: { joinedAt: Date; calledAt: Date | null }[],
  ): number | null {
    const waits = samples
      .filter(
        (s): s is { joinedAt: Date; calledAt: Date } => s.calledAt !== null,
      )
      .map((s) => (s.calledAt.getTime() - s.joinedAt.getTime()) / 60_000);
    if (waits.length === 0) return null;
    return Math.round(waits.reduce((sum, m) => sum + m, 0) / waits.length);
  }

  private averageServiceDurationMinutes(
    sessions: { startedAt: Date; endedAt: Date | null }[],
  ): number | null {
    const durations = sessions
      .filter(
        (s): s is { startedAt: Date; endedAt: Date } => s.endedAt !== null,
      )
      .map((s) => (s.endedAt.getTime() - s.startedAt.getTime()) / 60_000);
    if (durations.length === 0) return null;
    return Math.round(
      durations.reduce((sum, m) => sum + m, 0) / durations.length,
    );
  }

  private utilizationBy(
    sessions: {
      startedAt: Date;
      endedAt: Date | null;
      staffId: string;
      chairId: string;
      staff?: { displayName: string } | null;
      chair?: { label: string } | null;
    }[],
    keyOf: (s: (typeof sessions)[number]) => string,
    nameOf: (s: (typeof sessions)[number]) => string | null,
  ): UtilizationEntryDto[] {
    const byKey = new Map<string, UtilizationEntryDto>();
    for (const session of sessions) {
      const id = keyOf(session);
      const name = nameOf(session) ?? 'Unknown';
      const minutes = session.endedAt
        ? (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000
        : 0;
      const existing = byKey.get(id);
      if (existing) {
        existing.completedSessions += 1;
        existing.totalServiceMinutes += Math.round(minutes);
      } else {
        byKey.set(id, {
          id,
          displayName: name,
          completedSessions: 1,
          totalServiceMinutes: Math.round(minutes),
        });
      }
    }
    return [...byKey.values()].sort(
      (a, b) => b.completedSessions - a.completedSessions,
    );
  }

  private hourDistribution(bookings: { slotStart: Date }[]): {
    peakHours: HourCountDto[];
    slowHours: HourCountDto[];
  } {
    const counts = new Map<number, number>();
    for (const b of bookings) {
      const hour = istHourOf(b.slotStart);
      counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }
    const entries: HourCountDto[] = [...counts.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .filter((e) => e.count > 0);
    const peakHours = [...entries]
      .sort((a, b) => b.count - a.count)
      .slice(0, PEAK_SLOW_HOUR_COUNT);
    const slowHours = [...entries]
      .sort((a, b) => a.count - b.count)
      .slice(0, PEAK_SLOW_HOUR_COUNT);
    return { peakHours, slowHours };
  }

  private servicePopularity(
    bookings: {
      serviceId: string;
      service: { name: string; price: unknown } | null;
    }[],
  ): ServicePopularityDto[] {
    const byService = new Map<string, ServicePopularityDto>();
    for (const b of bookings) {
      if (!b.service) continue;
      const existing = byService.get(b.serviceId);
      if (existing) existing.completedCount += 1;
      else
        byService.set(b.serviceId, {
          serviceId: b.serviceId,
          name: b.service.name,
          completedCount: 1,
        });
    }
    return [...byService.values()].sort(
      (a, b) => b.completedCount - a.completedCount,
    );
  }
}

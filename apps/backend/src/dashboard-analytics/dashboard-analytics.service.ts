import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  BookingStatus,
  ChairStatus,
  QueueEntrySource,
  ServiceSessionStatus,
  type BarberValueDto,
  type DailyServiceValueDto,
  type HourCountDto,
  type HourServiceValueDto,
  type OwnerAnalyticsDto,
  type OwnerAnalyticsRange,
  type ServicePopularityDto,
  type ServiceValueDto,
  type UtilizationEntryDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  addZonedCalendarDays,
  resolveSalonTimeZone,
  utcToZonedDateStr,
  zonedHourOf,
  zonedWallTimeToUtc,
} from '../common/timezone/timezone';
import {
  resolveEffectiveBookingServices,
  type BookingWithServiceSnapshot,
} from '../bookings/effective-booking-services';

const PEAK_SLOW_HOUR_COUNT = 5;

type ValueFact = {
  at: Date;
  value: number;
  serviceId: string;
  serviceName: string;
  source: 'BOOKING' | 'WALK_IN';
};

type AnalyticsSession = {
  staffId: string;
  chairId: string;
  startedAt: Date;
  endedAt: Date | null;
  staff?: { displayName: string } | null;
  chair?: { label: string } | null;
  service?: { id?: string; name: string; price: unknown } | null;
  queueEntry?: {
    bookingId: string | null;
    source: QueueEntrySource;
    booking?: BookingWithServiceSnapshot | null;
  } | null;
};

/**
 * Owner operational analytics — real DB aggregates only, no external analytics provider and no
 * invented numbers. Every query is salon-scoped through SalonAccessService.
 *
 * FastQue does not observe a salon's complete cash/card settlement ledger, so the business-value
 * charts are intentionally derived from listed-price snapshots for completed appointments plus
 * listed prices for completed walk-ins. The API and UI call these numbers "estimated service
 * value", never audited sales/revenue.
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
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { currency: true, timezone: true, city: { select: { countryCode: true } } },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const timeZone = resolveSalonTimeZone({
      timezone: salon.timezone,
      countryCode: salon.city.countryCode,
    });
    if (!timeZone) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'This salon has not set a timezone yet, so analytics cannot be computed safely.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const { from, to } = this.resolveRange(timeZone, rangeRaw, fromRaw, toRaw);

    const [
      statusCounts,
      completedBookings,
      lostBookings,
      walkInCount,
      allBookingsInRange,
      queueWaitSamples,
      completedSessions,
      operatingHours,
      activeChairCount,
    ] = await Promise.all([
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
          slotStart: true,
          serviceId: true,
          service: { select: { name: true, durationMinutes: true, price: true } },
          services: {
            select: { serviceId: true, serviceName: true, durationMinutes: true, price: true },
          },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          salonId,
          status: { in: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW] },
          slotStart: { gte: from, lt: to },
        },
        select: {
          status: true,
          serviceId: true,
          service: { select: { name: true, durationMinutes: true, price: true } },
          services: {
            select: { serviceId: true, serviceName: true, durationMinutes: true, price: true },
          },
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
          service: { select: { id: true, name: true, price: true } },
          queueEntry: {
            select: {
              bookingId: true,
              source: true,
              booking: {
                select: {
                  serviceId: true,
                  service: { select: { name: true, durationMinutes: true, price: true } },
                  services: {
                    select: { serviceId: true, serviceName: true, durationMinutes: true, price: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.operatingHours.findMany({
        where: { salonId },
        select: { dayOfWeek: true, openTime: true, closeTime: true, isClosed: true },
      }),
      this.prisma.chair.count({
        where: { salonId, status: ChairStatus.ACTIVE },
      }),
    ]);

    const countByStatus = new Map<string, number>();
    for (const row of statusCounts) countByStatus.set(row.status, row._count._all);

    const customerClassification = await this.classifyCustomers(
      salonId,
      completedBookings,
      from,
    );

    const completedSessionRows = completedSessions as unknown as AnalyticsSession[];
    const valueFacts = this.valueFacts(completedBookings, completedSessionRows);
    const appointmentValue = completedBookings.reduce(
      (sum, booking) => sum + this.bookingValue(booking),
      0,
    );
    const walkInCompletedSessions = completedSessionRows.filter(
      (session) => !session.queueEntry?.bookingId,
    );

    const newCustomerEstimatedServiceValue = completedBookings.reduce(
      (sum, booking) =>
        customerClassification.repeatCustomerIds.has(booking.customerId)
          ? sum
          : sum + this.bookingValue(booking),
      0,
    );
    const repeatCustomerEstimatedServiceValue = completedBookings.reduce(
      (sum, booking) =>
        customerClassification.repeatCustomerIds.has(booking.customerId)
          ? sum + this.bookingValue(booking)
          : sum,
      0,
    );

    const cancelledEstimatedServiceValue = lostBookings
      .filter((booking) => booking.status === BookingStatus.CANCELLED)
      .reduce((sum, booking) => sum + this.bookingValue(booking), 0);
    const noShowEstimatedServiceValue = lostBookings
      .filter((booking) => booking.status === BookingStatus.NO_SHOW)
      .reduce((sum, booking) => sum + this.bookingValue(booking), 0);

    const busyChairMinutes = completedSessionRows.reduce(
      (sum, session) =>
        sum +
        (session.endedAt
          ? Math.max(0, (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000)
          : 0),
      0,
    );
    const chairCapacityMinutes =
      activeChairCount *
      this.openMinutesInRange(from, to, timeZone, operatingHours);
    const idleChairMinutes = Math.max(0, Math.round(chairCapacityMinutes - busyChairMinutes));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      currency: salon.currency ?? null,
      appointmentsBooked: allBookingsInRange.length,
      completedCount: countByStatus.get(BookingStatus.COMPLETED) ?? 0,
      cancelledCount: countByStatus.get(BookingStatus.CANCELLED) ?? 0,
      noShowCount: countByStatus.get(BookingStatus.NO_SHOW) ?? 0,
      walkInCount,
      newCustomerCount: customerClassification.newCustomerCount,
      repeatCustomerCount: customerClassification.repeatCustomerCount,
      averageWaitMinutes: this.averageWaitMinutes(queueWaitSamples),
      averageServiceDurationMinutes: this.averageServiceDurationMinutes(completedSessionRows),
      barberUtilization: this.utilizationBy(
        completedSessionRows,
        (session) => session.staffId,
        (session) => session.staff?.displayName ?? null,
      ),
      chairUtilization: this.utilizationBy(
        completedSessionRows,
        (session) => session.chairId,
        (session) => session.chair?.label ?? null,
      ),
      ...this.hourDistribution(allBookingsInRange, timeZone),
      servicePopularity: this.servicePopularity(completedBookings),
      estimatedServiceValue:
        appointmentValue +
        walkInCompletedSessions.reduce(
          (sum, session) => sum + this.sessionValue(session),
          0,
        ),
      dailyServiceValue: this.dailyServiceValue(valueFacts, from, to, timeZone),
      serviceValue: this.serviceValue(valueFacts),
      barberValue: this.barberValue(completedSessionRows),
      sourceMix: {
        bookingCompletedCount: completedBookings.length,
        walkInCompletedCount: walkInCompletedSessions.length,
      },
      hourlyServiceValue: this.hourlyServiceValue(valueFacts, timeZone),
      newCustomerEstimatedServiceValue,
      repeatCustomerEstimatedServiceValue,
      lostOpportunity: {
        cancelledEstimatedServiceValue,
        noShowEstimatedServiceValue,
        idleChairMinutes,
        idleChairPercent:
          chairCapacityMinutes > 0
            ? Math.round((idleChairMinutes / chairCapacityMinutes) * 100)
            : null,
      },
    };
  }

  private resolveRange(
    timeZone: string,
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
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) {
        return { from, to };
      }
      throw new AppException(
        BookingErrorCode.SLOT_IN_PAST,
        'Provide a valid from/to range (from must be before to).',
        HttpStatus.BAD_REQUEST,
      );
    }

    const today = utcToZonedDateStr(new Date(), timeZone);
    const daysBack = range === '7d' ? 7 : range === '30d' ? 30 : 1;
    const fromDate = addZonedCalendarDays(today, -(daysBack - 1));
    const toDate = addZonedCalendarDays(today, 1);
    const from = zonedWallTimeToUtc(fromDate, '00:00', timeZone);
    const to = zonedWallTimeToUtc(toDate, '00:00', timeZone);
    if (!from || !to) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Could not resolve today in this salon’s timezone.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { from, to };
  }

  private async classifyCustomers(
    salonId: string,
    completedBookings: { customerId: string }[],
    from: Date,
  ): Promise<{
    newCustomerCount: number;
    repeatCustomerCount: number;
    repeatCustomerIds: Set<string>;
  }> {
    const customerIds = [...new Set(completedBookings.map((booking) => booking.customerId))];
    if (customerIds.length === 0) {
      return {
        newCustomerCount: 0,
        repeatCustomerCount: 0,
        repeatCustomerIds: new Set<string>(),
      };
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
    const repeatCustomerIds = new Set(priorVisitors.map((row) => row.customerId));
    const repeatCustomerCount = customerIds.filter((id) => repeatCustomerIds.has(id)).length;
    return {
      newCustomerCount: customerIds.length - repeatCustomerCount,
      repeatCustomerCount,
      repeatCustomerIds,
    };
  }

  private bookingValue(booking: BookingWithServiceSnapshot): number {
    return resolveEffectiveBookingServices(booking).reduce(
      (sum, service) => sum + Number(service.price),
      0,
    );
  }

  private sessionValue(session: AnalyticsSession): number {
    if (session.queueEntry?.booking) {
      return this.bookingValue(session.queueEntry.booking);
    }
    return Number(session.service?.price ?? 0);
  }

  private valueFacts(
    completedBookings: Array<BookingWithServiceSnapshot & { slotStart: Date }>,
    sessions: AnalyticsSession[],
  ): ValueFact[] {
    const facts: ValueFact[] = [];
    for (const booking of completedBookings) {
      for (const service of resolveEffectiveBookingServices(booking)) {
        facts.push({
          at: booking.slotStart,
          value: Number(service.price),
          serviceId: service.serviceId,
          serviceName: service.serviceName,
          source: 'BOOKING',
        });
      }
    }
    for (const session of sessions) {
      if (session.queueEntry?.bookingId) continue;
      if (!session.service) continue;
      facts.push({
        at: session.endedAt ?? session.startedAt,
        value: Number(session.service.price),
        serviceId: session.service.id ?? session.service.name,
        serviceName: session.service.name,
        source: 'WALK_IN',
      });
    }
    return facts;
  }

  private dailyServiceValue(
    facts: ValueFact[],
    from: Date,
    to: Date,
    timeZone: string,
  ): DailyServiceValueDto[] {
    const byDate = new Map<string, DailyServiceValueDto>();
    for (const fact of facts) {
      const date = utcToZonedDateStr(fact.at, timeZone);
      const existing = byDate.get(date);
      if (existing) {
        existing.completedCount += 1;
        existing.estimatedServiceValue += fact.value;
      } else {
        byDate.set(date, { date, completedCount: 1, estimatedServiceValue: fact.value });
      }
    }

    const result: DailyServiceValueDto[] = [];
    let date = utcToZonedDateStr(from, timeZone);
    const finalDate = utcToZonedDateStr(new Date(to.getTime() - 1), timeZone);
    while (date <= finalDate) {
      result.push(
        byDate.get(date) ?? { date, completedCount: 0, estimatedServiceValue: 0 },
      );
      date = addZonedCalendarDays(date, 1);
    }
    return result;
  }

  private serviceValue(facts: ValueFact[]): ServiceValueDto[] {
    const byService = new Map<string, ServiceValueDto>();
    for (const fact of facts) {
      const existing = byService.get(fact.serviceId);
      if (existing) {
        existing.completedCount += 1;
        existing.estimatedServiceValue += fact.value;
      } else {
        byService.set(fact.serviceId, {
          serviceId: fact.serviceId,
          name: fact.serviceName,
          completedCount: 1,
          estimatedServiceValue: fact.value,
        });
      }
    }
    return [...byService.values()].sort(
      (a, b) => b.estimatedServiceValue - a.estimatedServiceValue,
    );
  }

  private barberValue(sessions: AnalyticsSession[]): BarberValueDto[] {
    const byStaff = new Map<string, BarberValueDto>();
    for (const session of sessions) {
      const value = this.sessionValue(session);
      const existing = byStaff.get(session.staffId);
      if (existing) {
        existing.completedSessions += 1;
        existing.estimatedServiceValue += value;
      } else {
        byStaff.set(session.staffId, {
          staffId: session.staffId,
          displayName: session.staff?.displayName ?? 'Unknown',
          completedSessions: 1,
          estimatedServiceValue: value,
        });
      }
    }
    return [...byStaff.values()].sort(
      (a, b) => b.estimatedServiceValue - a.estimatedServiceValue,
    );
  }

  private hourlyServiceValue(
    facts: ValueFact[],
    timeZone: string,
  ): HourServiceValueDto[] {
    const rows = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      completedCount: 0,
      estimatedServiceValue: 0,
    }));
    for (const fact of facts) {
      const hour = zonedHourOf(fact.at, timeZone);
      rows[hour].completedCount += 1;
      rows[hour].estimatedServiceValue += fact.value;
    }
    return rows;
  }

  private openMinutesInRange(
    from: Date,
    to: Date,
    timeZone: string,
    hours: Array<{
      dayOfWeek: number;
      openTime: string;
      closeTime: string;
      isClosed: boolean;
    }>,
  ): number {
    if (hours.length === 0) return 0;
    const byDay = new Map(hours.map((row) => [row.dayOfWeek, row]));
    let date = utcToZonedDateStr(from, timeZone);
    const finalDate = utcToZonedDateStr(new Date(to.getTime() - 1), timeZone);
    let total = 0;

    while (date <= finalDate) {
      const dayOfWeek = new Date(`${date}T12:00:00.000Z`).getUTCDay();
      const row = byDay.get(dayOfWeek);
      if (row && !row.isClosed) {
        const open = zonedWallTimeToUtc(date, row.openTime, timeZone);
        const overnight = this.timeToMinutes(row.closeTime) <= this.timeToMinutes(row.openTime);
        const closeDate = overnight ? addZonedCalendarDays(date, 1) : date;
        const close = zonedWallTimeToUtc(closeDate, row.closeTime, timeZone);
        if (open && close) {
          const overlapStart = Math.max(open.getTime(), from.getTime());
          const overlapEnd = Math.min(close.getTime(), to.getTime());
          if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 60_000;
        }
      }
      date = addZonedCalendarDays(date, 1);
    }
    return total;
  }

  private timeToMinutes(value: string): number {
    const [hour = '0', minute = '0'] = value.split(':');
    return Number(hour) * 60 + Number(minute);
  }

  private averageWaitMinutes(
    samples: { joinedAt: Date; calledAt: Date | null }[],
  ): number | null {
    const waits = samples
      .filter((sample): sample is { joinedAt: Date; calledAt: Date } => sample.calledAt !== null)
      .map((sample) => (sample.calledAt.getTime() - sample.joinedAt.getTime()) / 60_000);
    if (waits.length === 0) return null;
    return Math.round(waits.reduce((sum, minutes) => sum + minutes, 0) / waits.length);
  }

  private averageServiceDurationMinutes(
    sessions: { startedAt: Date; endedAt: Date | null }[],
  ): number | null {
    const durations = sessions
      .filter((session): session is { startedAt: Date; endedAt: Date } => session.endedAt !== null)
      .map((session) => (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000);
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length);
  }

  private utilizationBy(
    sessions: AnalyticsSession[],
    keyOf: (session: AnalyticsSession) => string,
    nameOf: (session: AnalyticsSession) => string | null,
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
    return [...byKey.values()].sort((a, b) => b.completedSessions - a.completedSessions);
  }

  private hourDistribution(
    bookings: { slotStart: Date }[],
    timeZone: string,
  ): { peakHours: HourCountDto[]; slowHours: HourCountDto[] } {
    const counts = new Map<number, number>();
    for (const booking of bookings) {
      const hour = zonedHourOf(booking.slotStart, timeZone);
      counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }
    const entries: HourCountDto[] = [...counts.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .filter((entry) => entry.count > 0);
    const peakHours = [...entries]
      .sort((a, b) => b.count - a.count)
      .slice(0, PEAK_SLOW_HOUR_COUNT);
    const slowHours = [...entries]
      .sort((a, b) => a.count - b.count)
      .slice(0, PEAK_SLOW_HOUR_COUNT);
    return { peakHours, slowHours };
  }

  private servicePopularity(
    bookings: BookingWithServiceSnapshot[],
  ): ServicePopularityDto[] {
    const byService = new Map<string, ServicePopularityDto>();
    for (const booking of bookings) {
      for (const service of resolveEffectiveBookingServices(booking)) {
        const existing = byService.get(service.serviceId);
        if (existing) {
          existing.completedCount += 1;
        } else {
          byService.set(service.serviceId, {
            serviceId: service.serviceId,
            name: service.serviceName,
            completedCount: 1,
          });
        }
      }
    }
    return [...byService.values()].sort((a, b) => b.completedCount - a.completedCount);
  }
}

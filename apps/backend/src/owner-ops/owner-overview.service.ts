import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  InvoiceStatus,
  QueueEntryStatus,
  Role,
  ServiceSessionStatus,
  StaffMemberStatus,
  decimalStringToPaise,
  paiseToRupees,
  type OwnerBranchSummaryDto,
  type OwnerOverviewDto,
  type OwnerQueueSummaryDto,
  type OwnerRevenueDto,
  type OwnerScheduleItemDto,
  type OwnerStaffPerformanceDto,
  type OwnerTopServiceDto,
  type PeriodComparisonDto,
  type RevenuePointDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { ReservationService } from '../bookings/reservation.service';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';
import { addZonedCalendarDays, resolveSalonTimeZone } from '../common/timezone/timezone';
import { CancellationAnalyticsService } from './cancellation-analytics.service';
import {
  addMonths,
  daysBetween,
  firstOfMonth,
  localDayWindow,
  localRange,
  mondayOf,
  percentChange,
  todayLocal,
} from './local-time';

const DAILY_POINTS = 14;
const WEEKLY_POINTS = 8;
const MONTHLY_POINTS = 6;
const TOP_SERVICE_WINDOW_DAYS = 30;
const GUEST_LABEL = 'FastQue customer';

type SalonCtx = {
  id: string;
  name: string;
  currency: string | null;
  timeZone: string;
};

/**
 * The owner dashboard's single read model. Every number is derived from real rows for THIS salon
 * (authorization first, then every query is salon-scoped); nothing is hard-coded or estimated
 * without saying so:
 *  - REVENUE means money the shop RECORDED as received (invoice payments, net of recorded refunds).
 *    A completed service, an unpaid invoice or a displayed payment QR is never revenue;
 *    "estimated service value" (listed prices of completed services) is returned separately and
 *    labelled as an estimate;
 *  - day/week/month boundaries are the SHOP's calendar (its own timezone), not the server's;
 *  - a comparison with an empty previous period reports `null`, never a fabricated percentage;
 *  - barber ratings do not exist (a review attaches to a booking, not a barber), so `rating` is
 *    null rather than invented.
 */
@Injectable()
export class OwnerOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly reservations: ReservationService,
    private readonly cancellations: CancellationAnalyticsService,
  ) {}

  async getOverview(userId: string, salonId: string): Promise<OwnerOverviewDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.loadSalon(salonId);
    const today = todayLocal(salon.timeZone);
    const dayWindow = this.requireWindow(localDayWindow(today, salon.timeZone));
    const generatedAt = new Date();

    const [
      settings,
      appointmentsToday,
      cancelledToday,
      queueSummary,
      staffRows,
      activeSessions,
      completedSessionsToday,
      revenue,
      topServices,
      todaysSchedule,
      cancellationSummary,
      branches,
    ] = await Promise.all([
      this.loadSettings(salonId),
      this.prisma.booking.count({
        where: {
          salonId,
          slotStart: { gte: dayWindow.start, lt: dayWindow.end },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT, BookingStatus.COMPLETED, BookingStatus.NO_SHOW] },
        },
      }),
      this.prisma.booking.count({
        where: { salonId, status: BookingStatus.CANCELLED, cancelledAt: { gte: dayWindow.start, lt: dayWindow.end } },
      }),
      this.queueSummary(salonId, dayWindow),
      this.prisma.salonStaff.findMany({
        where: { salonId, accessRevokedAt: null },
        select: { id: true, displayName: true, status: true },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.serviceSession.findMany({
        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
        select: { staffId: true },
      }),
      this.prisma.serviceSession.count({
        where: { status: ServiceSessionStatus.COMPLETED, endedAt: { gte: dayWindow.start, lt: dayWindow.end }, chair: { salonId } },
      }),
      this.revenueFor(salon, today),
      this.topServices(salon, today),
      this.schedule(salonId, dayWindow),
      this.cancellations.summary(salonId, salon.timeZone, 30),
      this.branchSummaries(userId, salonId),
    ]);

    const busyIds = new Set(activeSessions.map((s) => s.staffId));
    const onDuty = staffRows.filter((s) => s.status === StaffMemberStatus.ACTIVE);
    const staffPerformance = await this.staffPerformance(salon, staffRows, busyIds, dayWindow.start, today);

    return {
      salonId,
      salonName: salon.name,
      currency: salon.currency,
      timezone: salon.timeZone,
      localDate: today,
      generatedAt: generatedAt.toISOString(),
      kpis: {
        appointmentsToday,
        customersServedToday: queueSummary.completedToday,
        waitingInQueue: queueSummary.waiting,
        inService: queueSummary.inService,
        availableBarbers: onDuty.filter((s) => !busyIds.has(s.id)).length,
        busyBarbers: onDuty.filter((s) => busyIds.has(s.id)).length,
        activeStaff: onDuty.length,
        completedServicesToday: completedSessionsToday,
        cancelledToday,
        recordedRevenueToday: revenue.today.current,
        recordedPaymentsToday: await this.paymentsRecordedCount(salonId, dayWindow),
      },
      revenue,
      topServices,
      staffPerformance,
      todaysSchedule,
      queueSummary,
      cancellationSummary,
      branches,
      settings,
    };
  }

  async getRevenue(userId: string, salonId: string): Promise<OwnerRevenueDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.loadSalon(salonId);
    return this.revenueFor(salon, todayLocal(salon.timeZone));
  }

  // ---------- pieces ----------

  private async loadSalon(salonId: string): Promise<SalonCtx> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, name: true, currency: true, timezone: true, city: { select: { countryCode: true } } },
    });
    if (!salon) {
      throw new AppException(BookingErrorCode.SALON_NOT_FOUND, 'Shop not found.', HttpStatus.NOT_FOUND);
    }
    const timeZone = resolveSalonTimeZone({ timezone: salon.timezone, countryCode: salon.city.countryCode });
    if (!timeZone) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Set your shop’s timezone so the dashboard can show today’s numbers correctly.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return {
      id: salon.id,
      name: salon.name,
      currency: salon.currency ?? (salon.city.countryCode === 'IN' ? 'INR' : null),
      timeZone,
    };
  }

  private requireWindow<T>(value: T | null): T {
    if (!value) {
      throw new AppException(BookingErrorCode.SALON_TIMEZONE_REQUIRED, 'Could not resolve today in this shop’s timezone.', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return value;
  }

  private async loadSettings(salonId: string): Promise<OwnerOverviewDto['settings']> {
    const salon = await this.prisma.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: {
        queueAutoAssignEnabled: true,
        showPhoneToCustomers: true,
        paymentPolicy: { select: { paymentQrImageUrl: true } },
        billingProfile: { select: { legalName: true } },
      },
    });
    return {
      autoAssignEnabled: salon.queueAutoAssignEnabled,
      showPhoneToCustomers: salon.showPhoneToCustomers,
      hasPaymentQr: Boolean(salon.paymentPolicy?.paymentQrImageUrl),
      hasBillingProfile: Boolean(salon.billingProfile?.legalName),
    };
  }

  private async queueSummary(salonId: string, day: { start: Date; end: Date }): Promise<OwnerQueueSummaryDto> {
    const [active, completedToday, terminal] = await Promise.all([
      this.prisma.queueEntry.groupBy({
        by: ['status'],
        where: { salonId, status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED, QueueEntryStatus.IN_SERVICE] } },
        _count: { _all: true },
      }),
      this.prisma.queueEntry.count({
        where: { salonId, status: QueueEntryStatus.COMPLETED, serviceCompletedAt: { gte: day.start, lt: day.end } },
      }),
      this.prisma.queueEntry.groupBy({
        by: ['status'],
        where: {
          salonId,
          status: { in: [QueueEntryStatus.CANCELLED, QueueEntryStatus.EXPIRED, QueueEntryStatus.NO_SHOW] },
          updatedAt: { gte: day.start, lt: day.end },
        },
        _count: { _all: true },
      }),
    ]);
    const n = (rows: { status: string; _count: { _all: number } }[], status: QueueEntryStatus) =>
      rows.find((r) => r.status === status)?._count._all ?? 0;
    return {
      waiting: n(active, QueueEntryStatus.WAITING),
      called: n(active, QueueEntryStatus.CALLED),
      inService: n(active, QueueEntryStatus.IN_SERVICE),
      completedToday,
      cancelledToday: n(terminal, QueueEntryStatus.CANCELLED),
      expiredToday: n(terminal, QueueEntryStatus.EXPIRED),
      noShowToday: n(terminal, QueueEntryStatus.NO_SHOW),
    };
  }

  private paymentsRecordedCount(salonId: string, day: { start: Date; end: Date }): Promise<number> {
    return this.prisma.invoicePayment.count({
      where: { salonId, kind: 'PAYMENT', recordedAt: { gte: day.start, lt: day.end } },
    });
  }

  /** Net recorded revenue per salon-local day over the longest window the charts need. */
  private async dailyNet(salonId: string, timeZone: string, from: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ day: string; kind: string; total: Prisma.Decimal }[]>`
      SELECT to_char(("recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text, 'YYYY-MM-DD') AS day,
             "kind"::text AS kind,
             SUM("amount") AS total
        FROM "invoice_payments"
       WHERE "salonId" = ${salonId} AND "recordedAt" >= ${from}
       GROUP BY 1, 2`;
    const map = new Map<string, number>();
    for (const row of rows) {
      const paise = decimalStringToPaise(row.total.toString());
      map.set(row.day, (map.get(row.day) ?? 0) + (row.kind === 'REFUND' ? -paise : paise));
    }
    return map;
  }

  private sumRange(daily: Map<string, number>, fromInclusive: string, toExclusive: string): number {
    let total = 0;
    for (const [day, paise] of daily) if (day >= fromInclusive && day < toExclusive) total += paise;
    return total;
  }

  private compare(currentPaise: number, previousPaise: number): PeriodComparisonDto {
    const current = paiseToRupees(currentPaise);
    const previous = paiseToRupees(previousPaise);
    return { current, previous, changePercent: percentChange(current, previous) };
  }

  private async revenueFor(salon: SalonCtx, today: string): Promise<OwnerRevenueDto> {
    const earliest = firstOfMonth(addMonths(today, -(MONTHLY_POINTS - 1)));
    const prevMonthStart = addMonths(today, -1);
    const from = this.requireWindow(localRange(earliest < prevMonthStart ? earliest : prevMonthStart, addZonedCalendarDays(today, 1), salon.timeZone)).start;
    const tomorrow = addZonedCalendarDays(today, 1);
    const todayWindow = this.requireWindow(localDayWindow(today, salon.timeZone));

    const [daily, anyPayment, estimated, unpaid] = await Promise.all([
      this.dailyNet(salon.id, salon.timeZone, from),
      this.prisma.invoicePayment.count({ where: { salonId: salon.id }, take: 1 }),
      this.prisma.serviceSession.findMany({
        where: { status: ServiceSessionStatus.COMPLETED, endedAt: { gte: todayWindow.start, lt: todayWindow.end }, chair: { salonId: salon.id } },
        select: { service: { select: { price: true } } },
      }),
      this.prisma.$queryRaw<{ cnt: number; due: Prisma.Decimal }[]>`
        SELECT COUNT(*)::int AS cnt, COALESCE(SUM(i."total" - COALESCE(p.net, 0)), 0) AS due
          FROM "invoices" i
          LEFT JOIN (
            SELECT "invoiceId", SUM(CASE WHEN "kind" = 'PAYMENT' THEN "amount" ELSE -"amount" END) AS net
              FROM "invoice_payments" GROUP BY "invoiceId"
          ) p ON p."invoiceId" = i."id"
         WHERE i."salonId" = ${salon.id} AND i."status" = 'ISSUED' AND i."total" - COALESCE(p.net, 0) > 0`,
    ]);

    const point = (date: string, paise: number): RevenuePointDto => ({ date, amount: paiseToRupees(paise) });
    const dailyPoints: RevenuePointDto[] = [];
    for (let i = DAILY_POINTS - 1; i >= 0; i--) {
      const date = addZonedCalendarDays(today, -i);
      dailyPoints.push(point(date, daily.get(date) ?? 0));
    }
    const thisMonday = mondayOf(today);
    const weeklyPoints: RevenuePointDto[] = [];
    for (let i = WEEKLY_POINTS - 1; i >= 0; i--) {
      const start = addZonedCalendarDays(thisMonday, -7 * i);
      weeklyPoints.push(point(start, this.sumRange(daily, start, addZonedCalendarDays(start, 7))));
    }
    const thisMonth = firstOfMonth(today);
    const monthlyPoints: RevenuePointDto[] = [];
    for (let i = MONTHLY_POINTS - 1; i >= 0; i--) {
      const start = addMonths(thisMonth, -i);
      monthlyPoints.push(point(start, this.sumRange(daily, start, addMonths(start, 1))));
    }

    // Like-for-like comparisons: the elapsed part of this week/month against the same elapsed
    // days of the previous one, so a Tuesday is never compared with a complete week.
    const weekElapsed = daysBetween(thisMonday, today) + 1;
    const prevMonday = addZonedCalendarDays(thisMonday, -7);
    const monthElapsed = daysBetween(thisMonth, today) + 1;
    const prevMonthFirst = addMonths(thisMonth, -1);

    return {
      currency: salon.currency,
      hasRecordedPayments: anyPayment > 0,
      daily: dailyPoints,
      weekly: weeklyPoints,
      monthly: monthlyPoints,
      today: this.compare(daily.get(today) ?? 0, daily.get(addZonedCalendarDays(today, -1)) ?? 0),
      thisWeek: this.compare(
        this.sumRange(daily, thisMonday, tomorrow),
        this.sumRange(daily, prevMonday, addZonedCalendarDays(prevMonday, weekElapsed)),
      ),
      thisMonth: this.compare(
        this.sumRange(daily, thisMonth, tomorrow),
        this.sumRange(daily, prevMonthFirst, addZonedCalendarDays(prevMonthFirst, monthElapsed)),
      ),
      estimatedServiceValueToday: paiseToRupees(
        estimated.reduce((sum, s) => sum + decimalStringToPaise(s.service.price.toString()), 0),
      ),
      unpaidInvoiceCount: unpaid[0]?.cnt ?? 0,
      unpaidInvoiceTotal: paiseToRupees(decimalStringToPaise(String(unpaid[0]?.due ?? '0'))),
    };
  }

  private async topServices(salon: SalonCtx, today: string): Promise<OwnerTopServiceDto[]> {
    const window = this.requireWindow(
      localRange(addZonedCalendarDays(today, -(TOP_SERVICE_WINDOW_DAYS - 1)), addZonedCalendarDays(today, 1), salon.timeZone),
    );
    const [sessions, invoices] = await Promise.all([
      this.prisma.serviceSession.findMany({
        where: { status: ServiceSessionStatus.COMPLETED, endedAt: { gte: window.start, lt: window.end }, chair: { salonId: salon.id } },
        select: {
          service: { select: { id: true, name: true, price: true } },
          queueEntry: {
            select: {
              booking: {
                select: {
                  serviceId: true,
                  service: { select: { name: true, durationMinutes: true, price: true } },
                  services: {
                    select: { serviceId: true, serviceName: true, durationMinutes: true, price: true },
                    orderBy: { sortOrder: 'asc' },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.invoice.findMany({
        where: { salonId: salon.id, status: InvoiceStatus.ISSUED, issuedAt: { gte: window.start, lt: window.end } },
        select: { total: true, lines: { select: { serviceId: true, description: true, lineTotal: true } }, payments: { select: { kind: true, amount: true } } },
        take: 2000,
      }),
    ]);

    type Agg = { serviceId: string | null; name: string; count: number; estimatedPaise: number; chargedPaise: number; chargedLines: number; paidPaise: number };
    const byKey = new Map<string, Agg>();
    const slot = (serviceId: string | null, name: string): Agg => {
      const key = serviceId ?? `name:${name.toLowerCase()}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { serviceId, name, count: 0, estimatedPaise: 0, chargedPaise: 0, chargedLines: 0, paidPaise: 0 };
        byKey.set(key, agg);
      }
      return agg;
    };
    let totalCompleted = 0;
    for (const session of sessions) {
      const booking = session.queueEntry.booking;
      const performed = booking
        ? resolveEffectiveBookingServices(booking).map((s) => ({ id: s.serviceId, name: s.serviceName, price: s.price }))
        : [{ id: session.service.id, name: session.service.name, price: session.service.price }];
      for (const item of performed) {
        const agg = slot(item.id, item.name);
        agg.count += 1;
        agg.estimatedPaise += decimalStringToPaise(item.price.toString());
        totalCompleted += 1;
      }
    }
    for (const invoice of invoices) {
      let paid = 0;
      for (const p of invoice.payments) paid += (p.kind === 'REFUND' ? -1 : 1) * decimalStringToPaise(p.amount.toString());
      const fullyPaid = paid >= decimalStringToPaise(invoice.total.toString());
      for (const line of invoice.lines) {
        const agg = slot(line.serviceId, line.description);
        const amount = decimalStringToPaise(line.lineTotal.toString());
        agg.chargedPaise += amount;
        agg.chargedLines += 1;
        // Revenue credited to a service only once its whole invoice has been received.
        if (fullyPaid) agg.paidPaise += amount;
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.count - a.count || b.chargedPaise - a.chargedPaise || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((agg) => ({
        serviceId: agg.serviceId,
        name: agg.name,
        completedCount: agg.count,
        averageChargedAmount: agg.chargedLines > 0 ? paiseToRupees(Math.round(agg.chargedPaise / agg.chargedLines)) : null,
        recordedRevenue: paiseToRupees(agg.paidPaise),
        estimatedValue: paiseToRupees(agg.estimatedPaise),
        popularityPercent: totalCompleted > 0 ? Math.round((agg.count / totalCompleted) * 1000) / 10 : 0,
      }));
  }

  private async staffPerformance(
    salon: SalonCtx,
    staff: { id: string; displayName: string; status: string }[],
    busyIds: Set<string>,
    dayStart: Date,
    today: string,
  ): Promise<OwnerStaffPerformanceDto[]> {
    if (staff.length === 0) return [];
    const window = this.requireWindow(
      localRange(addZonedCalendarDays(today, -(TOP_SERVICE_WINDOW_DAYS - 1)), addZonedCalendarDays(today, 1), salon.timeZone),
    );
    const sessions = await this.prisma.serviceSession.findMany({
      where: { status: ServiceSessionStatus.COMPLETED, endedAt: { gte: window.start, lt: window.end }, chair: { salonId: salon.id } },
      select: { staffId: true, endedAt: true, service: { select: { price: true } } },
    });
    const availability = await Promise.all(
      staff.map((s) =>
        this.reservations.getStaffAvailabilityState(this.prisma, salon.id, s.id, s.status === StaffMemberStatus.ACTIVE),
      ),
    );
    return staff.map((member, i): OwnerStaffPerformanceDto => {
      const mine = sessions.filter((s) => s.staffId === member.id);
      return {
        staffId: member.id,
        displayName: member.displayName,
        status: member.status as StaffMemberStatus,
        availabilityState: busyIds.has(member.id) ? 'IN_SERVICE' : availability[i].availabilityState,
        completedToday: mine.filter((s) => s.endedAt && s.endedAt >= dayStart).length,
        completedLast30Days: mine.length,
        estimatedValueLast30Days: paiseToRupees(mine.reduce((sum, s) => sum + decimalStringToPaise(s.service.price.toString()), 0)),
        rating: null,
      };
    });
  }

  private async schedule(salonId: string, day: { start: Date; end: Date }): Promise<OwnerScheduleItemDto[]> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        salonId,
        slotStart: { gte: day.start, lt: day.end },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT, BookingStatus.COMPLETED, BookingStatus.NO_SHOW] },
      },
      include: {
        service: { select: { name: true, durationMinutes: true, price: true } },
        services: { orderBy: { sortOrder: 'asc' } },
        preferredStaff: { select: { displayName: true } },
        queueEntries: { take: 1, select: { assignedStaff: { select: { displayName: true } } } },
      },
      orderBy: { slotStart: 'asc' },
      take: 60,
    });
    return bookings.map((b) => ({
      id: b.id,
      kind: 'BOOKING' as const,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
      status: b.status as BookingStatus,
      source: b.source === 'IN_SHOP' ? ('IN_SHOP' as const) : ('ONLINE' as const),
      serviceNames: resolveEffectiveBookingServices(b).map((s) => s.serviceName),
      // FastQue stores no customer display name for account holders: never derive one from a
      // phone or e-mail. An in-shop guest has the name the shop typed in.
      customerLabel: b.guestName ?? GUEST_LABEL,
      staffName: b.queueEntries[0]?.assignedStaff?.displayName ?? b.preferredStaff?.displayName ?? null,
    }));
  }

  /** Only when the caller genuinely owns more than one shop; never exposes a shop they do not own. */
  private async branchSummaries(userId: string, currentSalonId: string): Promise<OwnerBranchSummaryDto[]> {
    const owned = await this.prisma.userRole.findMany({
      where: { userId, role: Role.SALON_OWNER, salonId: { not: null } },
      select: { salonId: true },
    });
    const ids = [...new Set(owned.map((r) => r.salonId).filter((id): id is string => id !== null))];
    if (ids.length < 2 || !ids.includes(currentSalonId)) return [];
    const result: OwnerBranchSummaryDto[] = [];
    for (const id of ids) {
      try {
        const salon = await this.loadSalon(id);
        const day = this.requireWindow(localDayWindow(todayLocal(salon.timeZone), salon.timeZone));
        const [queue, revenue] = await Promise.all([
          this.queueSummary(id, day),
          this.dailyNet(id, salon.timeZone, day.start),
        ]);
        result.push({
          salonId: id,
          name: salon.name,
          waiting: queue.waiting,
          inService: queue.inService,
          completedToday: queue.completedToday,
          recordedRevenueToday: paiseToRupees(revenue.get(todayLocal(salon.timeZone)) ?? 0),
          currency: salon.currency,
        });
      } catch {
        // A branch without a usable timezone is simply left out rather than failing the page.
      }
    }
    return result;
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  BookingStatus,
  CANCELLATION_ACTOR_VALUES,
  LedgerReason,
  QueueEntryStatus,
  decimalStringToPaise,
  paiseToRupees,
  type CancellationActorOrUnknown,
  type CancellationAnalyticsDto,
  type CancellationAnalyticsQuery,
  type CancellationBucketDto,
  type CancellationRowDto,
  type OwnerCancellationSummaryDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  resolveSalonTimeZone,
  zonedWallTimeToUtc,
  addZonedCalendarDays,
} from '../common/timezone/timezone';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';
import { todayLocal } from './local-time';

const MAX_ROWS = 200;

/** Zero-filled actor map, so every client always receives every key. */
export function emptyActorCounts(): Record<CancellationActorOrUnknown, number> {
  return Object.fromEntries(
    CANCELLATION_ACTOR_VALUES.map((a) => [a, 0]),
  ) as Record<CancellationActorOrUnknown, number>;
}

/**
 * Who cancelled a booking, from trusted metadata only.
 *
 *  - A booking cancelled after this mission carries `cancelledByActor`, written in the cancelling
 *    transaction from the authenticated actor: used as-is.
 *  - Before attribution existed, the ONLY code path that ever wrote `cancelledById` was the
 *    customer's own cancel (it stored the customer's id), so `cancelledById === customerId` still
 *    proves a customer cancellation. Nothing else can be proven, so everything else is UNKNOWN -
 *    the actor is never guessed from the booking's current status.
 */
export function resolveCancellationActor(row: {
  cancelledByActor: string | null;
  cancelledById: string | null;
  customerId: string | null;
}): CancellationActorOrUnknown {
  if (row.cancelledByActor)
    return row.cancelledByActor as CancellationActorOrUnknown;
  if (
    row.cancelledById &&
    row.customerId &&
    row.cancelledById === row.customerId
  )
    return 'CUSTOMER';
  return 'UNKNOWN';
}

const cancelledSelect = {
  id: true,
  customerId: true,
  cancelledAt: true,
  cancelledById: true,
  cancelledByActor: true,
  cancellationReason: true,
  cancellationChargeAmount: true,
  slotStart: true,
  serviceId: true,
  service: { select: { name: true, durationMinutes: true, price: true } },
  services: {
    select: {
      serviceId: true,
      serviceName: true,
      durationMinutes: true,
      price: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
};

@Injectable()
export class CancellationAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async getAnalytics(
    userId: string,
    salonId: string,
    query: CancellationAnalyticsQuery,
  ): Promise<CancellationAnalyticsDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        currency: true,
        timezone: true,
        city: { select: { countryCode: true } },
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Shop not found.',
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
        'Set your shop’s timezone before viewing analytics.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { from, to } = this.resolveWindow(timeZone, query);

    // Cancellations are windowed by WHEN THEY HAPPENED (most are of upcoming appointments, so the
    // appointment date would hide them). The percentage compares them with the bookings MADE in the
    // same period (expired unpaid holds never became appointments and are left out), i.e. "of the
    // bookings you received this period, how many were cancelled" - a rate the UI labels as such.
    const madeStatuses = [
      BookingStatus.CONFIRMED,
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.COMPLETED,
      BookingStatus.NO_SHOW,
      BookingStatus.CANCELLED,
    ];
    const [totalBookings, cancelled, queueGroups] = await Promise.all([
      this.prisma.booking.count({
        where: {
          salonId,
          createdAt: { gte: from, lt: to },
          status: { in: madeStatuses },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          salonId,
          status: BookingStatus.CANCELLED,
          cancelledAt: { gte: from, lt: to },
        },
        select: cancelledSelect,
        orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.queueEntry.groupBy({
        by: ['status'],
        where: {
          salonId,
          status: {
            in: [
              QueueEntryStatus.CANCELLED,
              QueueEntryStatus.EXPIRED,
              QueueEntryStatus.NO_SHOW,
            ],
          },
          // Standalone Live Queue visits only: an appointment's check-in cancellation is already
          // counted once, as the booking it belongs to.
          bookingId: null,
          updatedAt: { gte: from, lt: to },
        },
        _count: { _all: true },
      }),
    ]);

    const ledger = cancelled.length
      ? await this.prisma.customerLedgerEntry.findMany({
          where: {
            salonId,
            reason: LedgerReason.CANCELLATION_CHARGE,
            bookingId: { in: cancelled.map((c) => c.id) },
          },
          select: { bookingId: true, amount: true, status: true },
        })
      : [];
    const ledgerByBooking = new Map<
      string,
      { amount: number; status: 'OUTSTANDING' | 'SETTLED' | 'WAIVED' }
    >();
    for (const entry of ledger) {
      if (entry.bookingId) {
        ledgerByBooking.set(entry.bookingId, {
          amount: decimalStringToPaise(entry.amount.toString()),
          status: entry.status,
        });
      }
    }

    const enriched = cancelled.map((b) => ({
      b,
      actor: resolveCancellationActor(b),
      services: resolveEffectiveBookingServices(b),
    }));
    const base = query.serviceId
      ? enriched.filter((e) =>
          e.services.some((s) => s.serviceId === query.serviceId),
        )
      : enriched;
    const filtered = query.actor
      ? base.filter((e) => e.actor === query.actor)
      : base;

    const byActor = emptyActorCounts();
    for (const e of base) byActor[e.actor] += 1; // the split ignores the actor filter on purpose

    const byServiceMap = new Map<string, number>();
    const byReasonMap = new Map<string, { label: string; count: number }>();
    for (const e of filtered) {
      for (const name of new Set(e.services.map((s) => s.serviceName))) {
        byServiceMap.set(name, (byServiceMap.get(name) ?? 0) + 1);
      }
      const reason = e.b.cancellationReason?.trim();
      const key = reason ? reason.toLowerCase() : '';
      const entry = byReasonMap.get(key) ?? {
        label: reason || 'No reason given',
        count: 0,
      };
      entry.count += 1;
      byReasonMap.set(key, entry);
    }

    const charges = { charged: 0, waived: 0, outstanding: 0, settled: 0 };
    for (const e of filtered) {
      const row = ledgerByBooking.get(e.b.id);
      if (!row) continue;
      charges.charged += row.amount;
      if (row.status === 'WAIVED') charges.waived += row.amount;
      else if (row.status === 'SETTLED') charges.settled += row.amount;
      else charges.outstanding += row.amount;
    }

    const queueCount = (status: QueueEntryStatus) =>
      queueGroups.find((g) => g.status === status)?._count._all ?? 0;
    const rows: CancellationRowDto[] = filtered.slice(0, MAX_ROWS).map((e) => ({
      bookingId: e.b.id,
      cancelledAt: (e.b.cancelledAt ?? e.b.slotStart).toISOString(),
      slotStart: e.b.slotStart.toISOString(),
      actor: e.actor,
      reason: e.b.cancellationReason,
      serviceNames: e.services.map((s) => s.serviceName),
      chargeAmount:
        e.b.cancellationChargeAmount !== null
          ? Number(e.b.cancellationChargeAmount)
          : null,
      chargeStatus: ledgerByBooking.get(e.b.id)?.status ?? null,
    }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      currency:
        salon.currency ?? (salon.city.countryCode === 'IN' ? 'INR' : null),
      totalCancellations: filtered.length,
      totalBookings,
      cancellationRatePercent:
        totalBookings > 0
          ? Math.round((filtered.length / totalBookings) * 1000) / 10
          : null,
      byActor,
      byService: toBuckets(
        [...byServiceMap.entries()].map(([label, count]) => ({
          key: label,
          label,
          count,
        })),
      ),
      byReason: toBuckets(
        [...byReasonMap.entries()].map(([key, v]) => ({
          key: key || 'none',
          label: v.label,
          count: v.count,
        })),
      ),
      charges: {
        charged: paiseToRupees(charges.charged),
        waived: paiseToRupees(charges.waived),
        outstanding: paiseToRupees(charges.outstanding),
        settled: paiseToRupees(charges.settled),
      },
      rows,
      liveQueue: {
        cancelled: queueCount(QueueEntryStatus.CANCELLED),
        expired: queueCount(QueueEntryStatus.EXPIRED),
        noShow: queueCount(QueueEntryStatus.NO_SHOW),
      },
      unattributedCount: base.filter((e) => e.actor === 'UNKNOWN').length,
    };
  }

  /** A compact figure for the dashboard overview: the last `windowDays` salon-local days. */
  async summary(
    salonId: string,
    timeZone: string,
    windowDays: number,
  ): Promise<OwnerCancellationSummaryDto> {
    const today = todayLocal(timeZone);
    const from = zonedWallTimeToUtc(
      addZonedCalendarDays(today, -(windowDays - 1)),
      '00:00',
      timeZone,
    )!;
    const to = zonedWallTimeToUtc(
      addZonedCalendarDays(today, 1),
      '00:00',
      timeZone,
    )!;
    const [total, rows] = await Promise.all([
      this.prisma.booking.count({
        where: {
          salonId,
          createdAt: { gte: from, lt: to },
          status: {
            in: [
              BookingStatus.CONFIRMED,
              BookingStatus.PENDING_PAYMENT,
              BookingStatus.COMPLETED,
              BookingStatus.NO_SHOW,
              BookingStatus.CANCELLED,
            ],
          },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          salonId,
          status: BookingStatus.CANCELLED,
          cancelledAt: { gte: from, lt: to },
        },
        select: {
          customerId: true,
          cancelledById: true,
          cancelledByActor: true,
        },
      }),
    ]);
    const byActor = emptyActorCounts();
    for (const r of rows) byActor[resolveCancellationActor(r)] += 1;
    return {
      windowDays,
      total: rows.length,
      ratePercent:
        total > 0 ? Math.round((rows.length / total) * 1000) / 10 : null,
      byActor,
    };
  }

  private resolveWindow(
    timeZone: string,
    query: CancellationAnalyticsQuery,
  ): { from: Date; to: Date } {
    if (query.from && query.to) {
      const from = new Date(query.from);
      const to = new Date(query.to);
      if (!(from < to)) {
        throw new AppException(
          BookingErrorCode.SLOT_IN_PAST,
          'Provide a valid from/to range (from must be before to).',
          HttpStatus.BAD_REQUEST,
        );
      }
      return { from, to };
    }
    const days = query.range === '7d' ? 7 : query.range === '90d' ? 90 : 30;
    const today = todayLocal(timeZone);
    const from = zonedWallTimeToUtc(
      addZonedCalendarDays(today, -(days - 1)),
      '00:00',
      timeZone,
    );
    const to = zonedWallTimeToUtc(
      addZonedCalendarDays(today, 1),
      '00:00',
      timeZone,
    );
    if (!from || !to) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Could not resolve today in this shop’s timezone.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { from, to };
  }
}

function toBuckets(
  items: { key: string; label: string; count: number }[],
): CancellationBucketDto[] {
  return items
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingStatus,
  QueueEntrySource,
  QueueEntryStatus,
  SalonStatus,
  decimalStringToPaise,
  type AdminShopStatusDto,
  type AdminShopStatusRowDto,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addZonedCalendarDays,
  resolveSalonTimeZone,
  utcToZonedDateStr,
  zonedWallTimeToUtc,
} from '../../common/timezone/timezone';
import { ADMIN_SHOP_ACTIVITY_TIME_ZONE } from '../admin-shop-activity.service';
import { scheduleStatusAt } from './shop-schedule';

const TZ = ADMIN_SHOP_ACTIVITY_TIME_ZONE;
/** Proposed default: open and accepting for this long with nothing new → "open, no bookings". */
export const QUIET_THRESHOLD_HOURS = 4;
const HOUR_MS = 3_600_000;

/**
 * Live shop status for the admin Operations pages. Counts only plus shop names — no contact details.
 * Scheduled status, the owner's temporary closure and "accepting bookings" are reported separately
 * and never merged; merchant-app presence is not recorded, so it is always null.
 */
@Injectable()
export class AdminShopStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(now: Date = new Date()): Promise<AdminShopStatusDto> {
    const today = utcToZonedDateStr(now, TZ);
    const dayStart = zonedWallTimeToUtc(today, '00:00', TZ)!;
    const dayEnd = zonedWallTimeToUtc(
      addZonedCalendarDays(today, 1),
      '00:00',
      TZ,
    )!;

    const [
      salons,
      created,
      completedAppts,
      walkIns,
      values,
      latestBooking,
      latestWalkIn,
      hourlyRows,
    ] = await Promise.all([
      this.prisma.salon.findMany({
        select: {
          id: true,
          publicId: true,
          name: true,
          status: true,
          timezone: true,
          isClosedForToday: true,
          city: { select: { name: true, countryCode: true } },
          operatingHours: {
            select: {
              dayOfWeek: true,
              openTime: true,
              closeTime: true,
              isClosed: true,
            },
          },
        },
      }),
      this.prisma.booking.groupBy({
        by: ['salonId'],
        where: { createdAt: { gte: dayStart, lt: dayEnd } },
        _count: { _all: true },
      }),
      this.prisma.booking.groupBy({
        by: ['salonId'],
        where: {
          status: BookingStatus.COMPLETED,
          slotStart: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
      }),
      this.prisma.queueEntry.groupBy({
        by: ['salonId'],
        where: {
          source: QueueEntrySource.WALK_IN,
          status: QueueEntryStatus.COMPLETED,
          joinedAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        { salonId: string; total: Prisma.Decimal | null }[]
      >`
          SELECT x."salonId" AS "salonId", SUM(x.value) AS total FROM (
            SELECT b."salonId", COALESCE(items.total, sv."price") - b."onlineBookingDiscountAmount" AS value
              FROM "bookings" b
              JOIN "services" sv ON sv."id" = b."serviceId"
              LEFT JOIN (SELECT "bookingId", SUM("price") AS total FROM "booking_services" GROUP BY "bookingId") items
                ON items."bookingId" = b."id"
             WHERE b."status" = 'COMPLETED' AND b."slotStart" >= ${dayStart} AND b."slotStart" < ${dayEnd}
            UNION ALL
            SELECT q."salonId", sv."price" AS value
              FROM "queue_entries" q JOIN "services" sv ON sv."id" = q."serviceId"
             WHERE q."source" = 'WALK_IN' AND q."status" = 'COMPLETED'
               AND q."joinedAt" >= ${dayStart} AND q."joinedAt" < ${dayEnd}
          ) x GROUP BY 1`,
      // Most recent new booking / walk-in in the last 24h, for the "open but quiet" check.
      this.prisma.booking.groupBy({
        by: ['salonId'],
        where: { createdAt: { gte: new Date(now.getTime() - 24 * HOUR_MS) } },
        _max: { createdAt: true },
      }),
      this.prisma.queueEntry.groupBy({
        by: ['salonId'],
        where: {
          source: QueueEntrySource.WALK_IN,
          joinedAt: { gte: new Date(now.getTime() - 24 * HOUR_MS) },
        },
        _max: { joinedAt: true },
      }),
      this.prisma.$queryRaw<{ hour: number; kind: string; n: number }[]>`
          SELECT EXTRACT(HOUR FROM ("slotStart" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}::text)::int AS hour,
                 'appointments' AS kind, COUNT(*)::int AS n
            FROM "bookings"
           WHERE "slotStart" >= ${dayStart} AND "slotStart" < ${dayEnd} AND "status" <> 'CANCELLED'
           GROUP BY 1
          UNION ALL
          SELECT EXTRACT(HOUR FROM ("joinedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}::text)::int AS hour,
                 'walkIns' AS kind, COUNT(*)::int AS n
            FROM "queue_entries"
           WHERE "source" = 'WALK_IN' AND "joinedAt" >= ${dayStart} AND "joinedAt" < ${dayEnd}
           GROUP BY 1`,
    ]);

    const countMap = (rows: { salonId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.salonId, r._count._all]));
    const createdBy = countMap(created);
    const apptsBy = countMap(completedAppts);
    const walkInsBy = countMap(walkIns);
    const valueBy = new Map(
      values.map((r) => [
        r.salonId,
        decimalStringToPaise((r.total ?? 0).toString()),
      ]),
    );
    const lastActivity = new Map<string, Date>();
    for (const r of latestBooking)
      if (r._max.createdAt) lastActivity.set(r.salonId, r._max.createdAt);
    for (const r of latestWalkIn) {
      const t = r._max.joinedAt;
      if (
        t &&
        (!lastActivity.has(r.salonId) || t > lastActivity.get(r.salonId)!)
      )
        lastActivity.set(r.salonId, t);
    }

    const counts: AdminShopStatusDto['counts'] = {
      registered: salons.length,
      eligible: 0,
      scheduledOpen: 0,
      scheduledClosed: 0,
      unknownSchedule: 0,
      temporarilyClosed: 0,
      acceptingBookings: 0,
      openingWithinHour: 0,
      closingWithinHour: 0,
      openNoBookings: 0,
      merchantOnline: null,
    };

    const shops: AdminShopStatusRowDto[] = salons.map((salon) => {
      const timeZone = resolveSalonTimeZone({
        timezone: salon.timezone,
        countryCode: salon.city.countryCode,
      });
      const schedule = scheduleStatusAt(salon.operatingHours, timeZone, now);
      const active = salon.status === SalonStatus.ACTIVE;
      const accepting = active && !salon.isClosedForToday;

      // Status counts describe operational (ACTIVE) shops; pending/suspended shops are listed but
      // never counted as open or closed for business.
      if (active) {
        counts.eligible += 1;
        if (schedule.state === 'OPEN') counts.scheduledOpen += 1;
        else if (schedule.state === 'CLOSED') counts.scheduledClosed += 1;
        else counts.unknownSchedule += 1;
        if (salon.isClosedForToday) counts.temporarilyClosed += 1;
        if (accepting) counts.acceptingBookings += 1;
        if (
          schedule.opensAt &&
          schedule.opensAt.getTime() - now.getTime() <= HOUR_MS
        )
          counts.openingWithinHour += 1;
        if (
          schedule.closesAt &&
          schedule.closesAt.getTime() - now.getTime() <= HOUR_MS
        )
          counts.closingWithinHour += 1;
      }

      let quietSince: string | null = null;
      if (accepting && schedule.state === 'OPEN' && schedule.openedAt) {
        const last = lastActivity.get(salon.id);
        const since =
          last && last > schedule.openedAt ? last : schedule.openedAt;
        if (
          now.getTime() - since.getTime() >=
          QUIET_THRESHOLD_HOURS * HOUR_MS
        ) {
          quietSince = since.toISOString();
          counts.openNoBookings += 1;
        }
      }

      return {
        id: salon.id,
        publicId: salon.publicId,
        name: salon.name,
        city: salon.city.name,
        status: salon.status,
        timeZone,
        scheduled: schedule.state,
        todayHours: schedule.todayLabel,
        opensAt: schedule.opensAt?.toISOString() ?? null,
        closesAt: schedule.closesAt?.toISOString() ?? null,
        temporarilyClosed: salon.isClosedForToday,
        acceptingBookings: accepting,
        merchantOnline: null,
        todayBookingsCreated: createdBy.get(salon.id) ?? 0,
        todayVisitsCompleted:
          (apptsBy.get(salon.id) ?? 0) + (walkInsBy.get(salon.id) ?? 0),
        todayServiceValuePaise: valueBy.get(salon.id) ?? 0,
        quietSince,
      };
    });

    // Hour-by-hour scheduled-open count (ACTIVE shops, mid-hour IST) against today's demand.
    const hourly = Array.from({ length: 24 }, (_, hour) => {
      const at = new Date(dayStart.getTime() + hour * HOUR_MS + 30 * 60_000);
      let scheduledOpen = 0;
      for (const salon of salons) {
        if (salon.status !== SalonStatus.ACTIVE) continue;
        const timeZone = resolveSalonTimeZone({
          timezone: salon.timezone,
          countryCode: salon.city.countryCode,
        });
        if (
          scheduleStatusAt(salon.operatingHours, timeZone, at).state === 'OPEN'
        )
          scheduledOpen += 1;
      }
      return { hour, scheduledOpen, appointments: 0, walkIns: 0 };
    });
    for (const row of hourlyRows) {
      const bucket = hourly[row.hour];
      if (!bucket) continue;
      if (row.kind === 'appointments') bucket.appointments += row.n;
      else bucket.walkIns += row.n;
    }

    const order = { OPEN: 0, UNKNOWN: 1, CLOSED: 2 } as const;
    shops.sort(
      (a, b) =>
        Number(b.status === SalonStatus.ACTIVE) -
          Number(a.status === SalonStatus.ACTIVE) ||
        order[a.scheduled] - order[b.scheduled] ||
        a.name.localeCompare(b.name),
    );

    return {
      generatedAt: now.toISOString(),
      timeZone: TZ,
      quietThresholdHours: QUIET_THRESHOLD_HOURS,
      counts,
      hourly,
      shops,
    };
  }
}

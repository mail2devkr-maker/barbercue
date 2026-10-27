import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  decimalStringToPaise,
  type AdminAnalyticsRangeQuery,
  type AdminStaffOverviewDto,
  type AdminStaffRowDto,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addZonedCalendarDays,
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
} from '../../common/timezone/timezone';
import { localRange } from '../../owner-ops/local-time';
import { ADMIN_SHOP_ACTIVITY_TIME_ZONE } from '../admin-shop-activity.service';
import { ratePercent } from './executive-metrics';

const TZ = ADMIN_SHOP_ACTIVITY_TIME_ZONE;
const STAFF_LIMIT = 200;

interface DayHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

/** Working minutes of one configured day (close at or before open runs past midnight). */
export function workingMinutes(entry: DayHours | undefined): number {
  if (!entry || entry.isClosed) return 0;
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const open = toMin(entry.openTime);
  const close = toMin(entry.closeTime);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return 0;
  return close > open ? close - open : 24 * 60 - open + close;
}

/**
 * Configured working minutes over [from, to] (IST dates), counting only days up to today — future
 * days have not happened, so they must not dilute utilisation. Null when no hours are configured.
 */
export function scheduledMinutes(
  hours: readonly DayHours[],
  from: string,
  to: string,
  today: string,
): number | null {
  if (hours.length === 0) return null;
  const last = to < today ? to : today;
  let total = 0;
  for (let d = from; d <= last; d = addZonedCalendarDays(d, 1)) {
    total += workingMinutes(
      hours.find((h) => h.dayOfWeek === zonedDateToDayOfWeek(d)),
    );
  }
  return total;
}

/**
 * Salon staff analytics (barbers, stylists — not FastQue employees). Read-only; no phone, email or
 * user account fields are selected. Each service session has exactly one staff member, so time and
 * value are attributed once and never double-counted across staff.
 */
@Injectable()
export class AdminStaffAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(
    query: AdminAnalyticsRangeQuery,
    now: Date = new Date(),
  ): Promise<AdminStaffOverviewDto> {
    return (await this.build(query, STAFF_LIMIT, now)).dto;
  }

  private async build(
    query: AdminAnalyticsRangeQuery,
    limit: number,
    now: Date = new Date(),
  ) {
    const range = localRange(query.from, addZonedCalendarDays(query.to, 1), TZ);
    if (!range) throw new Error('Could not resolve the IST date range');
    const { start, end } = range;
    const today = utcToZonedDateStr(now, TZ);

    const [staff, serving, sessions] = await Promise.all([
      this.prisma.salonStaff.findMany({
        select: {
          id: true,
          displayName: true,
          roleInSalon: true,
          status: true,
          accessRevokedAt: true,
          salon: {
            select: {
              id: true,
              name: true,
              publicId: true,
              city: { select: { name: true } },
            },
          },
          workingHours: {
            select: {
              dayOfWeek: true,
              openTime: true,
              closeTime: true,
              isClosed: true,
            },
          },
        },
      }),
      this.prisma.serviceSession.groupBy({
        by: ['staffId'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        {
          staffId: string;
          n: number;
          services: number;
          minutes: number | null;
          value: Prisma.Decimal | null;
        }[]
      >`
        SELECT ss."staffId" AS "staffId", COUNT(*)::int AS n, COUNT(DISTINCT ss."serviceId")::int AS services,
               ROUND(SUM(EXTRACT(EPOCH FROM (ss."endedAt" - ss."startedAt")) / 60))::int AS minutes,
               SUM(sv."price") AS value
          FROM "service_sessions" ss JOIN "services" sv ON sv."id" = ss."serviceId"
         WHERE ss."status" = 'COMPLETED' AND ss."endedAt" >= ${start} AND ss."endedAt" < ${end}
         GROUP BY 1`,
    ]);

    const servingSet = new Set(serving.map((s) => s.staffId));
    const sessionBy = new Map(sessions.map((s) => [s.staffId, s]));
    const todayDow = zonedDateToDayOfWeek(today);

    const rows = staff.map((member) => {
      const s = sessionBy.get(member.id);
      const minutes = s?.minutes ?? 0;
      const completed = s?.n ?? 0;
      const scheduled = scheduledMinutes(
        member.workingHours,
        query.from,
        query.to,
        today,
      );
      const row: AdminStaffRowDto = {
        id: member.id,
        displayName: member.displayName,
        salonName: member.salon.name,
        salonPublicId: member.salon.publicId,
        city: member.salon.city.name,
        role: member.roleInSalon,
        status: member.accessRevokedAt ? 'REVOKED' : member.status,
        servingNow: servingSet.has(member.id),
        completedServices: completed,
        distinctServices: s?.services ?? 0,
        serviceMinutes: minutes,
        averageServiceMinutes: completed
          ? Math.round((minutes / completed) * 10) / 10
          : null,
        serviceValuePaise: decimalStringToPaise((s?.value ?? 0).toString()),
        scheduledMinutes: scheduled,
        utilizationPercent: scheduled ? ratePercent(minutes, scheduled) : null,
      };
      const active = member.status === 'ACTIVE' && !member.accessRevokedAt;
      const scheduledToday =
        active &&
        workingMinutes(
          member.workingHours.find((h) => h.dayOfWeek === todayDow),
        ) > 0;
      return { row, active, scheduledToday, salonId: member.salon.id };
    });

    const activeRows = rows.filter((r) => r.active);
    const shops = new Set(activeRows.map((r) => r.salonId));
    const completed = rows.reduce((t, r) => t + r.row.completedServices, 0);
    const minutes = rows.reduce((t, r) => t + r.row.serviceMinutes, 0);
    const withHours = rows.filter((r) => r.row.scheduledMinutes !== null);
    const scheduledTotal = withHours.reduce(
      (t, r) => t + (r.row.scheduledMinutes ?? 0),
      0,
    );
    const minutesWithHours = withHours.reduce(
      (t, r) => t + r.row.serviceMinutes,
      0,
    );

    const ordered = rows
      .map((r) => r.row)
      .sort(
        (a, b) =>
          b.completedServices - a.completedServices ||
          b.serviceMinutes - a.serviceMinutes ||
          a.displayName.localeCompare(b.displayName),
      );

    const dto: AdminStaffOverviewDto = {
      from: query.from,
      to: query.to,
      timeZone: TZ,
      generatedAt: now.toISOString(),
      kpis: {
        registeredStaff: staff.length,
        activeStaff: activeRows.length,
        shopsWithStaff: shops.size,
        averageStaffPerShop: shops.size
          ? Math.round((activeRows.length / shops.size) * 10) / 10
          : null,
        scheduledToday: rows.filter((r) => r.scheduledToday).length,
        servingNow: servingSet.size,
        completedServices: completed,
        serviceHours: Math.round((minutes / 60) * 10) / 10,
        averageServiceMinutes: completed
          ? Math.round((minutes / completed) * 10) / 10
          : null,
        serviceValuePaise: rows.reduce(
          (t, r) => t + r.row.serviceValuePaise,
          0,
        ),
        utilizationPercent: scheduledTotal
          ? ratePercent(minutesWithHours, scheduledTotal)
          : null,
      },
      staff: ordered.slice(0, limit),
      staffTotal: ordered.length,
      staffLimit: limit,
    };
    return { dto, ids: ordered.slice(0, limit).map((r) => r.id) };
  }

  /** Rows for the staff exports; contact details only for the separately permitted contact export. */
  async exportRows(query: AdminAnalyticsRangeQuery, withContact: boolean) {
    const { dto, ids } = await this.build(query, Number.MAX_SAFE_INTEGER);
    if (!withContact) return { overview: dto, contacts: null };
    const members = await this.prisma.salonStaff.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        user: { select: { phone: true, email: true, deletedAt: true } },
      },
    });
    return {
      overview: dto,
      contacts: new Map(
        members.filter((m) => !m.user.deletedAt).map((m) => [m.id, m.user]),
      ),
    };
  }
}

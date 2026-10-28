import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import {
  BookingStatus,
  decimalStringToPaise,
  type AdminAnalyticsRangeQuery,
  type AdminCustomerOverviewDto,
  type AdminCustomerRowDto,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { addZonedCalendarDays } from '../../common/timezone/timezone';
import { localRange } from '../../owner-ops/local-time';
import { ADMIN_SHOP_ACTIVITY_TIME_ZONE } from '../admin-shop-activity.service';
import { averagePaise, ratePercent } from './executive-metrics';

const TZ = ADMIN_SHOP_ACTIVITY_TIME_ZONE;
const CUSTOMER_LIMIT = 200;

const SOURCE_LABELS: Record<string, string> = {
  APP: 'Customer app',
  WEB: 'Website',
  IN_SHOP: 'Entered by the shop',
  WALK_IN: 'Walk-in appointment',
  QUEUE_WALK_IN: 'Live queue walk-in',
};

/**
 * A stable, non-reversible customer reference for analytics screens and the basic export. The same
 * customer always gets the same ID, but the account ID (and so the contact details) cannot be
 * recovered from it.
 */
export function maskCustomerId(userId: string): string {
  return `C-${createHash('sha256').update(`fastque-customer:${userId}`).digest('hex').slice(0, 10).toUpperCase()}`;
}

interface CustomerAggregate {
  customerId: string;
  first: Date | null;
  last: Date | null;
  visits: number;
  value: number;
}

/**
 * Admin customer analytics. Account customers only (a guest visit has no stable identity to count
 * across visits). No phone, email or name is ever selected here — contact exports live in
 * AdminDataExportService behind their own route and role.
 */
@Injectable()
export class AdminCustomerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private window(query: AdminAnalyticsRangeQuery) {
    const range = localRange(query.from, addZonedCalendarDays(query.to, 1), TZ);
    if (!range) throw new Error('Could not resolve the IST date range');
    return range;
  }

  /** Completed visits (appointments by appointment time, walk-ins by join time) per account customer. */
  private async aggregates(start: Date, end: Date) {
    return this.prisma.$queryRaw<
      {
        customerId: string;
        first: Date | null;
        last: Date | null;
        visits: number;
        value: Prisma.Decimal | null;
      }[]
    >`
      WITH visits AS (
        SELECT b."customerId" AS c, b."slotStart" AS t,
               COALESCE(items.total, sv."price") - b."onlineBookingDiscountAmount" AS value
          FROM "bookings" b
          JOIN "services" sv ON sv."id" = b."serviceId"
          LEFT JOIN (SELECT "bookingId", SUM("price") AS total FROM "booking_services" GROUP BY "bookingId") items
            ON items."bookingId" = b."id"
         WHERE b."status" = 'COMPLETED' AND b."customerId" IS NOT NULL AND b."slotStart" < ${end}
        UNION ALL
        SELECT q."customerId" AS c, q."joinedAt" AS t, sv."price" AS value
          FROM "queue_entries" q LEFT JOIN "services" sv ON sv."id" = q."serviceId"
         WHERE q."source" = 'WALK_IN' AND q."status" = 'COMPLETED' AND q."customerId" IS NOT NULL
           AND q."joinedAt" < ${end}
      )
      SELECT c AS "customerId", MIN(t) AS first, MAX(t) AS last,
             (COUNT(*) FILTER (WHERE t >= ${start}))::int AS visits,
             SUM(value) FILTER (WHERE t >= ${start}) AS value
        FROM visits GROUP BY c`;
  }

  async getOverview(
    query: AdminAnalyticsRangeQuery,
    now: Date = new Date(),
  ): Promise<AdminCustomerOverviewDto> {
    return (await this.build(query, CUSTOMER_LIMIT, now)).dto;
  }

  /** The dto plus each listed row's internal account ID (never sent to the client). */
  private async build(
    query: AdminAnalyticsRangeQuery,
    limit: number,
    now: Date = new Date(),
  ) {
    const { start, end } = this.window(query);
    const [rows, outcomes, bookingSources, queueWalkIns, categoryRows] =
      await Promise.all([
        this.aggregates(start, end),
        this.prisma.booking.groupBy({
          by: ['customerId', 'status'],
          where: {
            customerId: { not: null },
            slotStart: { gte: start, lt: end },
            status: {
              in: [
                BookingStatus.COMPLETED,
                BookingStatus.CANCELLED,
                BookingStatus.NO_SHOW,
              ],
            },
          },
          _count: { _all: true },
        }),
        this.prisma.booking.groupBy({
          by: ['source'],
          where: {
            customerId: { not: null },
            createdAt: { gte: start, lt: end },
          },
          _count: { _all: true },
        }),
        this.prisma.queueEntry.count({
          where: {
            source: 'WALK_IN',
            customerId: { not: null },
            joinedAt: { gte: start, lt: end },
          },
        }),
        this.prisma.$queryRaw<
          { customerId: string; category: string; n: number }[]
        >`
        SELECT v.c AS "customerId", v.cat AS category, COUNT(*)::int AS n FROM (
          SELECT b."customerId" AS c, COALESCE(NULLIF(TRIM(sv."category"), ''), 'Uncategorised') AS cat
            FROM "bookings" b JOIN "services" sv ON sv."id" = b."serviceId"
           WHERE b."status" = 'COMPLETED' AND b."customerId" IS NOT NULL
             AND b."slotStart" >= ${start} AND b."slotStart" < ${end}
          UNION ALL
          SELECT q."customerId", COALESCE(NULLIF(TRIM(sv."category"), ''), 'Uncategorised')
            FROM "queue_entries" q LEFT JOIN "services" sv ON sv."id" = q."serviceId"
           WHERE q."source" = 'WALK_IN' AND q."status" = 'COMPLETED' AND q."customerId" IS NOT NULL
             AND q."joinedAt" >= ${start} AND q."joinedAt" < ${end}
        ) v GROUP BY 1, 2`,
      ]);

    const customers: CustomerAggregate[] = rows.map((r) => ({
      customerId: r.customerId,
      first: r.first,
      last: r.last,
      visits: r.visits,
      value: decimalStringToPaise((r.value ?? 0).toString()),
    }));

    const outcomeBy = new Map<
      string,
      { cancelled: number; noShow: number; completed: number }
    >();
    let completedAppts = 0;
    let noShows = 0;
    for (const g of outcomes) {
      const id = g.customerId!;
      const row = outcomeBy.get(id) ?? {
        cancelled: 0,
        noShow: 0,
        completed: 0,
      };
      if (g.status === BookingStatus.CANCELLED) row.cancelled += g._count._all;
      else if (g.status === BookingStatus.NO_SHOW) {
        row.noShow += g._count._all;
        noShows += g._count._all;
      } else {
        row.completed += g._count._all;
        completedAppts += g._count._all;
      }
      outcomeBy.set(id, row);
    }

    const preferred = new Map<string, { category: string; n: number }>();
    const categoryTotals = new Map<string, number>();
    for (const r of categoryRows) {
      categoryTotals.set(
        r.category,
        (categoryTotals.get(r.category) ?? 0) + r.n,
      );
      const best = preferred.get(r.customerId);
      if (
        !best ||
        r.n > best.n ||
        (r.n === best.n && r.category < best.category)
      ) {
        preferred.set(r.customerId, { category: r.category, n: r.n });
      }
    }

    const active = customers.filter((c) => c.visits > 0);
    const isNew = (c: CustomerAggregate) =>
      c.first !== null && c.first >= start;
    const newCount = active.filter(isNew).length;
    const visits = active.reduce((s, c) => s + c.visits, 0);
    const value = active.reduce((s, c) => s + c.value, 0);

    // Customers with any appointment outcome in the period also appear, even with no completed visit.
    const listed = new Map(customers.map((c) => [c.customerId, c]));
    for (const id of outcomeBy.keys()) {
      if (!listed.has(id))
        listed.set(id, {
          customerId: id,
          first: null,
          last: null,
          visits: 0,
          value: 0,
        });
    }
    const ordered = [...listed.values()]
      .filter((c) => c.visits > 0 || outcomeBy.has(c.customerId))
      .map((c) => ({
        customerId: c.customerId,
        maskedId: maskCustomerId(c.customerId),
        firstVisitAt: c.first?.toISOString() ?? null,
        lastVisitAt: c.last?.toISOString() ?? null,
        completedVisits: c.visits,
        cancelled: outcomeBy.get(c.customerId)?.cancelled ?? 0,
        noShow: outcomeBy.get(c.customerId)?.noShow ?? 0,
        serviceValuePaise: c.value,
        preferredCategory: preferred.get(c.customerId)?.category ?? null,
      }))
      .sort(
        (a, b) =>
          b.completedVisits - a.completedVisits ||
          b.serviceValuePaise - a.serviceValuePaise ||
          a.maskedId.localeCompare(b.maskedId),
      )
      .slice(0, limit);
    // The internal account ID stays on the server; the client only ever sees the masked ID.
    const table: AdminCustomerRowDto[] = ordered.map((row) => ({
      maskedId: row.maskedId,
      firstVisitAt: row.firstVisitAt,
      lastVisitAt: row.lastVisitAt,
      completedVisits: row.completedVisits,
      cancelled: row.cancelled,
      noShow: row.noShow,
      serviceValuePaise: row.serviceValuePaise,
      preferredCategory: row.preferredCategory,
    }));

    const sources = [
      ...bookingSources.map((g) => ({
        source: g.source,
        label: SOURCE_LABELS[g.source] ?? g.source,
        count: g._count._all,
      })),
      {
        source: 'QUEUE_WALK_IN',
        label: SOURCE_LABELS.QUEUE_WALK_IN,
        count: queueWalkIns,
      },
    ]
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);

    const dto: AdminCustomerOverviewDto = {
      from: query.from,
      to: query.to,
      timeZone: TZ,
      generatedAt: now.toISOString(),
      kpis: {
        customersEver: customers.length,
        activeCustomers: active.length,
        newCustomers: newCount,
        returningCustomers: active.length - newCount,
        completedVisits: visits,
        averageVisitsPerActive: active.length
          ? Math.round((visits / active.length) * 10) / 10
          : null,
        averageVisitValuePaise: averagePaise(value, visits),
        repeatRatePercent: ratePercent(
          active.filter((c) => c.visits >= 2).length,
          active.length,
        ),
        noShowRatePercent: ratePercent(noShows, completedAppts + noShows),
      },
      sources,
      categories: [...categoryTotals.entries()]
        .map(([category, n]) => ({ category, visits: n }))
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 10),
      customers: table,
      customersTotal: listed.size,
      customersLimit: limit,
    };
    return { dto, ids: ordered.map((r) => r.customerId) };
  }

  /**
   * Rows for the customer exports. `withContact` adds phone/email/registration — only ever called
   * from the contact-export route, which has its own narrower role check.
   */
  async exportRows(query: AdminAnalyticsRangeQuery, withContact: boolean) {
    // Exports are not capped at the screen's row limit.
    const { dto, ids } = await this.build(query, Number.MAX_SAFE_INTEGER);
    if (!withContact) return { overview: dto, contacts: null };
    // Deleted accounts never appear with contact details.
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, phone: true, email: true, createdAt: true },
    });
    return {
      overview: dto,
      contacts: new Map(users.map((u) => [maskCustomerId(u.id), u])),
    };
  }
}

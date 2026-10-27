import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  decimalStringToPaise,
  type AdminMetricUnit,
  type AdminTimeseriesDto,
  type AdminTimeseriesGranularity,
  type AdminTimeseriesMetric,
  type AdminTimeseriesQuery,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addZonedCalendarDays,
  zonedDateToDayOfWeek,
} from '../../common/timezone/timezone';
import { localRange } from '../../owner-ops/local-time';
import { ADMIN_SHOP_ACTIVITY_TIME_ZONE } from '../admin-shop-activity.service';
import { previousRange, ratePercent } from './executive-metrics';

const TZ = ADMIN_SHOP_ACTIVITY_TIME_ZONE;

/** Label, unit and definition basis for every chartable KPI (docs/admin-dashboard-2.0/PLAN.md §4). */
export const METRIC_INFO: Record<
  AdminTimeseriesMetric,
  { label: string; unit: AdminMetricUnit }
> = {
  appointmentsBooked: { label: 'Appointments booked', unit: 'count' },
  appointmentsCompleted: { label: 'Completed appointments', unit: 'count' },
  walkInsServed: { label: 'Walk-ins served', unit: 'count' },
  completedVisits: { label: 'Completed visits', unit: 'count' },
  cancelled: { label: 'Cancelled appointments', unit: 'count' },
  noShow: { label: 'No-shows', unit: 'count' },
  cancellationRatePercent: { label: 'Cancellation rate', unit: 'percent' },
  completedServiceValuePaise: { label: 'Completed service value', unit: 'inr' },
  serviceHours: { label: 'Service hours', unit: 'hours' },
  newSalons: { label: 'New salons', unit: 'count' },
  uniqueCustomers: { label: 'Unique customers served', unit: 'count' },
  newCustomers: { label: 'New customers', unit: 'count' },
  averageWaitMinutes: { label: 'Average wait (queue)', unit: 'minutes' },
};

/** The bucket (IST date) a calendar date falls in: itself, its Monday, or the 1st of its month. */
export function bucketOf(
  date: string,
  granularity: AdminTimeseriesGranularity,
): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  const dow = zonedDateToDayOfWeek(date); // 0 = Sunday
  return addZonedCalendarDays(date, -((dow + 6) % 7));
}

export function bucketsFor(
  from: string,
  to: string,
  granularity: AdminTimeseriesGranularity,
): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addZonedCalendarDays(d, 1)) {
    const b = bucketOf(d, granularity);
    if (out[out.length - 1] !== b) out.push(b);
  }
  return out;
}

type Counts = Map<string, number>;

/**
 * Chart-builder read model. Read-only aggregates; no customer contact data is selected.
 * `null` in a series means "nothing to measure in that bucket", never zero.
 */
@Injectable()
export class AdminTimeseriesService {
  constructor(private readonly prisma: PrismaService) {}

  async getSeries(
    query: AdminTimeseriesQuery,
    now: Date = new Date(),
  ): Promise<AdminTimeseriesDto> {
    const metrics = query.metrics;
    const buckets = bucketsFor(query.from, query.to, query.granularity);
    const current = await this.compute(
      metrics,
      query.from,
      query.to,
      query.granularity,
      buckets,
    );

    let previous: Map<AdminTimeseriesMetric, Array<number | null>> | null =
      null;
    let prev: { from: string; to: string } | null = null;
    if (query.compare === 'previous') {
      prev = previousRange(query.from, query.to, addZonedCalendarDays);
      const prevBuckets = bucketsFor(prev.from, prev.to, query.granularity);
      const values = await this.compute(
        metrics,
        prev.from,
        prev.to,
        query.granularity,
        prevBuckets,
      );
      // Aligned by position: bucket i of the previous period sits under bucket i of this one.
      previous = new Map(
        [...values].map(([m, v]) => [m, buckets.map((_, i) => v[i] ?? null)]),
      );
    }

    return {
      from: query.from,
      to: query.to,
      granularity: query.granularity,
      timeZone: TZ,
      generatedAt: now.toISOString(),
      buckets,
      ...(prev ? { previousFrom: prev.from, previousTo: prev.to } : {}),
      series: metrics.map((metric) => ({
        metric,
        label: METRIC_INFO[metric].label,
        unit: METRIC_INFO[metric].unit,
        values: current.get(metric)!,
        ...(previous ? { previousValues: previous.get(metric)! } : {}),
      })),
    };
  }

  private async compute(
    metrics: AdminTimeseriesMetric[],
    from: string,
    to: string,
    granularity: AdminTimeseriesGranularity,
    buckets: string[],
  ): Promise<Map<AdminTimeseriesMetric, Array<number | null>>> {
    const range = localRange(from, addZonedCalendarDays(to, 1), TZ);
    if (!range) throw new Error('Could not resolve the IST date range');
    const { start, end } = range;
    // Whitelisted by the zod schema; never user text.
    const unit = Prisma.raw(`'${granularity}'`);
    const bucket = (column: string) =>
      Prisma.sql`to_char(date_trunc(${unit}, (${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}::text), 'YYYY-MM-DD')`;

    const toMap = (
      rows: { b: string; n: number | Prisma.Decimal | null }[],
    ): Counts =>
      new Map(rows.map((r) => [r.b, r.n === null ? 0 : Number(r.n)]));

    const cache = new Map<string, Promise<Counts>>();
    const once = (key: string, run: () => Promise<Counts>) => {
      if (!cache.has(key)) cache.set(key, run());
      return cache.get(key)!;
    };

    const bookingsBy = (status: string) =>
      once(`b:${status}`, async () =>
        toMap(
          await this.prisma.$queryRaw<{ b: string; n: number }[]>`
            SELECT ${bucket('"slotStart"')} AS b, COUNT(*)::int AS n FROM "bookings"
             WHERE "status"::text = ${status} AND "slotStart" >= ${start} AND "slotStart" < ${end}
             GROUP BY 1`,
        ),
      );
    const walkIns = () =>
      once('walkIns', async () =>
        toMap(
          await this.prisma.$queryRaw<{ b: string; n: number }[]>`
            SELECT ${bucket('"joinedAt"')} AS b, COUNT(*)::int AS n FROM "queue_entries"
             WHERE "source" = 'WALK_IN' AND "status" = 'COMPLETED' AND "joinedAt" >= ${start} AND "joinedAt" < ${end}
             GROUP BY 1`,
        ),
      );

    const loaders: Record<
      AdminTimeseriesMetric,
      () => Promise<Array<number | null>>
    > = {
      appointmentsBooked: async () => {
        const m = toMap(
          await this.prisma.$queryRaw<{ b: string; n: number }[]>`
            SELECT ${bucket('"createdAt"')} AS b, COUNT(*)::int AS n FROM "bookings"
             WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1`,
        );
        return buckets.map((b) => m.get(b) ?? 0);
      },
      appointmentsCompleted: async () => {
        const m = await bookingsBy('COMPLETED');
        return buckets.map((b) => m.get(b) ?? 0);
      },
      walkInsServed: async () => {
        const m = await walkIns();
        return buckets.map((b) => m.get(b) ?? 0);
      },
      completedVisits: async () => {
        const [a, w] = await Promise.all([bookingsBy('COMPLETED'), walkIns()]);
        return buckets.map((b) => (a.get(b) ?? 0) + (w.get(b) ?? 0));
      },
      cancelled: async () => {
        const m = await bookingsBy('CANCELLED');
        return buckets.map((b) => m.get(b) ?? 0);
      },
      noShow: async () => {
        const m = await bookingsBy('NO_SHOW');
        return buckets.map((b) => m.get(b) ?? 0);
      },
      cancellationRatePercent: async () => {
        const [c, x, n] = await Promise.all([
          bookingsBy('COMPLETED'),
          bookingsBy('CANCELLED'),
          bookingsBy('NO_SHOW'),
        ]);
        return buckets.map((b) => {
          const cancelled = x.get(b) ?? 0;
          return ratePercent(
            cancelled,
            (c.get(b) ?? 0) + cancelled + (n.get(b) ?? 0),
          );
        });
      },
      completedServiceValuePaise: async () => {
        const rows = await this.prisma.$queryRaw<
          { b: string; n: Prisma.Decimal | null }[]
        >`
          SELECT x.b, SUM(x.value) AS n FROM (
            SELECT ${bucket('b."slotStart"')} AS b,
                   COALESCE(items.total, sv."price") - b."onlineBookingDiscountAmount" AS value
              FROM "bookings" b
              JOIN "services" sv ON sv."id" = b."serviceId"
              LEFT JOIN (SELECT "bookingId", SUM("price") AS total FROM "booking_services" GROUP BY "bookingId") items
                ON items."bookingId" = b."id"
             WHERE b."status" = 'COMPLETED' AND b."slotStart" >= ${start} AND b."slotStart" < ${end}
            UNION ALL
            SELECT ${bucket('q."joinedAt"')} AS b, sv."price" AS value
              FROM "queue_entries" q JOIN "services" sv ON sv."id" = q."serviceId"
             WHERE q."source" = 'WALK_IN' AND q."status" = 'COMPLETED'
               AND q."joinedAt" >= ${start} AND q."joinedAt" < ${end}
          ) x GROUP BY 1`;
        const m = new Map(
          rows.map((r) => [r.b, decimalStringToPaise((r.n ?? 0).toString())]),
        );
        return buckets.map((b) => m.get(b) ?? 0);
      },
      serviceHours: async () => {
        const m = toMap(
          await this.prisma.$queryRaw<
            { b: string; n: Prisma.Decimal | null }[]
          >`
            SELECT ${bucket('"endedAt"')} AS b,
                   ROUND((SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))) / 3600)::numeric, 1) AS n
              FROM "service_sessions"
             WHERE "status" = 'COMPLETED' AND "endedAt" >= ${start} AND "endedAt" < ${end}
             GROUP BY 1`,
        );
        return buckets.map((b) => m.get(b) ?? 0);
      },
      newSalons: async () => {
        const m = toMap(
          await this.prisma.$queryRaw<{ b: string; n: number }[]>`
            SELECT ${bucket('"createdAt"')} AS b, COUNT(*)::int AS n FROM "salons"
             WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1`,
        );
        return buckets.map((b) => m.get(b) ?? 0);
      },
      // Account customers only: guest (in-shop) visits have no stable identity to count.
      uniqueCustomers: async () => {
        const m = toMap(
          await this.prisma.$queryRaw<{ b: string; n: number }[]>`
            SELECT v.b, COUNT(DISTINCT v.c)::int AS n FROM (
              SELECT ${bucket('"slotStart"')} AS b, "customerId" AS c FROM "bookings"
               WHERE "status" = 'COMPLETED' AND "customerId" IS NOT NULL
                 AND "slotStart" >= ${start} AND "slotStart" < ${end}
              UNION ALL
              SELECT ${bucket('"joinedAt"')} AS b, "customerId" AS c FROM "queue_entries"
               WHERE "source" = 'WALK_IN' AND "status" = 'COMPLETED' AND "customerId" IS NOT NULL
                 AND "joinedAt" >= ${start} AND "joinedAt" < ${end}
            ) v GROUP BY 1`,
        );
        return buckets.map((b) => m.get(b) ?? 0);
      },
      // A customer counts once, in the bucket of their first-ever completed visit.
      newCustomers: async () => {
        const m = toMap(
          await this.prisma.$queryRaw<{ b: string; n: number }[]>`
            SELECT ${bucket('f.first')} AS b, COUNT(*)::int AS n FROM (
              SELECT v.c, MIN(v.t) AS first FROM (
                SELECT "customerId" AS c, "slotStart" AS t FROM "bookings"
                 WHERE "status" = 'COMPLETED' AND "customerId" IS NOT NULL
                UNION ALL
                SELECT "customerId" AS c, "joinedAt" AS t FROM "queue_entries"
                 WHERE "source" = 'WALK_IN' AND "status" = 'COMPLETED' AND "customerId" IS NOT NULL
              ) v GROUP BY v.c
            ) f WHERE f.first >= ${start} AND f.first < ${end} GROUP BY 1`,
        );
        return buckets.map((b) => m.get(b) ?? 0);
      },
      // Join -> service start, for queue entries that reached service; null where none did.
      averageWaitMinutes: async () => {
        const rows = await this.prisma.$queryRaw<
          { b: string; n: Prisma.Decimal | null }[]
        >`
          SELECT ${bucket('"joinedAt"')} AS b,
                 ROUND((AVG(EXTRACT(EPOCH FROM ("serviceStartedAt" - "joinedAt"))) / 60)::numeric, 1) AS n
            FROM "queue_entries"
           WHERE "serviceStartedAt" IS NOT NULL AND "joinedAt" >= ${start} AND "joinedAt" < ${end}
           GROUP BY 1`;
        const m = new Map(
          rows.map((r) => [r.b, r.n === null ? null : Number(r.n)]),
        );
        return buckets.map((b) => (m.has(b) ? m.get(b)! : null));
      },
    };

    const results = await Promise.all(
      metrics.map((metric) => loaders[metric]()),
    );
    return new Map(metrics.map((metric, i) => [metric, results[i]]));
  }
}

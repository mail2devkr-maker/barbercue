import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * The compatibility layer between FastQue Home visits and the existing channels (salon bookings,
 * live queue, FastQue Work). Only CONFIRMED home visits are visible to those channels: a checkout
 * hold or a home-only break never blocks a salon's own customer.
 *
 * Lock order everywhere is: salon advisory lock(s) sorted by id -> professional lock. Salon code
 * already takes the salon lock; home code takes the same one, so the two serialize.
 */
@Injectable()
export class ProfessionalCommitmentsService {
  static salonLock(tx: Prisma.TransactionClient, salonId: string) {
    return tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${salonId}))`,
    );
  }

  lockProfessional(tx: Prisma.TransactionClient, userId: string) {
    return tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-professional:${userId}`}))`,
    );
  }

  /** End of the first confirmed home visit of this PERSON overlapping [start, end), or null. */
  async userBusyUntil(
    db: Db,
    userId: string,
    start: Date,
    end: Date,
  ): Promise<Date | null> {
    const row = await db.professionalCommitment.findFirst({
      where: {
        userId,
        kind: 'HOME_BOOKING',
        releasedAt: null,
        startAt: { lt: end },
        endAt: { gt: start },
      },
      orderBy: { endAt: 'asc' },
      select: { endAt: true },
    });
    return row?.endAt ?? null;
  }

  /** Same, for a salon roster row. */
  async staffBusyUntil(
    db: Db,
    staffId: string,
    start: Date,
    end: Date,
  ): Promise<Date | null> {
    const row = await db.professionalCommitment.findFirst({
      where: {
        user: { staffMemberships: { some: { id: staffId } } },
        kind: 'HOME_BOOKING',
        releasedAt: null,
        startAt: { lt: end },
        endAt: { gt: start },
      },
      orderBy: { endAt: 'asc' },
      select: { endAt: true },
    });
    return row?.endAt ?? null;
  }

  /** Next confirmed home visit of this roster row after `after`. */
  async nextStart(db: Db, staffId: string, after: Date): Promise<Date | null> {
    const row = await db.professionalCommitment.findFirst({
      where: {
        user: { staffMemberships: { some: { id: staffId } } },
        kind: 'HOME_BOOKING',
        releasedAt: null,
        startAt: { gte: after },
      },
      orderBy: { startAt: 'asc' },
      select: { startAt: true },
    });
    return row?.startAt ?? null;
  }

  /** Confirmed home visits of a salon's ACTIVE roster, for in-memory day grids. */
  async salonAway(
    db: Db,
    salonId: string,
    start: Date,
    end: Date,
  ): Promise<{ staffId: string; start: Date; end: Date }[]> {
    return db.$queryRaw<{ staffId: string; start: Date; end: Date }[]>(
      Prisma.sql`
        SELECT s."id" AS "staffId", c."startAt" AS "start", c."endAt" AS "end"
        FROM "professional_commitments" c
        JOIN "salon_staff" s ON s."userId" = c."userId"
        WHERE s."salonId" = ${salonId} AND s."status" = 'ACTIVE'
          AND c."kind" = 'HOME_BOOKING' AND c."releasedAt" IS NULL
          AND c."startAt" < ${end} AND c."endAt" > ${start}`,
    );
  }

  /** Qualified ACTIVE staff ids (zero StaffService rows for a service = everyone qualifies) and chairs. */
  private async pool(db: Db, salonId: string, serviceIds: string[]) {
    const [staff, restricted, chairs] = await Promise.all([
      db.salonStaff.findMany({
        where: { salonId, status: 'ACTIVE' },
        select: { id: true },
      }),
      serviceIds.length
        ? db.staffService.findMany({
            where: { serviceId: { in: serviceIds } },
            select: { staffId: true, serviceId: true },
          })
        : Promise.resolve([] as { staffId: string; serviceId: string }[]),
      db.chair.count({ where: { salonId, status: 'ACTIVE' } }),
    ]);
    const limited = [...new Set(restricted.map((r) => r.serviceId))];
    const qualified = staff
      .map((s) => s.id)
      .filter((id) =>
        limited.every((sid) =>
          restricted.some((r) => r.staffId === id && r.serviceId === sid),
        ),
      );
    return { qualified, chairs };
  }

  async poolUnitsAway(
    db: Db,
    salonId: string,
    start: Date,
    end: Date,
    serviceIds: string[],
  ): Promise<number> {
    return (await this.dayGrid(db, salonId, start, end, serviceIds)).poolUnits(
      start,
      end,
    );
  }

  async dayGrid(
    db: Db,
    salonId: string,
    start: Date,
    end: Date,
    serviceIds: string[],
  ) {
    const away = await this.salonAway(db, salonId, start, end);
    if (away.length === 0)
      return { staffAway: () => false, poolUnits: () => 0 };
    const { qualified, chairs } = await this.pool(db, salonId, serviceIds);
    const within = (from: Date, to: Date) =>
      new Set(
        away.filter((a) => a.start < to && a.end > from).map((a) => a.staffId),
      );
    return {
      staffAway: (staffId: string, from: Date, to: Date) =>
        within(from, to).has(staffId),
      poolUnits: (from: Date, to: Date) => {
        const ids = within(from, to);
        return ProfessionalCommitmentsService.poolUnitsLost(
          qualified.length,
          chairs,
          qualified.filter((id) => ids.has(id)).length,
        );
      },
    };
  }

  /**
   * How many EXTRA pool units are gone because qualified staff are away. Staff and chairs are
   * separate limits (capacity = min(staff, chairs)), so staff who are away only cost capacity once
   * fewer qualified staff than chairs remain.
   */
  static poolUnitsLost(
    qualifiedStaff: number,
    chairs: number,
    away: number,
  ): number {
    if (away <= 0) return 0;
    return (
      Math.min(qualifiedStaff, chairs) -
      Math.min(Math.max(0, qualifiedStaff - away), chairs)
    );
  }
}

import { Injectable } from '@nestjs/common';
import {
  Prisma,
  QueueEntryStatus,
  ServiceSessionStatus,
  StaffMemberStatus,
  WorkAssignmentStatus,
  WorkLocationType,
} from '@prisma/client';
import { HOME_TIME_ZONE, type HomeTravelMode } from '@barbercue/shared';
import { ReservationService } from '../bookings/reservation.service';
import { ProfessionalCommitmentsService } from '../common/professional-commitments/professional-commitments.service';
import {
  resolveSalonTimeZone,
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedDayAndMinutes,
  zonedWallTimeToUtc,
} from '../common/timezone/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { addMin, type Db, type Tx } from './home-core.service';
import { HomeRoutingService, type HomePoint } from './home-routing.service';

export type UnavailableReason =
  | 'INACTIVE'
  | 'OFF_HOURS'
  | 'BUSY'
  | 'SALON_CUSTOMER'
  | 'WORK_SHIFT'
  | 'SALON_SHIFT'
  | 'TRAVEL'
  | 'MAX_PER_DAY'
  | 'CAPACITY'
  | 'QUEUE_DEMAND'
  | 'PEAK_RESTRICTED'
  | 'TRAVEL_LIMIT';

interface Interval {
  start: Date;
  end: Date;
}
type Window = { dayOfWeek: number; from: string; to: string };

const professionalInclude = {
  schedules: true,
  salonStaff: { include: { workingHours: true } },
  provider: {
    include: {
      salon: {
        include: {
          city: { select: { countryCode: true } },
          operatingHours: true,
        },
      },
    },
  },
} satisfies Prisma.HomeProfessionalInclude;
export type LoadedProfessional = Prisma.HomeProfessionalGetPayload<{
  include: typeof professionalInclude;
}>;

interface SalonFloor {
  zone: string;
  staff: { id: string; userId: string; windows: Window[] | null }[];
  reserved: Interval[];
  away: { userId: string; dedicated: boolean; start: Date; end: Date }[];
  waiting: number;
  dedicatedUsers: Set<string>;
}

export interface ProContext {
  pro: LoadedProfessional;
  zone: string;
  commitments: (Interval & {
    kind: string;
    serviceStart: Date | null;
    lat: number | null;
    lng: number | null;
    postalCode: string | null;
  })[];
  salonBusy: Interval[];
  work: Interval[];
  shiftWindows: { zone: string; windows: Window[] }[];
  visitsByDay: Map<string, number>;
  floor: SalonFloor | null;
}

export interface VisitNeed {
  serviceMinutes: number;
  prepMinutes: number;
  cleanupMinutes: number;
  location: HomePoint;
  instant: boolean;
}
export interface Evaluation {
  ok: boolean;
  reason: UnavailableReason | null;
  blockStart: Date;
  blockEnd: Date;
  travelMinutes: number;
  /** When a conflict ends, so instant search can retry after it. */
  retryAt: Date | null;
}

const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end && a.end > b.start;

/** True when [start, end) lies inside one configured window of its local day. */
function insideWindows(
  windows: Window[],
  zone: string,
  start: Date,
  end: Date,
): boolean {
  const date = utcToZonedDateStr(start, zone);
  const dow = zonedDateToDayOfWeek(date);
  return windows.some((w) => {
    if (w.dayOfWeek !== dow) return false;
    const from = zonedWallTimeToUtc(date, w.from, zone);
    const to = zonedWallTimeToUtc(date, w.to, zone);
    return !!from && !!to && start >= from && end <= to;
  });
}
function touchesWindows(
  windows: Window[],
  zone: string,
  start: Date,
  end: Date,
): boolean {
  for (const at of [start, end]) {
    const date = utcToZonedDateStr(at, zone);
    const dow = zonedDateToDayOfWeek(date);
    for (const w of windows) {
      if (w.dayOfWeek !== dow) continue;
      const from = zonedWallTimeToUtc(date, w.from, zone);
      const to = zonedWallTimeToUtc(date, w.to, zone);
      if (from && to && start < to && end > from) return true;
    }
  }
  return false;
}
const hoursToWindows = (
  rows: {
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }[],
): Window[] =>
  rows
    .filter((r) => !r.isClosed)
    .map((r) => ({
      dayOfWeek: r.dayOfWeek,
      from: r.openTime,
      to: r.closeTime,
    }));

const RESERVING_WORK: WorkAssignmentStatus[] = [
  WorkAssignmentStatus.ACCEPTED,
  WorkAssignmentStatus.CHECKED_IN,
];

/**
 * The unified availability engine. One loader reads every connected channel (salon appointments,
 * live queue, FastQue Work on-site gigs, home visits and holds, breaks/time off, salon shifts), and
 * one pure evaluator answers "can this person do this visit then". The same two functions serve the
 * slot grid, instant search and - inside a locked transaction - the final confirmation, where the
 * salon's own ReservationService is asked again as the authority.
 */
@Injectable()
export class HomeAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationService,
    private readonly commitments: ProfessionalCommitmentsService,
    private readonly routing: HomeRoutingService,
  ) {}

  async load(
    db: Db,
    professionalIds: string[],
    from: Date,
    to: Date,
    exclude: { bookingId?: string; holdIds?: string[] } = {},
  ): Promise<Map<string, ProContext>> {
    const out = new Map<string, ProContext>();
    if (professionalIds.length === 0) return out;
    const now = new Date();
    const winFrom = addMin(from, -6 * 60);
    const winTo = addMin(to, 6 * 60);
    const pros = await db.homeProfessional.findMany({
      where: { id: { in: professionalIds } },
      include: professionalInclude,
    });
    const userIds = [...new Set(pros.map((p) => p.userId))];
    const salonIds = [
      ...new Set(
        pros.map((p) => p.provider.salonId).filter((v): v is string => !!v),
      ),
    ];
    const liveCommitment: Prisma.ProfessionalCommitmentWhereInput = {
      releasedAt: null,
      OR: [{ kind: { not: 'HOME_HOLD' } }, { expiresAt: { gt: now } }],
      startAt: { lt: winTo },
      endAt: { gt: winFrom },
      ...(exclude.holdIds?.length ? { id: { notIn: exclude.holdIds } } : {}),
      ...(exclude.bookingId
        ? {
            AND: [
              {
                OR: [
                  { bookingId: null },
                  { bookingId: { not: exclude.bookingId } },
                ],
              },
            ],
          }
        : {}),
    };
    const memberships = await db.salonStaff.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          ...(salonIds.length ? [{ salonId: { in: salonIds } }] : []),
        ],
        accessRevokedAt: null,
      },
      include: {
        workingHours: true,
        salon: {
          include: {
            city: { select: { countryCode: true } },
            operatingHours: true,
          },
        },
      },
    });
    const myStaff = memberships.filter((m) => userIds.includes(m.userId));
    const allUsers = [
      ...new Set(memberships.map((m) => m.userId).concat(userIds)),
    ];
    const staffIds = myStaff.map((m) => m.id);
    const [commits, bookings, sessions, assigned, work, waiting, homePros] =
      await Promise.all([
        db.professionalCommitment.findMany({
          where: { userId: { in: allUsers }, ...liveCommitment },
          orderBy: { startAt: 'asc' },
        }),
        db.booking.findMany({
          where: {
            OR: [
              { preferredStaffId: { in: staffIds } },
              { salonId: { in: salonIds } },
            ],
            ...this.reservations.reservingBookingWhere(),
            slotStart: { lt: winTo },
            slotEnd: { gt: winFrom },
          },
          select: {
            salonId: true,
            slotStart: true,
            slotEnd: true,
            preferredStaffId: true,
            salon: { select: { serviceBufferMinutes: true } },
          },
        }),
        db.serviceSession.findMany({
          where: {
            status: ServiceSessionStatus.ACTIVE,
            OR: [
              { staffId: { in: staffIds } },
              { chair: { salonId: { in: salonIds } } },
            ],
          },
          select: {
            staffId: true,
            startedAt: true,
            service: { select: { durationMinutes: true } },
            queueEntry: {
              select: { bookingId: true, addOnMinutes: true, salonId: true },
            },
          },
        }),
        db.queueEntry.findMany({
          where: {
            status: QueueEntryStatus.CALLED,
            assignedStaffId: { not: null },
            OR: [
              { assignedStaffId: { in: staffIds } },
              { salonId: { in: salonIds } },
            ],
          },
          select: {
            salonId: true,
            assignedStaffId: true,
            assignedAt: true,
            calledAt: true,
            bookingId: true,
            addOnMinutes: true,
            service: { select: { durationMinutes: true } },
          },
        }),
        db.workAssignment.findMany({
          where: {
            workerId: { in: userIds },
            status: { in: RESERVING_WORK },
            job: {
              locationType: { not: WorkLocationType.REMOTE },
              startsAt: { lt: winTo },
              endsAt: { gt: winFrom },
            },
          },
          select: {
            workerId: true,
            job: { select: { startsAt: true, endsAt: true } },
          },
        }),
        salonIds.length
          ? db.queueEntry.findMany({
              where: {
                salonId: { in: salonIds },
                status: QueueEntryStatus.WAITING,
              },
              select: { salonId: true },
            })
          : Promise.resolve([] as { salonId: string }[]),
        salonIds.length
          ? db.homeProfessional.findMany({
              where: {
                provider: { salonId: { in: salonIds } },
                dedicated: true,
              },
              select: { userId: true, provider: { select: { salonId: true } } },
            })
          : Promise.resolve(
              [] as { userId: string; provider: { salonId: string | null } }[],
            ),
      ]);

    const projected = [
      ...sessions.map((s) => ({
        salonId: s.queueEntry.salonId,
        staffId: s.staffId,
        walkIn: s.queueEntry.bookingId === null,
        start: s.startedAt,
        end: this.reservations.projectedActiveSessionEnd(
          s.startedAt,
          this.reservations.occupiedMinutes(
            s.service.durationMinutes,
            s.queueEntry.addOnMinutes,
          ),
          now,
        ),
      })),
      ...assigned.map((e) => {
        const start = e.assignedAt ?? e.calledAt ?? now;
        return {
          salonId: e.salonId,
          staffId: e.assignedStaffId as string,
          walkIn: e.bookingId === null,
          start,
          end: this.reservations.projectedActiveSessionEnd(
            start,
            this.reservations.occupiedMinutes(
              e.service?.durationMinutes,
              e.addOnMinutes,
            ),
            now,
          ),
        };
      }),
    ];

    const floors = new Map<string, SalonFloor>();
    for (const salonId of salonIds) {
      const rows = memberships.filter(
        (m) => m.salonId === salonId && m.status === StaffMemberStatus.ACTIVE,
      );
      const salon = pros.find((p) => p.provider.salonId === salonId)!.provider
        .salon!;
      const dedicatedUsers = new Set(
        homePros
          .filter((h) => h.provider.salonId === salonId)
          .map((h) => h.userId),
      );
      const rosterUsers = new Set(rows.map((r) => r.userId));
      floors.set(salonId, {
        zone:
          resolveSalonTimeZone({
            timezone: salon.timezone,
            countryCode: salon.city.countryCode,
          }) ?? HOME_TIME_ZONE,
        staff: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          windows: r.workingHours.length
            ? hoursToWindows(r.workingHours)
            : null,
        })),
        reserved: [
          ...bookings
            .filter((b) => b.salonId === salonId)
            .map((b) => ({ start: b.slotStart, end: b.slotEnd })),
          ...projected
            .filter((s) => s.salonId === salonId && s.walkIn)
            .map((s) => ({ start: s.start, end: s.end })),
        ],
        away: commits
          .filter(
            (c) =>
              rosterUsers.has(c.userId) &&
              (c.kind === 'HOME_BOOKING' || c.kind === 'HOME_HOLD'),
          )
          .map((c) => ({
            userId: c.userId,
            dedicated: dedicatedUsers.has(c.userId),
            start: c.startAt,
            end: c.endAt,
          })),
        waiting: waiting.filter((w) => w.salonId === salonId).length,
        dedicatedUsers,
      });
    }

    for (const pro of pros) {
      const salon = pro.provider.salon;
      const mine = myStaff.filter((m) => m.userId === pro.userId);
      const myStaffIds = new Set(mine.map((m) => m.id));
      const myCommits = commits.filter((c) => c.userId === pro.userId);
      const visitsByDay = new Map<string, number>();
      for (const c of myCommits) {
        if (c.kind !== 'HOME_BOOKING' || !c.serviceStart) continue;
        const d = utcToZonedDateStr(c.serviceStart, HOME_TIME_ZONE);
        visitsByDay.set(d, (visitsByDay.get(d) ?? 0) + 1);
      }
      out.set(pro.id, {
        pro,
        zone: salon
          ? (resolveSalonTimeZone({
              timezone: salon.timezone,
              countryCode: salon.city.countryCode,
            }) ?? HOME_TIME_ZONE)
          : HOME_TIME_ZONE,
        commitments: myCommits.map((c) => ({
          kind: c.kind,
          start: c.startAt,
          end: c.endAt,
          serviceStart: c.serviceStart,
          lat: c.lat,
          lng: c.lng,
          postalCode: c.postalCode,
        })),
        salonBusy: [
          ...bookings
            .filter(
              (b) => b.preferredStaffId && myStaffIds.has(b.preferredStaffId),
            )
            .map((b) => ({
              start: addMin(b.slotStart, -b.salon.serviceBufferMinutes),
              end: addMin(b.slotEnd, b.salon.serviceBufferMinutes),
            })),
          ...projected
            .filter((s) => myStaffIds.has(s.staffId))
            .map((s) => ({ start: s.start, end: s.end })),
        ],
        work: work
          .filter((w) => w.workerId === pro.userId)
          .map((w) => ({ start: w.job.startsAt, end: w.job.endsAt })),
        // Working at a salon is itself a commitment for any OTHER channel: salon hours apply when the
        // person has no personal hours configured there.
        shiftWindows: mine
          .filter(
            (m) =>
              m.status === StaffMemberStatus.ACTIVE &&
              m.salonId !== pro.provider.salonId,
          )
          .map((m) => ({
            zone:
              resolveSalonTimeZone({
                timezone: m.salon.timezone,
                countryCode: m.salon.city.countryCode,
              }) ?? HOME_TIME_ZONE,
            windows: hoursToWindows(
              m.workingHours.length ? m.workingHours : m.salon.operatingHours,
            ),
          })),
        visitsByDay,
        floor: pro.provider.salonId
          ? (floors.get(pro.provider.salonId) ?? null)
          : null,
      });
    }
    return out;
  }

  basePoint(pro: LoadedProfessional): HomePoint {
    return pro.provider.salon
      ? {
          lat: pro.provider.salon.lat,
          lng: pro.provider.salon.lng,
          postalCode: pro.provider.salon.postalCode,
        }
      : { lat: pro.provider.baseLat, lng: pro.provider.baseLng };
  }

  baseTravel(pro: LoadedProfessional, to: HomePoint) {
    return this.routing.estimate(
      this.basePoint(pro),
      to,
      pro.provider.travelMode,
    );
  }

  /** Pure given its context. `serviceStart` is when the service itself would begin at the address. */
  evaluate(
    ctx: ProContext,
    need: VisitNeed,
    serviceStart: Date,
    now = new Date(),
  ): Evaluation {
    const { pro } = ctx;
    const mode = pro.provider.travelMode;
    const base = this.basePoint(pro);
    const baseMinutes = this.routing.estimate(
      base,
      need.location,
      mode,
    ).minutes;
    const serviceEnd = addMin(serviceStart, need.serviceMinutes);

    // Coming straight from a visit that ends shortly before? Travel starts there, not at base.
    const prev = ctx.commitments
      .filter((c) => c.lat != null && c.end <= serviceStart)
      .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
    const fromPrev =
      prev && serviceStart.getTime() - prev.end.getTime() < 2 * 3_600_000
        ? this.routing.estimate(prev, need.location, mode).minutes
        : 0;
    const travel = Math.max(baseMinutes, fromPrev);
    const blockStart = addMin(serviceStart, -(travel + need.prepMinutes));
    const backTravel = pro.provider.salonId ? baseMinutes : 0;
    const blockEnd = addMin(serviceEnd, need.cleanupMinutes + backTravel);
    const block = { start: blockStart, end: blockEnd };
    const result = (
      reason: UnavailableReason | null,
      retryAt: Date | null = null,
    ): Evaluation => ({
      ok: reason === null,
      reason,
      blockStart,
      blockEnd,
      travelMinutes: travel,
      retryAt,
    });

    if (
      !pro.active ||
      pro.suspendedAt ||
      !pro.consentAt ||
      pro.provider.status !== 'APPROVED' ||
      pro.provider.paused ||
      (pro.provider.salonId &&
        (!pro.salonStaff ||
          pro.salonStaff.status !== StaffMemberStatus.ACTIVE ||
          pro.salonStaff.accessRevokedAt ||
          pro.provider.salon!.status !== 'ACTIVE' ||
          (need.instant && pro.provider.salon!.isClosedForToday)))
    )
      return result('INACTIVE');
    if (travel > pro.provider.maxTravelMinutes) return result('TRAVEL_LIMIT');
    if (blockStart < addMin(now, -1)) return result('TRAVEL');

    // Working hours: independents must publish a schedule; salon staff follow salon + personal hours.
    const schedule: Window[] = pro.schedules.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      from: s.startTime,
      to: s.endTime,
    }));
    if (pro.provider.salon) {
      const salonHours = hoursToWindows(pro.provider.salon.operatingHours);
      if (!insideWindows(salonHours, ctx.zone, blockStart, blockEnd))
        return result('OFF_HOURS');
      const own = pro.salonStaff!.workingHours;
      if (
        own.length &&
        !insideWindows(hoursToWindows(own), ctx.zone, blockStart, blockEnd)
      )
        return result('OFF_HOURS');
      if (
        schedule.length &&
        !insideWindows(schedule, ctx.zone, blockStart, blockEnd)
      )
        return result('OFF_HOURS');
    } else if (!insideWindows(schedule, ctx.zone, blockStart, blockEnd)) {
      return result('OFF_HOURS');
    }

    const clash = (list: Interval[]) => list.find((c) => overlaps(c, block));
    const own = clash(ctx.commitments);
    if (own) return result('BUSY', own.end);
    const salonClash = clash(ctx.salonBusy);
    if (salonClash) return result('SALON_CUSTOMER', salonClash.end);
    const workClash = clash(ctx.work);
    if (workClash) return result('WORK_SHIFT', workClash.end);
    if (
      ctx.shiftWindows.some((s) =>
        touchesWindows(s.windows, s.zone, blockStart, blockEnd),
      )
    )
      return result('SALON_SHIFT');

    const next = ctx.commitments
      .filter((c) => c.lat != null && c.serviceStart && c.start >= blockEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    if (next) {
      const hop = this.routing.estimate(need.location, next, mode).minutes;
      if (addMin(serviceEnd, need.cleanupMinutes + hop) > next.serviceStart!)
        return result('TRAVEL');
    }
    const day = utcToZonedDateStr(serviceStart, HOME_TIME_ZONE);
    if ((ctx.visitsByDay.get(day) ?? 0) >= pro.maxPerDay)
      return result('MAX_PER_DAY');

    if (ctx.floor) {
      const cap = this.checkSalonCapacity(ctx, block, now);
      if (cap) return result(cap.reason, cap.retryAt);
    }
    return result(null);
  }

  /** Owner's rules protecting the in-store business. Never relaxed automatically. */
  private checkSalonCapacity(
    ctx: ProContext,
    block: Interval,
    now: Date,
  ): { reason: UnavailableReason; retryAt: Date | null } | null {
    const p = ctx.pro.provider;
    const floor = ctx.floor!;
    const local = zonedDayAndMinutes(block.start, floor.zone);
    if (p.blockWeekends && (local.dayOfWeek === 0 || local.dayOfWeek === 6))
      return { reason: 'PEAK_RESTRICTED', retryAt: null };
    if (p.blockedStart && p.blockedEnd) {
      const all: Window[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        from: p.blockedStart!,
        to: p.blockedEnd!,
      }));
      if (touchesWindows(all, floor.zone, block.start, block.end))
        return { reason: 'PEAK_RESTRICTED', retryAt: null };
    }
    const away = floor.away.filter((a) => overlaps(a, block));
    const awayUsers = new Set(away.map((a) => a.userId));
    awayUsers.delete(ctx.pro.userId);
    const earliestBack = away.length
      ? new Date(Math.min(...away.map((a) => a.end.getTime())))
      : null;
    if (awayUsers.size + 1 > p.maxHomeStaff)
      return { reason: 'CAPACITY', retryAt: earliestBack };
    const onFloor = floor.staff.filter(
      (s) =>
        !floor.dedicatedUsers.has(s.userId) &&
        (s.windows === null ||
          touchesWindows(s.windows, floor.zone, block.start, block.end)),
    );
    const remaining = onFloor.filter(
      (s) => !awayUsers.has(s.userId) && s.userId !== ctx.pro.userId,
    ).length;
    if (ctx.pro.dedicated) return null;
    if (remaining < p.minStaffInSalon)
      return { reason: 'CAPACITY', retryAt: earliestBack };
    // Existing appointments and walk-ins must still be servable by whoever stays (checked at each
    // reservation's own start, which is where the overlap count peaks).
    const inBlock = floor.reserved.filter((r) => overlaps(r, block));
    const peak = Math.max(
      0,
      ...inBlock.map((r) => {
        const at = r.start > block.start ? r.start : block.start;
        return inBlock.filter((o) => o.start <= at && o.end > at).length;
      }),
    );
    if (peak > remaining)
      return {
        reason: 'CAPACITY',
        retryAt: new Date(Math.min(...inBlock.map((r) => r.end.getTime()))),
      };
    if (
      block.start < addMin(now, 90) &&
      floor.waiting > p.queueWaitingLimit * Math.max(1, remaining)
    )
      return { reason: 'QUEUE_DEMAND', retryAt: null };
    return null;
  }

  /** Earliest feasible service start for "Book now", or null. */
  earliest(
    ctx: ProContext,
    need: VisitNeed,
    opts: { accessBuffer: number; maxLeadMinutes: number; now?: Date },
  ): {
    serviceStart: Date;
    evaluation: Evaluation;
    availableFrom: Date;
  } | null {
    const now = opts.now ?? new Date();
    let availableFrom = now;
    for (let i = 0; i < 6; i += 1) {
      const travel = this.baseTravel(ctx.pro, need.location).minutes;
      const serviceStart = addMin(
        availableFrom,
        need.prepMinutes + travel + opts.accessBuffer,
      );
      if (serviceStart > addMin(now, opts.maxLeadMinutes)) return null;
      const evaluation = this.evaluate(ctx, need, serviceStart, now);
      if (evaluation.ok) return { serviceStart, evaluation, availableFrom };
      if (!evaluation.retryAt || evaluation.retryAt <= availableFrom)
        return null;
      availableFrom = evaluation.retryAt;
    }
    return null;
  }

  /** Salon locks (sorted) then the professional lock - the same salon lock bookings and queue take. */
  async lock(tx: Tx, professionalId: string): Promise<LoadedProfessional> {
    const pro = await tx.homeProfessional.findUniqueOrThrow({
      where: { id: professionalId },
      include: professionalInclude,
    });
    const salons = await tx.salonStaff.findMany({
      where: { userId: pro.userId },
      select: { salonId: true },
    });
    const ids = new Set(salons.map((s) => s.salonId));
    if (pro.provider.salonId) ids.add(pro.provider.salonId);
    for (const id of [...ids].sort())
      await ProfessionalCommitmentsService.salonLock(tx, id);
    await this.commitments.lockProfessional(tx, pro.userId);
    return pro;
  }

  /** Authoritative answer inside the caller's transaction, after lock(). */
  async evaluateLocked(
    tx: Tx,
    professionalId: string,
    need: VisitNeed,
    serviceStart: Date,
    exclude: { bookingId?: string; holdIds?: string[] } = {},
  ): Promise<Evaluation> {
    // Expired holds must not keep the exclusion constraint occupied.
    const pro = await tx.homeProfessional.findUniqueOrThrow({
      where: { id: professionalId },
      select: { userId: true },
    });
    const now = new Date();
    await tx.professionalCommitment.updateMany({
      where: {
        userId: pro.userId,
        kind: 'HOME_HOLD',
        releasedAt: null,
        expiresAt: { lte: now },
      },
      data: { releasedAt: now },
    });
    const ctx = (
      await this.load(
        tx,
        [professionalId],
        addMin(serviceStart, -180),
        addMin(serviceStart, need.serviceMinutes + 180),
        exclude,
      )
    ).get(professionalId)!;
    const ev = this.evaluate(ctx, need, serviceStart, now);
    if (!ev.ok) return ev;
    // The salon's own reservation authority has the last word for each roster row of this person.
    const staff = await tx.salonStaff.findMany({
      where: { userId: pro.userId, accessRevokedAt: null },
      select: {
        id: true,
        salonId: true,
        salon: { select: { serviceBufferMinutes: true } },
      },
    });
    for (const s of staff) {
      const check = await this.reservations.isStaffFreeForInterval(
        tx,
        s.salonId,
        s.id,
        ev.blockStart,
        ev.blockEnd,
        { bufferMinutes: s.salon.serviceBufferMinutes, ignoreHome: true },
      );
      if (!check.free)
        return {
          ...ev,
          ok: false,
          reason: 'SALON_CUSTOMER',
          retryAt: check.busyUntil,
        };
    }
    return ev;
  }
}

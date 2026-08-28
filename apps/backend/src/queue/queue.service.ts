import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  ChairStatus,
  QueueEntrySource,
  QueueEntryStatus,
  QueueErrorCode,
  ServiceSessionStatus,
  StaffMemberStatus,
  computeSlotCapacity,
  estimateWaitMinutes,
  type AssignQueueEntryInput,
  type ReassignQueueEntryInput,
  type ChairOptionDto,
  type DashboardQueueDto,
  type QueueEntryDetailDto,
  type QueueStatusDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  AvailabilityService,
  istWallTimeToUtc,
  utcToIstDateStr,
} from '../bookings/availability.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

// Allowed from 15 minutes before slotStart onward, no upper bound — the automatic no-show sweep
// that would otherwise cap lateness isn't built in this phase (see the plan's explicit scoping).
const EARLY_CHECKIN_WINDOW_MINUTES = 15;
// Same generous window as bookings.service.ts's TRANSACTION_OPTIONS, for the same reason (Neon
// serverless cold-start latency can exceed Prisma's default 5s interactive-transaction timeout).
const TRANSACTION_OPTIONS = { timeout: 15_000 };
// Used only when a queue entry has no service yet (an unspecified walk-in) — a reasonable
// salon-wide default rather than leaving the ETA uncomputed.
const DEFAULT_SERVICE_DURATION_MINUTES = 30;

const queueEntryDetailInclude = {
  service: { select: { name: true } },
  customer: { select: { phone: true } },
  assignedStaff: { select: { displayName: true } },
  assignedChair: { select: { label: true } },
  serviceSessions: {
    where: { status: ServiceSessionStatus.ACTIVE },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.QueueEntryInclude;

type QueueEntryWithDetails = Prisma.QueueEntryGetPayload<{
  include: typeof queueEntryDetailInclude;
}>;

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly salonAccess: SalonAccessService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ---------- Customer-facing ----------

  async checkIn(
    customerId: string,
    bookingId: string,
  ): Promise<QueueEntryDetailDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
    });
    if (!booking) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new AppException(
        QueueErrorCode.INVALID_QUEUE_TRANSITION,
        'Only a confirmed booking can be checked in.',
        HttpStatus.CONFLICT,
      );
    }

    const existingForBooking = await this.prisma.queueEntry.findFirst({
      where: { bookingId },
    });
    if (existingForBooking) {
      throw new AppException(
        QueueErrorCode.ALREADY_CHECKED_IN,
        'This booking has already been checked in.',
        HttpStatus.CONFLICT,
      );
    }

    await this.assertNotAlreadyInQueue(customerId);

    const earliestCheckIn =
      booking.slotStart.getTime() - EARLY_CHECKIN_WINDOW_MINUTES * 60_000;
    if (Date.now() < earliestCheckIn) {
      throw new AppException(
        QueueErrorCode.CHECK_IN_TOO_EARLY,
        `Check-in opens ${EARLY_CHECKIN_WINDOW_MINUTES} minutes before your appointment.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const entryId = await this.prisma.$transaction(async (tx) => {
      const tokenNumber = await this.nextTokenNumber(tx, booking.salonId);
      const created = await tx.queueEntry.create({
        data: {
          salonId: booking.salonId,
          bookingId,
          customerId,
          serviceId: booking.serviceId,
          source: QueueEntrySource.APPOINTMENT,
          tokenNumber,
          status: QueueEntryStatus.WAITING,
        },
      });
      return created.id;
    }, TRANSACTION_OPTIONS);

    await this.recomputeEtas(booking.salonId);
    this.realtime.emitQueueUpdated(booking.salonId);
    return this.getDetailOrThrow(entryId);
  }

  async joinWalkIn(
    customerId: string,
    salonId: string,
    serviceId?: string,
  ): Promise<QueueEntryDetailDto> {
    await this.availability.getSalonOrThrow(salonId);
    if (serviceId)
      await this.availability.getServiceOrThrow(salonId, serviceId);
    await this.assertNotAlreadyInQueue(customerId);

    const entryId = await this.prisma.$transaction(async (tx) => {
      const tokenNumber = await this.nextTokenNumber(tx, salonId);
      const created = await tx.queueEntry.create({
        data: {
          salonId,
          customerId,
          serviceId: serviceId ?? null,
          source: QueueEntrySource.WALK_IN,
          tokenNumber,
          status: QueueEntryStatus.WAITING,
        },
      });
      return created.id;
    }, TRANSACTION_OPTIONS);

    await this.recomputeEtas(salonId);
    this.realtime.emitQueueUpdated(salonId);
    return this.getDetailOrThrow(entryId);
  }

  async getActiveForCustomer(
    customerId: string,
  ): Promise<QueueEntryDetailDto | null> {
    const entry = await this.prisma.queueEntry.findFirst({
      where: {
        customerId,
        status: {
          in: [
            QueueEntryStatus.WAITING,
            QueueEntryStatus.CALLED,
            QueueEntryStatus.IN_SERVICE,
          ],
        },
      },
      include: queueEntryDetailInclude,
      orderBy: { joinedAt: 'desc' },
    });
    if (!entry) return null;
    const position =
      entry.status === QueueEntryStatus.WAITING
        ? await this.computePosition(entry)
        : null;
    return this.toDetailDto(entry, position);
  }

  // Public, no auth — a lightweight wait-time widget, deferred from Phase 3A/3B specifically to
  // this phase (see API.md's Discovery section).
  async getQueueStatus(salonId: string): Promise<QueueStatusDto> {
    await this.availability.getSalonOrThrow(salonId);
    const waitingCount = await this.prisma.queueEntry.count({
      where: { salonId, status: QueueEntryStatus.WAITING },
    });
    const [staffCount, chairCount, avgDuration, activeSessions] =
      await Promise.all([
        this.prisma.salonStaff.count({
          where: { salonId, status: StaffMemberStatus.ACTIVE },
        }),
        this.prisma.chair.count({
          where: { salonId, status: ChairStatus.ACTIVE },
        }),
        this.prisma.service.aggregate({
          where: { salonId, isActive: true },
          _avg: { durationMinutes: true },
        }),
        this.prisma.serviceSession.findMany({
          where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
          select: {
            startedAt: true,
            service: { select: { durationMinutes: true } },
          },
        }),
      ]);
    const serverCount = computeSlotCapacity(staffCount, chairCount);
    const avgServiceDurationMinutes =
      avgDuration._avg.durationMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES;
    const activeRemaining = this.averageRemainingMinutes(activeSessions);
    const estimatedWaitMinutes = estimateWaitMinutes(
      serverCount,
      waitingCount,
      avgServiceDurationMinutes,
      activeRemaining,
    );
    return { salonId, waitingCount, estimatedWaitMinutes };
  }

  // ---------- Staff/owner dashboard ----------

  async getDashboardQueue(
    userId: string,
    salonId: string,
  ): Promise<DashboardQueueDto> {
    await this.salonAccess.assertAccess(userId, salonId);

    const entries = await this.prisma.queueEntry.findMany({
      where: {
        salonId,
        status: {
          in: [
            QueueEntryStatus.WAITING,
            QueueEntryStatus.CALLED,
            QueueEntryStatus.IN_SERVICE,
          ],
        },
      },
      include: queueEntryDetailInclude,
      orderBy: { joinedAt: 'asc' },
    });
    const waitingIds = entries
      .filter((e) => e.status === QueueEntryStatus.WAITING)
      .map((e) => e.id);
    const detailed = entries.map((e) =>
      this.toDetailDto(
        e,
        e.status === QueueEntryStatus.WAITING
          ? waitingIds.indexOf(e.id) + 1
          : null,
      ),
    );

    // Full roster (both statuses) — an ACTIVE-only filter would make an off-duty staff member
    // invisible here and unable to clock themselves back in via this same dashboard. The assign
    // action itself still separately re-validates ACTIVE + qualified via AvailabilityService.
    const [staffRoster, chairs] = await Promise.all([
      this.prisma.salonStaff.findMany({
        where: { salonId },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.chair.findMany({
        where: { salonId, status: ChairStatus.ACTIVE },
        orderBy: { label: 'asc' },
      }),
    ]);

    return {
      entries: detailed,
      staffRoster: staffRoster.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        status: s.status,
      })),
      chairs: chairs.map((c): ChairOptionDto => ({ id: c.id, label: c.label })),
    };
  }

  async call(userId: string, entryId: string): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    await this.salonAccess.assertAccess(userId, entry.salonId);

    // A conditional UPDATE (WHERE id AND status) is atomic in Postgres — no separate row lock
    // needed for a plain status transition, unlike the ServiceSession insert in assign() below,
    // which genuinely needs the partial-unique-index backstop for a real INSERT race.
    const claim = await this.prisma.queueEntry.updateMany({
      where: { id: entryId, status: QueueEntryStatus.WAITING },
      data: { status: QueueEntryStatus.CALLED, calledAt: new Date() },
    });
    if (claim.count === 0) {
      throw new AppException(
        QueueErrorCode.INVALID_QUEUE_TRANSITION,
        'This entry is not waiting to be called.',
        HttpStatus.CONFLICT,
      );
    }

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitEntryCalled(entry.salonId, entryId, entry.customerId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  async assign(
    userId: string,
    entryId: string,
    input: AssignQueueEntryInput,
  ): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    await this.salonAccess.assertAccess(userId, entry.salonId);

    const serviceId = input.serviceId ?? entry.serviceId;
    if (!serviceId) {
      throw new AppException(
        QueueErrorCode.SERVICE_REQUIRED,
        'A service must be specified to assign this walk-in.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.availability.assertStaffQualified(
      entry.salonId,
      serviceId,
      input.staffId,
    );

    const chair = await this.prisma.chair.findFirst({
      where: { id: input.chairId, salonId: entry.salonId },
    });
    if (!chair) {
      throw new AppException(
        QueueErrorCode.CHAIR_NOT_FOUND,
        'Chair not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (chair.status !== ChairStatus.ACTIVE) {
      throw new AppException(
        QueueErrorCode.CHAIR_INACTIVE,
        'This chair is not active.',
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Claim the entry first — if this UPDATE affects 0 rows, someone else already
      // called/assigned/cancelled it, and we bail out before ever touching ServiceSession.
      const claim = await tx.queueEntry.updateMany({
        where: {
          id: entryId,
          status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED] },
        },
        data: {
          status: QueueEntryStatus.IN_SERVICE,
          serviceStartedAt: new Date(),
          assignedStaffId: input.staffId,
          assignedChairId: input.chairId,
          serviceId,
        },
      });
      if (claim.count === 0) {
        throw new AppException(
          QueueErrorCode.INVALID_QUEUE_TRANSITION,
          'This entry can no longer be assigned.',
          HttpStatus.CONFLICT,
        );
      }

      try {
        await tx.serviceSession.create({
          data: {
            queueEntryId: entryId,
            staffId: input.staffId,
            chairId: input.chairId,
            serviceId,
            status: ServiceSessionStatus.ACTIVE,
          },
        });
      } catch (err) {
        // A P2002 here rolls back the whole transaction, including the claim above, so the entry
        // correctly reverts to its prior status for a retry with a different staff/chair.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const rawTarget = err.meta?.target;
          const target = (
            Array.isArray(rawTarget)
              ? rawTarget
                  .filter((t): t is string => typeof t === 'string')
                  .join(',')
              : typeof rawTarget === 'string'
                ? rawTarget
                : ''
          ).toLowerCase();
          if (target.includes('staff')) {
            throw new AppException(
              QueueErrorCode.STAFF_ALREADY_OCCUPIED,
              'This staff member is already serving another customer.',
              HttpStatus.CONFLICT,
            );
          }
          if (target.includes('chair')) {
            throw new AppException(
              QueueErrorCode.CHAIR_ALREADY_OCCUPIED,
              'This chair is already occupied.',
              HttpStatus.CONFLICT,
            );
          }
        }
        throw err;
      }
    }, TRANSACTION_OPTIONS);

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  /**
   * Moves an already in-service visit to another active barber/chair without replacing the queue
   * entry or service session. Updating both rows in one transaction preserves token, join time,
   * queue priority and service history while the partial unique indexes continue to enforce one
   * active visit per barber/chair under concurrent requests.
   */
  async reassign(
    userId: string,
    entryId: string,
    input: ReassignQueueEntryInput,
  ): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    await this.salonAccess.assertAccess(userId, entry.salonId);
    if (entry.status !== QueueEntryStatus.IN_SERVICE) {
      throw new AppException(
        QueueErrorCode.INVALID_QUEUE_TRANSITION,
        'Only an in-service visit can be reassigned.',
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.prisma.serviceSession.findFirst({
      where: { queueEntryId: entryId, status: ServiceSessionStatus.ACTIVE },
    });
    if (!session) {
      throw new AppException(
        QueueErrorCode.SERVICE_SESSION_NOT_FOUND,
        'The active service session could not be found.',
        HttpStatus.CONFLICT,
      );
    }

    const staffId = input.staffId ?? session.staffId;
    const chairId = input.chairId ?? session.chairId;
    await this.availability.assertStaffQualified(
      entry.salonId,
      session.serviceId,
      staffId,
    );

    const chair = await this.prisma.chair.findFirst({
      where: { id: chairId, salonId: entry.salonId },
    });
    if (!chair) {
      throw new AppException(
        QueueErrorCode.CHAIR_NOT_FOUND,
        'Chair not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (chair.status !== ChairStatus.ACTIVE) {
      throw new AppException(
        QueueErrorCode.CHAIR_INACTIVE,
        'This chair is not active.',
        HttpStatus.CONFLICT,
      );
    }

    if (staffId === session.staffId && chairId === session.chairId) {
      return this.getDetailOrThrow(entryId);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const sessionClaim = await tx.serviceSession.updateMany({
          where: {
            id: session.id,
            status: ServiceSessionStatus.ACTIVE,
            staffId: session.staffId,
            chairId: session.chairId,
          },
          data: { staffId, chairId },
        });
        if (sessionClaim.count === 0) {
          throw new AppException(
            QueueErrorCode.INVALID_QUEUE_TRANSITION,
            'This visit was changed in another session. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        }

        const entryClaim = await tx.queueEntry.updateMany({
          where: {
            id: entryId,
            status: QueueEntryStatus.IN_SERVICE,
            assignedStaffId: entry.assignedStaffId,
            assignedChairId: entry.assignedChairId,
          },
          // Deliberately assignment-only: tokenNumber, joinedAt, status, serviceStartedAt and
          // estimatedWaitMinutes are not written and therefore cannot be reset by reassignment.
          data: { assignedStaffId: staffId, assignedChairId: chairId },
        });
        if (entryClaim.count === 0) {
          throw new AppException(
            QueueErrorCode.INVALID_QUEUE_TRANSITION,
            'This visit was changed in another session. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        }
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const rawTarget = error.meta?.target;
        const target = (
          Array.isArray(rawTarget)
            ? rawTarget
                .filter((value): value is string => typeof value === 'string')
                .join(',')
            : typeof rawTarget === 'string'
              ? rawTarget
              : ''
        ).toLowerCase();
        if (target.includes('staff')) {
          throw new AppException(
            QueueErrorCode.STAFF_ALREADY_OCCUPIED,
            'This staff member is already serving another customer.',
            HttpStatus.CONFLICT,
          );
        }
        if (target.includes('chair')) {
          throw new AppException(
            QueueErrorCode.CHAIR_ALREADY_OCCUPIED,
            'This chair is already occupied.',
            HttpStatus.CONFLICT,
          );
        }
      }
      throw error;
    }

    this.realtime.emitQueueEntryReassigned(entry.salonId, entryId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  async completeSession(
    userId: string,
    sessionId: string,
  ): Promise<QueueEntryDetailDto> {
    const session = await this.prisma.serviceSession.findUnique({
      where: { id: sessionId },
      include: { queueEntry: true },
    });
    if (!session) {
      throw new AppException(
        QueueErrorCode.SERVICE_SESSION_NOT_FOUND,
        'Service session not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.salonAccess.assertAccess(userId, session.queueEntry.salonId);

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.serviceSession.updateMany({
        where: { id: sessionId, status: ServiceSessionStatus.ACTIVE },
        data: { status: ServiceSessionStatus.COMPLETED, endedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new AppException(
          QueueErrorCode.INVALID_QUEUE_TRANSITION,
          'This session is no longer active.',
          HttpStatus.CONFLICT,
        );
      }

      await tx.queueEntry.update({
        where: { id: session.queueEntryId },
        data: {
          status: QueueEntryStatus.COMPLETED,
          serviceCompletedAt: new Date(),
        },
      });

      // STATE_MACHINES.md's Booking diagram: "CONFIRMED → COMPLETED: linked QueueEntry's
      // ServiceSession finishes" — the only place a Booking ever reaches COMPLETED.
      if (session.queueEntry.bookingId) {
        await tx.booking.update({
          where: { id: session.queueEntry.bookingId },
          data: { status: BookingStatus.COMPLETED },
        });
      }
    }, TRANSACTION_OPTIONS);

    await this.recomputeEtas(session.queueEntry.salonId);
    this.realtime.emitQueueUpdated(session.queueEntry.salonId);
    return this.getDetailOrThrow(session.queueEntryId);
  }

  async noShow(userId: string, entryId: string): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    await this.salonAccess.assertAccess(userId, entry.salonId);

    const claim = await this.prisma.queueEntry.updateMany({
      where: { id: entryId, status: QueueEntryStatus.CALLED },
      data: { status: QueueEntryStatus.NO_SHOW },
    });
    if (claim.count === 0) {
      throw new AppException(
        QueueErrorCode.INVALID_QUEUE_TRANSITION,
        'Only a called entry can be marked no-show.',
        HttpStatus.CONFLICT,
      );
    }

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  async cancelByStaff(
    userId: string,
    entryId: string,
  ): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    await this.salonAccess.assertAccess(userId, entry.salonId);

    const cancellableStatuses = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.CALLED,
      QueueEntryStatus.IN_SERVICE,
    ];
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.queueEntry.updateMany({
        where: { id: entryId, status: { in: cancellableStatuses } },
        data: { status: QueueEntryStatus.CANCELLED },
      });
      if (claim.count === 0) {
        throw new AppException(
          QueueErrorCode.INVALID_QUEUE_TRANSITION,
          'This entry can no longer be cancelled.',
          HttpStatus.CONFLICT,
        );
      }
      // Cascade: an IN_SERVICE entry's ACTIVE session is aborted too (ServiceSession's own
      // ACTIVE → CANCELLED edge in STATE_MACHINES.md). A no-op updateMany for WAITING/CALLED
      // entries, which never had a session.
      await tx.serviceSession.updateMany({
        where: { queueEntryId: entryId, status: ServiceSessionStatus.ACTIVE },
        data: { status: ServiceSessionStatus.CANCELLED, endedAt: new Date() },
      });
    }, TRANSACTION_OPTIONS);

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  // ---------- Shared internals ----------

  private async assertNotAlreadyInQueue(customerId: string): Promise<void> {
    const active = await this.prisma.queueEntry.findFirst({
      where: {
        customerId,
        status: {
          in: [
            QueueEntryStatus.WAITING,
            QueueEntryStatus.CALLED,
            QueueEntryStatus.IN_SERVICE,
          ],
        },
      },
    });
    if (active) {
      throw new AppException(
        QueueErrorCode.ALREADY_IN_QUEUE,
        'You already have an active queue token. Please finish or cancel it first.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async computePosition(entry: {
    salonId: string;
    joinedAt: Date;
  }): Promise<number> {
    const ahead = await this.prisma.queueEntry.count({
      where: {
        salonId: entry.salonId,
        status: QueueEntryStatus.WAITING,
        joinedAt: { lt: entry.joinedAt },
      },
    });
    return ahead + 1;
  }

  private averageRemainingMinutes(
    sessions: { startedAt: Date; service: { durationMinutes: number } }[],
  ): number {
    if (sessions.length === 0) return 0;
    const now = Date.now();
    const remaining = sessions.map((s) =>
      Math.max(
        0,
        s.service.durationMinutes - (now - s.startedAt.getTime()) / 60_000,
      ),
    );
    return remaining.reduce((sum, m) => sum + m, 0) / remaining.length;
  }

  /**
   * STATE_MACHINES.md: "estimatedWaitMinutes is recomputed whenever any QueueEntry in the salon
   * changes state or any SalonStaff status changes" — called after every mutation in this
   * service. One UPDATE per WAITING entry; fine at seeded-data queue sizes (see the plan's
   * concurrency-handling section for why this isn't batched further in V1.
   */
  async recomputeEtas(salonId: string): Promise<void> {
    const waiting = await this.prisma.queueEntry.findMany({
      where: { salonId, status: QueueEntryStatus.WAITING },
      orderBy: { joinedAt: 'asc' },
      include: { service: { select: { durationMinutes: true } } },
    });
    if (waiting.length === 0) return;

    const activeSessions = await this.prisma.serviceSession.findMany({
      where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
      select: {
        startedAt: true,
        service: { select: { durationMinutes: true } },
      },
    });
    const activeRemaining = this.averageRemainingMinutes(activeSessions);

    for (let i = 0; i < waiting.length; i++) {
      const entry = waiting[i];
      const peopleAhead = i;
      let serverCount: number;
      let avgServiceDurationMinutes: number;
      if (entry.serviceId) {
        serverCount = await this.availability.getSlotCapacity(
          this.prisma,
          salonId,
          entry.serviceId,
        );
        avgServiceDurationMinutes =
          entry.service?.durationMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES;
      } else {
        const [staffCount, chairCount] = await Promise.all([
          this.prisma.salonStaff.count({
            where: { salonId, status: StaffMemberStatus.ACTIVE },
          }),
          this.prisma.chair.count({
            where: { salonId, status: ChairStatus.ACTIVE },
          }),
        ]);
        serverCount = computeSlotCapacity(staffCount, chairCount);
        avgServiceDurationMinutes = DEFAULT_SERVICE_DURATION_MINUTES;
      }
      const eta = estimateWaitMinutes(
        serverCount,
        peopleAhead,
        avgServiceDurationMinutes,
        activeRemaining,
      );
      await this.prisma.queueEntry.update({
        where: { id: entry.id },
        data: { estimatedWaitMinutes: eta },
      });
    }
  }

  private async nextTokenNumber(
    tx: Prisma.TransactionClient,
    salonId: string,
  ): Promise<number> {
    // Same per-salon advisory-lock pattern as bookings.service.ts's slot-capacity transaction.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${salonId}))`,
    );
    const todayIst = utcToIstDateStr(new Date());
    const dayStart = istWallTimeToUtc(todayIst, '00:00');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
    const last = await tx.queueEntry.findFirst({
      where: { salonId, joinedAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { tokenNumber: 'desc' },
    });
    return (last?.tokenNumber ?? 0) + 1;
  }

  private async getEntryOrThrow(entryId: string) {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) {
      throw new AppException(
        QueueErrorCode.QUEUE_ENTRY_NOT_FOUND,
        'Queue entry not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return entry;
  }

  private async getDetailOrThrow(
    entryId: string,
  ): Promise<QueueEntryDetailDto> {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { id: entryId },
      include: queueEntryDetailInclude,
    });
    if (!entry) {
      throw new AppException(
        QueueErrorCode.QUEUE_ENTRY_NOT_FOUND,
        'Queue entry not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const position =
      entry.status === QueueEntryStatus.WAITING
        ? await this.computePosition(entry)
        : null;
    return this.toDetailDto(entry, position);
  }

  private toDetailDto(
    entry: QueueEntryWithDetails,
    position: number | null,
  ): QueueEntryDetailDto {
    return {
      id: entry.id,
      salonId: entry.salonId,
      bookingId: entry.bookingId,
      source: entry.source,
      tokenNumber: entry.tokenNumber,
      status: entry.status,
      assignedStaffId: entry.assignedStaffId,
      assignedChairId: entry.assignedChairId,
      estimatedWaitMinutes: entry.estimatedWaitMinutes,
      serviceId: entry.serviceId,
      serviceName: entry.service?.name ?? null,
      position,
      customerPhone: entry.customer?.phone ?? null,
      assignedStaffName: entry.assignedStaff?.displayName ?? null,
      assignedChairLabel: entry.assignedChair?.label ?? null,
      activeServiceSessionId: entry.serviceSessions[0]?.id ?? null,
      joinedAt: entry.joinedAt.toISOString(),
      calledAt: entry.calledAt?.toISOString() ?? null,
    };
  }
}

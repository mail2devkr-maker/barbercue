import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import {
  ChairStatus,
  OwnerOpsErrorCode,
  QueueEntrySource,
  QueueEntryStatus,
  QueueErrorCode,
  ServiceSessionStatus,
  StaffMemberStatus,
  type AutoAssignResultDto,
  type QueueBoardEntryNote,
  type QueueEntryDetailDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { AvailabilityService } from '../bookings/availability.service';
import { ReservationService } from '../bookings/reservation.service';
import { QueueService } from '../queue/queue.service';
import { QueueAutoAssignTrigger } from '../queue/queue-auto-assign.trigger';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { zonedDayBounds } from '../common/timezone/timezone';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';

const CONFLICT_CODES = new Set<string>([
  QueueErrorCode.STAFF_ALREADY_OCCUPIED,
  QueueErrorCode.CHAIR_ALREADY_OCCUPIED,
  QueueErrorCode.INVALID_QUEUE_TRANSITION,
  QueueErrorCode.STAFF_RESERVED_FOR_APPOINTMENT,
  QueueErrorCode.APPOINTMENT_STAFF_LOCKED,
  QueueErrorCode.CHAIR_INACTIVE,
  QueueErrorCode.CHAIR_NOT_FOUND,
]);

/** One waiting customer as the planner sees them. */
export interface PlannerEntry {
  id: string;
  /** Services that must ALL be performed by one barber. Empty = no service chosen yet. */
  serviceIds: string[];
  durationMinutes: number;
  /** A customer's explicit barber choice (booking preference or operator request), if any. */
  preferredStaffId: string | null;
  bookingId: string | null;
}

export interface PlannerStaff {
  id: string;
  displayName: string;
  qualifiedServiceIds: ReadonlySet<string>;
  /** Fair-distribution inputs: fewer services today first, then longest idle first. */
  completedToday: number;
  lastEndedAt: Date | null;
}

export interface PlannerChair {
  id: string;
  label: string;
}

export interface PlanOutcome {
  assignments: { entryId: string; staffId: string; chairId: string }[];
  skipped: QueueBoardEntryNote[];
}

/**
 * The allocation POLICY, kept free of I/O so it can be tested exhaustively. It decides who should
 * be offered which barber and chair; actually seating them is always done by QueueService.assign
 * (assignAsSystem for the automatic path), whose transactional claims are the real safety net - if
 * the world changed between planning and seating, the seating attempt is rejected and the customer
 * simply stays waiting.
 *
 * Rules (each backed by a test):
 *  - FIFO by join time; an entry that cannot be matched never blocks a later one that can.
 *  - never a barber who is busy, reserved, off duty, outside working hours, or lacking ANY of the
 *    entry's services;
 *  - a customer's explicit preferred barber is honored exactly: if that barber is not free the
 *    customer keeps waiting rather than receiving someone else;
 *  - among equally eligible barbers: fewest services today, then longest idle, then name (stable);
 *  - one barber and one chair per pass per customer; the pass stops when chairs run out.
 */
export async function planAllocation(input: {
  entries: PlannerEntry[];
  staff: PlannerStaff[];
  chairs: PlannerChair[];
  isStaffFree: (staffId: string, entry: PlannerEntry) => Promise<boolean>;
}): Promise<PlanOutcome> {
  const assignments: PlanOutcome['assignments'] = [];
  const skipped: QueueBoardEntryNote[] = [];
  const usedStaff = new Set<string>();
  const freeChairs = [...input.chairs];
  const staffById = new Map(input.staff.map((s) => [s.id, s]));

  for (const entry of input.entries) {
    if (freeChairs.length === 0) {
      skipped.push({
        entryId: entry.id,
        reason: 'All chairs are occupied right now.',
      });
      continue;
    }
    if (entry.serviceIds.length === 0) {
      skipped.push({
        entryId: entry.id,
        reason:
          'Choose a service for this customer before they can be assigned.',
      });
      continue;
    }

    const preferred = entry.preferredStaffId
      ? staffById.get(entry.preferredStaffId)
      : undefined;
    if (entry.preferredStaffId && !preferred) {
      skipped.push({
        entryId: entry.id,
        reason: 'Their requested barber is not on duty.',
      });
      continue;
    }
    const pool = preferred ? [preferred] : input.staff;
    const qualified = pool.filter(
      (s) =>
        !usedStaff.has(s.id) &&
        entry.serviceIds.every((id) => s.qualifiedServiceIds.has(id)),
    );
    if (qualified.length === 0) {
      skipped.push({
        entryId: entry.id,
        reason: preferred
          ? `Waiting for ${preferred.displayName}, who is not free or not qualified for this service.`
          : 'No on-duty barber is qualified for this service and free right now.',
      });
      continue;
    }

    const ordered = [...qualified].sort(
      (a, b) =>
        a.completedToday - b.completedToday ||
        (a.lastEndedAt?.getTime() ?? 0) - (b.lastEndedAt?.getTime() ?? 0) ||
        a.displayName.localeCompare(b.displayName) ||
        a.id.localeCompare(b.id),
    );
    let chosen: PlannerStaff | null = null;
    for (const candidate of ordered) {
      if (await input.isStaffFree(candidate.id, entry)) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      skipped.push({
        entryId: entry.id,
        reason: preferred
          ? `Waiting for ${preferred.displayName}, who is busy or booked for an appointment.`
          : 'Every qualified barber is busy or booked for an appointment.',
      });
      continue;
    }
    const chair = freeChairs.shift()!;
    usedStaff.add(chosen.id);
    assignments.push({
      entryId: entry.id,
      staffId: chosen.id,
      chairId: chair.id,
    });
  }
  return { assignments, skipped };
}

type Seater = (
  entryId: string,
  input: { staffId: string; chairId: string },
) => Promise<QueueEntryDetailDto>;

/**
 * Automatic and one-click barber/chair allocation.
 *
 * Product rule (owner decision, Oct 2026): ASSIGNING a barber and STARTING the service are two
 * different steps - WAITING -> ASSIGNED -> IN_SERVICE -> COMPLETED. Everything in this service only
 * ever ASSIGNS: it reserves a barber and a chair through the one transactional routine
 * (QueueService.assign with startService:false / assignAsSystem), leaving the customer "Assigned"
 * with no serviceStartedAt and no ServiceSession. The barber (or the owner) starts the service
 * explicitly with QueueService.startService.
 *
 * Allocation is still deliberately conservative about WHEN it fires:
 *  - the automatic pass (a per-shop setting, ON by default, which the owner can switch off) only ever
 *    considers customers who are physically present (`arrivedAt` set) - never a remote QR joiner who
 *    is still on the way;
 *  - the manual buttons ("Assign automatically", a barber's "Take next customer") are explicit human
 *    decisions, so they do not need the setting.
 * Every automatic assignment leaves a QUEUE_ENTRY_AUTO_ASSIGNED audit row.
 */
@Injectable()
export class QueueAutoAssignService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly availability: AvailabilityService,
    private readonly reservations: ReservationService,
    private readonly salonAccess: SalonAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly trigger: QueueAutoAssignTrigger,
  ) {}

  onModuleInit(): void {
    this.trigger.register(async (salonId) => {
      await this.runForSalon(salonId, {
        requireEnabled: true,
        seat: (id, i) => this.queue.assignAsSystem(id, i),
      });
    });
  }

  // ---------- Owner setting ----------

  async setAutomaticAssignment(
    userId: string,
    salonId: string,
    enabled: boolean,
  ): Promise<{ autoAssignEnabled: boolean }> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(
      userId,
      salonId,
    );
    await this.prisma.salon.update({
      where: { id: salonId },
      data: { queueAutoAssignEnabled: enabled },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: enabled
          ? 'QUEUE_AUTO_ASSIGN_ENABLED'
          : 'QUEUE_AUTO_ASSIGN_DISABLED',
        entityType: 'Salon',
        entityId: salonId,
        metadata: { actor },
      },
    });
    this.realtime.emitQueueUpdated(salonId);
    if (enabled) this.trigger.trigger(salonId);
    return { autoAssignEnabled: enabled };
  }

  /** The effective setting as stored on the server - the single source of truth for every client. */
  async getAutomaticAssignment(
    userId: string,
    salonId: string,
  ): Promise<{ autoAssignEnabled: boolean }> {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { queueAutoAssignEnabled: true },
    });
    if (!salon) {
      throw new AppException(
        QueueErrorCode.SALON_ACCESS_DENIED,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return { autoAssignEnabled: salon.queueAutoAssignEnabled };
  }

  // ---------- Manual, authorized entry points ----------

  /** "Assign automatically": one pass over everyone waiting, regardless of the opt-in. */
  async assignAllWaiting(
    userId: string,
    salonId: string,
  ): Promise<AutoAssignResultDto> {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    return this.runForSalon(salonId, {
      requireEnabled: false,
      includeNotArrived: true,
      seat: (id, i) => this.queue.assign(userId, id, { ...i, startService: false }),
    });
  }

  /** "Assign automatically" on ONE customer: picks the best free barber + chair and seats them. */
  async assignOne(
    userId: string,
    entryId: string,
  ): Promise<QueueEntryDetailDto> {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { id: entryId },
      select: { salonId: true, status: true },
    });
    if (!entry) {
      throw new AppException(
        QueueErrorCode.QUEUE_ENTRY_NOT_FOUND,
        'Queue entry not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.salonAccess.assertAccessOrAdminAccess(userId, entry.salonId);
    const result = await this.runForSalon(entry.salonId, {
      requireEnabled: false,
      includeNotArrived: true,
      onlyEntryId: entryId,
      seat: (id, i) => this.queue.assign(userId, id, { ...i, startService: false }),
    });
    if (result.assigned.length === 1) return this.detail(entryId);
    const reason =
      result.skipped.find((s) => s.entryId === entryId)?.reason ??
      'This customer cannot be assigned right now.';
    throw new AppException(
      reason.includes('chair')
        ? OwnerOpsErrorCode.NO_FREE_CHAIR
        : OwnerOpsErrorCode.NO_ELIGIBLE_BARBER,
      reason,
      HttpStatus.CONFLICT,
    );
  }

  /**
   * A barber's "Take next customer": the first waiting customer (FIFO) this barber may serve -
   * qualified for their services, not reserved for another barber, and physically present - is
   * ASSIGNED to THIS barber on a free chair. The barber, not the system, then decides to start.
   */
  async takeNext(
    userId: string,
    salonId: string,
  ): Promise<QueueEntryDetailDto> {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const me = await this.prisma.salonStaff.findFirst({
      where: {
        userId,
        salonId,
        status: StaffMemberStatus.ACTIVE,
        accessRevokedAt: null,
      },
      select: { id: true },
    });
    if (!me) {
      throw new AppException(
        QueueErrorCode.NOT_YOUR_STAFF_PROFILE,
        'Only an on-duty barber of this shop can take the next customer. Clock in first.',
        HttpStatus.FORBIDDEN,
      );
    }
    const [serving, holding] = await Promise.all([
      this.prisma.serviceSession.findFirst({
        where: { staffId: me.id, status: ServiceSessionStatus.ACTIVE },
        select: { id: true },
      }),
      this.prisma.queueEntry.findFirst({
        where: { salonId, status: QueueEntryStatus.CALLED, assignedStaffId: me.id },
        select: { id: true },
      }),
    ]);
    if (serving || holding) {
      throw new AppException(
        QueueErrorCode.STAFF_ALREADY_OCCUPIED,
        serving
          ? 'You are serving a customer. Complete that service first.'
          : 'You already have a customer assigned. Start their service first.',
        HttpStatus.CONFLICT,
      );
    }
    const result = await this.runForSalon(salonId, {
      requireEnabled: false,
      onlyStaffId: me.id,
      stopAfterFirst: true,
      seat: (id, i) => this.queue.assign(userId, id, { ...i, startService: false }),
    });
    const first = result.assigned[0];
    if (first) return this.detail(first.queueEntryId);
    throw new AppException(
      OwnerOpsErrorCode.NO_ELIGIBLE_BARBER,
      result.skipped[0]?.reason ??
        'No waiting customer who has arrived can be served by you right now.',
      HttpStatus.CONFLICT,
    );
  }

  // ---------- The pass ----------

  async runForSalon(
    salonId: string,
    options: {
      requireEnabled: boolean;
      seat: Seater;
      includeNotArrived?: boolean;
      onlyEntryId?: string;
      onlyStaffId?: string;
      stopAfterFirst?: boolean;
    },
  ): Promise<AutoAssignResultDto> {
    const empty: AutoAssignResultDto = { assigned: [], skipped: [] };
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        queueAutoAssignEnabled: true,
        status: true,
        isClosedForToday: true,
      },
    });
    if (!salon || (options.requireEnabled && !salon.queueAutoAssignEnabled))
      return empty;

    const waiting = await this.prisma.queueEntry.findMany({
      where: {
        salonId,
        status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED] },
        // A customer who already has a barber reserved is not planned again (reassigning is a
        // deliberate, explicit action).
        assignedStaffId: null,
        ...(options.includeNotArrived ? {} : { arrivedAt: { not: null } }),
        ...(options.onlyEntryId ? { id: options.onlyEntryId } : {}),
      },
      include: {
        service: { select: { id: true, durationMinutes: true } },
        booking: {
          select: {
            preferredStaffId: true,
            serviceId: true,
            service: {
              select: { name: true, durationMinutes: true, price: true },
            },
            services: {
              select: {
                serviceId: true,
                serviceName: true,
                durationMinutes: true,
                price: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    if (waiting.length === 0) return empty;

    const timeZone = await this.availability.getSalonTimeZone(salonId);
    const dayStart =
      (timeZone ? zonedDayBounds(new Date(), timeZone)?.start : null) ??
      new Date(Date.now() - 24 * 3_600_000);

    const [
      staffRows,
      chairRows,
      activeSessions,
      manualOccupancies,
      todaySessions,
      assignedHolds,
    ] = await Promise.all([
      this.prisma.salonStaff.findMany({
        where: {
          salonId,
          status: StaffMemberStatus.ACTIVE,
          accessRevokedAt: null,
          ...(options.onlyStaffId ? { id: options.onlyStaffId } : {}),
        },
        select: {
          id: true,
          displayName: true,
          services: { select: { serviceId: true } },
        },
      }),
      this.prisma.chair.findMany({
        where: { salonId, status: ChairStatus.ACTIVE },
        orderBy: { label: 'asc' },
        select: { id: true, label: true },
      }),
      this.prisma.serviceSession.findMany({
        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
        select: { staffId: true, chairId: true },
      }),
      this.prisma.manualChairOccupancy.findMany({
        where: { salonId, endedAt: null },
        select: { chairId: true },
      }),
      this.prisma.serviceSession.findMany({
        where: {
          status: ServiceSessionStatus.COMPLETED,
          endedAt: { gte: dayStart },
          chair: { salonId },
        },
        select: { staffId: true, endedAt: true },
      }),
      // Barbers and chairs already reserved for an assigned (not yet started) customer.
      this.prisma.queueEntry.findMany({
        where: {
          salonId,
          status: QueueEntryStatus.CALLED,
          assignedStaffId: { not: null },
        },
        select: { assignedStaffId: true, assignedChairId: true },
      }),
    ]);

    const busyStaff = new Set([
      ...activeSessions.map((s) => s.staffId),
      ...assignedHolds.map((h) => h.assignedStaffId as string),
    ]);
    const busyChairs = new Set([
      ...activeSessions.map((s) => s.chairId),
      ...manualOccupancies.map((m) => m.chairId),
      ...assignedHolds.map((h) => h.assignedChairId).filter((id): id is string => id !== null),
    ]);
    const doneByStaff = new Map<string, { count: number; last: Date | null }>();
    for (const row of todaySessions) {
      const cur = doneByStaff.get(row.staffId) ?? { count: 0, last: null };
      cur.count += 1;
      if (row.endedAt && (!cur.last || row.endedAt > cur.last))
        cur.last = row.endedAt;
      doneByStaff.set(row.staffId, cur);
    }

    const staff: PlannerStaff[] = staffRows
      .filter((s) => !busyStaff.has(s.id))
      .map((s) => ({
        id: s.id,
        displayName: s.displayName,
        qualifiedServiceIds: new Set(s.services.map((q) => q.serviceId)),
        completedToday: doneByStaff.get(s.id)?.count ?? 0,
        lastEndedAt: doneByStaff.get(s.id)?.last ?? null,
      }));
    const chairs = chairRows.filter((c) => !busyChairs.has(c.id));

    const entries: PlannerEntry[] = waiting.map((e) => {
      const bookingServices = e.booking
        ? resolveEffectiveBookingServices(e.booking)
        : [];
      const serviceIds = e.booking
        ? bookingServices.map((s) => s.serviceId)
        : e.serviceId
          ? [e.serviceId]
          : [];
      const durationMinutes = e.booking
        ? bookingServices.reduce((sum, s) => sum + s.durationMinutes, 0)
        : (e.service?.durationMinutes ?? 30);
      return {
        id: e.id,
        serviceIds,
        durationMinutes: Math.max(1, durationMinutes),
        preferredStaffId:
          e.source === QueueEntrySource.APPOINTMENT
            ? (e.booking?.preferredStaffId ?? null)
            : (e.preferredStaffId ?? null),
        bookingId: e.bookingId,
      };
    });

    const now = new Date();
    const plan = await planAllocation({
      entries,
      staff,
      chairs,
      isStaffFree: async (staffId, entry) => {
        const end = new Date(now.getTime() + entry.durationMinutes * 60_000);
        const check = await this.reservations.isStaffFreeForInterval(
          this.prisma,
          salonId,
          staffId,
          now,
          end,
          {
            excludeBookingId: entry.bookingId ?? undefined,
            excludeQueueEntryId: entry.id,
          },
        );
        if (!check.free) return false;
        try {
          await this.availability.assertStaffWithinWorkingHours(
            salonId,
            staffId,
            now,
            end,
          );
        } catch {
          return false;
        }
        return true;
      },
    });

    const result: AutoAssignResultDto = { assigned: [], skipped: plan.skipped };
    for (const planned of plan.assignments) {
      try {
        await options.seat(planned.entryId, {
          staffId: planned.staffId,
          chairId: planned.chairId,
        });
        result.assigned.push({
          queueEntryId: planned.entryId,
          staffId: planned.staffId,
          chairId: planned.chairId,
        });
        if (options.stopAfterFirst) break;
      } catch (err) {
        if (
          err instanceof AppException &&
          CONFLICT_CODES.has(String(err.code))
        ) {
          // The world moved between planning and seating (a concurrent assign, a new booking...).
          // The transactional claim refused it; the customer simply stays waiting.
          result.skipped.push({
            entryId: planned.entryId,
            reason: err.message,
          });
          continue;
        }
        throw err;
      }
    }
    return result;
  }

  private async detail(entryId: string): Promise<QueueEntryDetailDto> {
    const entry = await this.prisma.queueEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: {
        service: { select: { name: true } },
        customer: { select: { phone: true } },
        assignedStaff: { select: { displayName: true } },
        assignedChair: { select: { label: true } },
        serviceSessions: {
          where: { status: ServiceSessionStatus.ACTIVE },
          select: { id: true },
          take: 1,
        },
        booking: {
          select: {
            serviceId: true,
            service: {
              select: { name: true, durationMinutes: true, price: true },
            },
            services: {
              select: {
                serviceId: true,
                serviceName: true,
                durationMinutes: true,
                price: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
            preferredStaffId: true,
            preferredStaff: { select: { displayName: true } },
          },
        },
      },
    });
    return this.queue.toDetailDto(entry, null);
  }
}

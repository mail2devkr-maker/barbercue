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
  estimateWaitRangeMinutes,
  isWaitAlertWorthy,
  remainingSessionMinutes,
  TURN_APPROACHING_THRESHOLD_MINUTES,
  type AssignQueueEntryInput,
  type ReassignQueueEntryInput,
  type CapacitySummaryDto,
  type ChairOptionDto,
  type ServiceOptionDto,
  type DashboardQueueDto,
  type QueueEntryDetailDto,
  type QueueStatusDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { AvailabilityService } from '../bookings/availability.service';
import { ReservationService } from '../bookings/reservation.service';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';
import { zonedDayBounds } from '../common/timezone/timezone';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

// Allowed from 15 minutes before slotStart onward, no upper bound — the automatic no-show sweep
// that would otherwise cap lateness isn't built in this phase (see the plan's explicit scoping).
// Exported (Part 5 completion, arrival guidance): bookings.service.ts snapshots this exact value
// onto Booking.checkInOpensMinutesBefore at creation time, so a customer's "check in from HH:MM"
// guidance always matches what this service will actually accept — never a second, potentially
// drifting hardcoded copy.
export const EARLY_CHECKIN_WINDOW_MINUTES = 15;
// Same generous window as bookings.service.ts's TRANSACTION_OPTIONS, for the same reason (Neon
// serverless cold-start latency can exceed Prisma's default 5s interactive-transaction timeout).
const TRANSACTION_OPTIONS = { timeout: 15_000 };
// Used only when a queue entry has no service yet (an unspecified walk-in) — a reasonable
// salon-wide default rather than leaving the ETA uncomputed.
const DEFAULT_SERVICE_DURATION_MINUTES = 30;

// Selected on any QueueEntry.booking include so the combined (not just primary) service
// selection is always available for ETA/duration math and display — matches
// resolveEffectiveBookingServices' BookingWithServiceSnapshot shape exactly.
const bookingServiceSnapshotSelect = {
  serviceId: true,
  service: { select: { name: true, durationMinutes: true, price: true } },
  services: {
    select: { serviceId: true, serviceName: true, durationMinutes: true, price: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.BookingSelect;

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
  // Part 7 — preferredStaffId/preferredStaff alongside the existing service-snapshot fields, so
  // toDetailDto can surface the customer's own barber preference without a second query.
  booking: {
    select: { ...bookingServiceSnapshotSelect, preferredStaffId: true, preferredStaff: { select: { displayName: true } } },
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
    private readonly reservations: ReservationService,
    private readonly salonAccess: SalonAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
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
    return this.createArrivalQueueEntry(booking, customerId);
  }

  /**
   * P0 arrival-alert mission — the owner/staff-triggered twin of checkIn() above, reached from
   * the dashboard's ARRIVED confirmation instead of the customer's own self-check-in. Converges on
   * exactly the same QueueEntry-creation path (createArrivalQueueEntry), so a customer self-check-in
   * racing an operator's Mark Arrived click for the same booking can only ever produce one
   * QueueEntry — bookingId's unique index is the real backstop either way, matching requirement 9.
   */
  async arriveAsOperator(
    userId: string,
    bookingId: string,
  ): Promise<QueueEntryDetailDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.salonAccess.assertAccessOrAdminAccess(userId, booking.salonId);
    return this.createArrivalQueueEntry(booking, booking.customerId);
  }

  private async createArrivalQueueEntry(
    booking: {
      id: string;
      salonId: string;
      slotStart: Date;
      status: BookingStatus;
      serviceId: string;
    },
    customerId: string,
  ): Promise<QueueEntryDetailDto> {
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new AppException(
        QueueErrorCode.INVALID_QUEUE_TRANSITION,
        'Only a confirmed booking can be checked in.',
        HttpStatus.CONFLICT,
      );
    }

    const existingForBooking = await this.prisma.queueEntry.findFirst({
      where: { bookingId: booking.id },
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

    let entryId: string;
    try {
      entryId = await this.prisma.$transaction(async (tx) => {
        const tokenNumber = await this.nextTokenNumber(tx, booking.salonId);
        const created = await tx.queueEntry.create({
          data: {
            salonId: booking.salonId,
            bookingId: booking.id,
            customerId,
            serviceId: booking.serviceId,
            source: QueueEntrySource.APPOINTMENT,
            tokenNumber,
            status: QueueEntryStatus.WAITING,
            // An appointment entry only exists because arrival was confirmed — by the customer's
            // own check-in or the owner's ARRIVED confirmation — so it is arrived from the start.
            arrivedAt: new Date(),
          },
        });
        return created.id;
      }, TRANSACTION_OPTIONS);
    } catch (err) {
      // The pre-check above (existingForBooking) is a fast, friendly-error common case, not the
      // actual guarantee — it reads outside any lock, so two concurrent check-ins for the same
      // booking can both pass it before either commits. QueueEntry.bookingId's unique index is
      // the real backstop; a P2002 here means we lost that race, not a system failure.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new AppException(
          QueueErrorCode.ALREADY_CHECKED_IN,
          'This booking has already been checked in.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }

    await this.recomputeEtas(booking.salonId);
    this.realtime.emitQueueUpdated(booking.salonId);
    return this.getDetailOrThrow(entryId);
  }

  async joinWalkIn(
    customerId: string,
    salonId: string,
    serviceId?: string,
    contact?: { name?: string; phone?: string },
  ): Promise<QueueEntryDetailDto> {
    const salon = await this.availability.getSalonOrThrow(salonId);
    if (serviceId)
      await this.availability.getServiceOrThrow(salonId, serviceId);
    await this.assertNotAlreadyInQueue(customerId);

    // A queue entry must always be contactable by the shop. Prefer the number given with this join;
    // otherwise fall back to the account's own phone. Google-sign-in accounts have neither by
    // default, so refuse here rather than silently creating an entry nobody can reach.
    let contactPhone = contact?.phone ?? null;
    if (!contactPhone) {
      const account = await this.prisma.user.findUnique({
        where: { id: customerId },
        select: { phone: true },
      });
      contactPhone = account?.phone ?? null;
    }
    if (!contactPhone) {
      throw new AppException(
        QueueErrorCode.CONTACT_PHONE_REQUIRED,
        'A mobile number is required so the shop can reach you about your turn.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

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
          contactName: contact?.name ?? null,
          contactPhone,
        },
      });
      return created.id;
    }, TRANSACTION_OPTIONS);

    await this.recomputeEtas(salonId);
    this.realtime.emitQueueUpdated(salonId);
    await this.notifications.notify(
      salon.ownerUserId,
      'owner.walk_in.joined',
      { salonId },
      `dashboard/salons/${salonId}/queue`,
    );
    return this.getDetailOrThrow(entryId);
  }

  async getActiveForCustomer(
    customerId: string,
  ): Promise<QueueEntryDetailDto | null> {
    const existing = await this.prisma.queueEntry.findFirst({
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
      orderBy: { joinedAt: 'desc' },
    });
    if (!existing) return null;

    // Recompute on read, not only after a mutation elsewhere in the salon — a service quietly
    // overrunning its nominal duration would otherwise leave this customer staring at a stale
    // estimate until someone else's action happens to trigger a recompute (Phase 5's "don't
    // silently show stale times" requirement).
    if (existing.status === QueueEntryStatus.WAITING) {
      await this.recomputeEtas(existing.salonId);
    }

    const entry = await this.prisma.queueEntry.findUniqueOrThrow({
      where: { id: existing.id },
      include: queueEntryDetailInclude,
    });
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
    const [staffCount, chairCount, manualOccupiedCount, avgDuration, activeSessions] =
      await Promise.all([
        this.prisma.salonStaff.count({
          where: { salonId, status: StaffMemberStatus.ACTIVE },
        }),
        this.prisma.chair.count({
          where: { salonId, status: ChairStatus.ACTIVE },
        }),
        this.prisma.manualChairOccupancy.count({
          where: { salonId, endedAt: null },
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
    const serverCount = computeSlotCapacity(staffCount, Math.max(0, chairCount - manualOccupiedCount));
    const avgServiceDurationMinutes =
      avgDuration._avg.durationMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES;
    const activeRemaining = this.averageRemainingMinutes(activeSessions);
    const estimatedWaitMinutes = estimateWaitMinutes(
      serverCount,
      waitingCount,
      avgServiceDurationMinutes,
      activeRemaining,
    );
    return {
      salonId,
      waitingCount,
      estimatedWaitMinutes,
      estimatedWaitRangeMinutes: estimateWaitRangeMinutes(estimatedWaitMinutes),
    };
  }

  // ---------- Staff/owner dashboard ----------

  async getDashboardQueue(
    userId: string,
    salonId: string,
  ): Promise<DashboardQueueDto> {
    // Part 2 — delegated shop management. Read-only: no AuditLog write for a successful delegated
    // read, unlike the mutation methods below.
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);

    // Same freshness rationale as getActiveForCustomer above — the owner dashboard shouldn't show
    // a stale ETA for an overrunning service until some unrelated mutation happens to trigger one.
    await this.recomputeEtas(salonId);

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
    const [staffRoster, chairs, services, manualOccupancies, activeChairSessions] = await Promise.all([
      this.prisma.salonStaff.findMany({
        where: { salonId },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.chair.findMany({
        where: { salonId, status: ChairStatus.ACTIVE },
        orderBy: { label: 'asc' },
      }),
      // Lets the assign form offer a service picker for a walk-in that joined without choosing
      // one — assign() rejects with SERVICE_REQUIRED in that case, and this is the only source
      // the frontend has for "what services does this salon even offer."
      this.prisma.service.findMany({
        where: { salonId, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.manualChairOccupancy.findMany({
        where: { salonId, endedAt: null },
        select: { id: true, chairId: true },
      }),
      this.prisma.serviceSession.findMany({
        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
        select: { id: true, chairId: true, queueEntry: { select: { tokenNumber: true } }, staff: { select: { displayName: true } } },
      }),
    ]);

    const manualByChair = new Map(manualOccupancies.map((row) => [row.chairId, row]));
    const fastQueByChair = new Map(activeChairSessions.map((row) => [row.chairId, row]));

    // Part 9/18/19 — the derived, point-in-time answer to "can this person actually take a
    // customer right now," alongside (not instead of) their own working/clock-in `status`. Bounded
    // by this salon's own staff count (typically a handful), never an unbounded scan.
    const staffAvailability = await Promise.all(
      staffRoster.map((s) =>
        this.reservations.getStaffAvailabilityState(
          this.prisma,
          salonId,
          s.id,
          s.status === StaffMemberStatus.ACTIVE,
        ),
      ),
    );

    return {
      entries: detailed,
      staffRoster: staffRoster.map((s, i) => ({
        id: s.id,
        displayName: s.displayName,
        status: s.status,
        availabilityState: staffAvailability[i].availabilityState,
        busyUntil: staffAvailability[i].busyUntil?.toISOString() ?? null,
        nextBookingStart: staffAvailability[i].nextBookingStart?.toISOString() ?? null,
      })),
      chairs: chairs.map((c): ChairOptionDto => {
        const fastQue = fastQueByChair.get(c.id);
        const manual = manualByChair.get(c.id);
        return {
          id: c.id,
          label: c.label,
          occupancy: fastQue ? 'FASTQUE' : manual ? 'LOCAL' : 'FREE',
          manualOccupancyId: manual?.id ?? null,
          activeServiceSessionId: fastQue?.id ?? null,
          tokenNumber: fastQue?.queueEntry.tokenNumber ?? null,
          assignedStaffName: fastQue?.staff.displayName ?? null,
        };
      }),
      services: services.map((s): ServiceOptionDto => ({
        id: s.id,
        name: s.name,
      })),
    };
  }

  /**
   * Owner Capacity Dashboard (Phase 6) — a small, decision-oriented operational summary ("what do
   * I do right now"), not a historical/trend report (that's Phase 9's job). "Busy" chairs/staff
   * are whichever ones are attached to a currently-ACTIVE ServiceSession; "available" is
   * active-minus-busy. today/upcoming booking counts are computed in the salon's own IANA
   * timezone and come back null (not a fabricated 0) when it has none set — this is a live
   * operational snapshot, so the rest of it (chairs, staff, queue) stays usable either way rather
   * than failing the whole endpoint over an unset timezone.
   */
  async getCapacitySummary(
    userId: string,
    salonId: string,
  ): Promise<CapacitySummaryDto> {
    // Part 2 — delegated shop management. Read-only, same as getDashboardQueue above.
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);

    const timeZone = await this.availability.getSalonTimeZone(salonId);
    const bounds = timeZone ? zonedDayBounds(new Date(), timeZone) : null;
    const now = new Date();

    const [
      chairs,
      staff,
      activeSessions,
      activeManualOccupancies,
      reservedStaffRows,
      waitingCount,
      queueSize,
      waitingEstimates,
      todaysBookings,
      upcomingBookings,
    ] = await Promise.all([
      this.prisma.chair.findMany({
        where: { salonId },
        select: { id: true, status: true },
      }),
      this.prisma.salonStaff.findMany({
        where: { salonId },
        select: { id: true, status: true },
      }),
      this.prisma.serviceSession.findMany({
        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
        select: { chairId: true, staffId: true },
      }),
      this.prisma.manualChairOccupancy.findMany({
        where: { salonId, endedAt: null },
        select: { chairId: true },
      }),
      // Part 11 — a named barber whose appointment reservation is active RIGHT NOW must count as
      // busy even before any ServiceSession exists for them (e.g. the appointment hasn't checked
      // in yet, or checked in without staff having assigned a chair). Deduped against
      // activeSessions below via a Set, so a barber with both a reservation and an active session
      // for the same appointment is counted once, not twice.
      this.prisma.booking.findMany({
        where: {
          salonId,
          preferredStaffId: { not: null },
          ...this.reservations.reservingBookingWhere(),
          slotStart: { lt: new Date(now.getTime() + 1) },
          slotEnd: { gt: now },
        },
        select: { preferredStaffId: true },
      }),
      this.prisma.queueEntry.count({
        where: { salonId, status: QueueEntryStatus.WAITING },
      }),
      this.prisma.queueEntry.count({
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
      }),
      this.prisma.queueEntry.findMany({
        where: { salonId, status: QueueEntryStatus.WAITING },
        select: { estimatedWaitMinutes: true },
      }),
      bounds
        ? this.prisma.booking.count({
            where: {
              salonId,
              slotStart: { gte: bounds.start, lt: bounds.end },
            },
          })
        : Promise.resolve(null),
      bounds
        ? this.prisma.booking.count({
            where: {
              salonId,
              slotStart: { gte: bounds.end },
              status: {
                in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const busyChairIds = new Set([
      ...activeSessions.map((s) => s.chairId),
      ...activeManualOccupancies.map((s) => s.chairId),
    ]);
    const busyStaffIds = new Set([
      ...activeSessions.map((s) => s.staffId),
      ...reservedStaffRows.map((r) => r.preferredStaffId as string),
    ]);
    const activeChairs = chairs.filter((c) => c.status === ChairStatus.ACTIVE);
    const activeStaff = staff.filter(
      (s) => s.status === StaffMemberStatus.ACTIVE,
    );

    const estimates = waitingEstimates
      .map((e) => e.estimatedWaitMinutes)
      .filter((m): m is number => m !== null);
    const averageEstimatedWaitMinutes =
      estimates.length > 0
        ? Math.round(
            estimates.reduce((sum, m) => sum + m, 0) / estimates.length,
          )
        : null;

    return {
      chairs: {
        active: activeChairs.length,
        busy: activeChairs.filter((c) => busyChairIds.has(c.id)).length,
        available: activeChairs.filter((c) => !busyChairIds.has(c.id)).length,
        maintenance: chairs.filter((c) => c.status === ChairStatus.MAINTENANCE)
          .length,
        inactive: chairs.filter((c) => c.status === ChairStatus.INACTIVE)
          .length,
      },
      staff: {
        active: activeStaff.length,
        busy: activeStaff.filter((s) => busyStaffIds.has(s.id)).length,
        available: activeStaff.filter((s) => !busyStaffIds.has(s.id)).length,
        offDuty: staff.filter((s) => s.status === StaffMemberStatus.INACTIVE)
          .length,
      },
      currentServices: activeSessions.length,
      waitingCustomers: waitingCount,
      queueSize,
      averageEstimatedWaitMinutes,
      todaysBookings,
      upcomingBookings,
    };
  }

  async call(userId: string, entryId: string): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    const actor = await this.salonAccess.assertAccessOrAdminAccess(userId, entry.salonId);

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
    await this.logAdminQueueAction(actor, userId, 'ADMIN_QUEUE_ENTRY_CALLED', entryId, {
      salonId: entry.salonId,
    });

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitEntryCalled(entry.salonId, entryId, entry.customerId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  /**
   * Live Queue operations mission — staff/owner acknowledge that a queue customer is physically in
   * the shop. A remote or QR join does not prove presence, so it starts un-arrived; this records
   * the acknowledgement authoritatively (QueueEntry.arrivedAt) rather than as a UI-only label.
   * Idempotent: acknowledging an already-arrived entry returns it unchanged, and two staff
   * tapping at once converge on the first timestamp (the claim only ever fills a NULL).
   */
  async markArrived(userId: string, entryId: string): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    const actor = await this.salonAccess.assertAccessOrAdminAccess(userId, entry.salonId);

    if (
      entry.status !== QueueEntryStatus.WAITING &&
      entry.status !== QueueEntryStatus.CALLED
    ) {
      throw new AppException(
        QueueErrorCode.INVALID_QUEUE_TRANSITION,
        'Only a waiting or called entry can be marked arrived.',
        HttpStatus.CONFLICT,
      );
    }

    if (!entry.arrivedAt) {
      const claim = await this.prisma.queueEntry.updateMany({
        where: {
          id: entryId,
          arrivedAt: null,
          status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED] },
        },
        data: { arrivedAt: new Date() },
      });
      if (claim.count > 0) {
        await this.logAdminQueueAction(actor, userId, 'ADMIN_QUEUE_ENTRY_ARRIVED', entryId, {
          salonId: entry.salonId,
        });
        this.realtime.emitQueueUpdated(entry.salonId);
      } else {
        // Lost a race: either another operator acknowledged it first (fine — idempotent) or the
        // entry left the active states underneath us (a real conflict).
        const current = await this.prisma.queueEntry.findUnique({
          where: { id: entryId },
          select: { arrivedAt: true },
        });
        if (!current?.arrivedAt) {
          throw new AppException(
            QueueErrorCode.INVALID_QUEUE_TRANSITION,
            'This entry can no longer be marked arrived.',
            HttpStatus.CONFLICT,
          );
        }
      }
    }
    return this.getDetailOrThrow(entryId);
  }

  async assign(
    userId: string,
    entryId: string,
    input: AssignQueueEntryInput,
  ): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    const actor = await this.salonAccess.assertAccessOrAdminAccess(userId, entry.salonId);

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
    // Trusted server-side duration for the reservation-window guard below — never a client value.
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId: entry.salonId },
      select: { durationMinutes: true },
    });
    if (!service) {
      throw new AppException(
        BookingErrorCode.SERVICE_NOT_FOUND,
        'Service not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Part 7 — a customer who explicitly booked a specific barber must not silently receive a
    // different one through the same control a walk-in uses. Normal assignment on an
    // APPOINTMENT-sourced entry is locked to Booking.preferredStaffId when one is set; an
    // explicit override workflow is a deliberate, separately-audited follow-up (see this PR's
    // description), not implemented here.
    let preferredStaffId: string | null = null;
    if (entry.source === QueueEntrySource.APPOINTMENT && entry.bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: entry.bookingId },
        select: { preferredStaffId: true },
      });
      preferredStaffId = booking?.preferredStaffId ?? null;
    }
    if (preferredStaffId && preferredStaffId !== input.staffId) {
      throw new AppException(
        QueueErrorCode.APPOINTMENT_STAFF_LOCKED,
        'This appointment was booked with a specific barber. Assigning a different barber requires an explicit reassignment.',
        HttpStatus.CONFLICT,
      );
    }

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
      // Same per-salon lock key BookingsService.create/reschedule use (Part 6) — a concurrent
      // booking for this salon and this assign() now serialize against each other, so exactly one
      // of a competing "book Ramesh" vs "assign walk-in to Ramesh" can win instead of both reading
      // a stale reservation state.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${entry.salonId}))`);
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-chair:${input.chairId}`}))`);
      const manualOccupancy = await tx.manualChairOccupancy.findFirst({
        where: { chairId: input.chairId, endedAt: null },
        select: { id: true },
      });
      if (manualOccupancy) {
        throw new AppException(QueueErrorCode.CHAIR_ALREADY_OCCUPIED, 'This chair is occupied by a local customer.', HttpStatus.CONFLICT);
      }
      // Part 5 — a queue assignment starts service now; it must not consume a barber through an
      // interval that overlaps their own upcoming/current appointment reservation. This entry's
      // own linked booking (an appointment assigned to its own preferredStaffId — Case O) and its
      // own not-yet-existing session are excluded so an appointment can never conflict with itself.
      const now = new Date();
      const candidateEnd = new Date(now.getTime() + service.durationMinutes * 60_000);
      const staffCheck = await this.reservations.isStaffFreeForInterval(
        tx,
        entry.salonId,
        input.staffId,
        now,
        candidateEnd,
        { excludeBookingId: entry.bookingId ?? undefined, excludeQueueEntryId: entryId },
      );
      if (!staffCheck.free) {
        throw new AppException(
          QueueErrorCode.STAFF_RESERVED_FOR_APPOINTMENT,
          'This barber is reserved for an appointment during that time.',
          HttpStatus.CONFLICT,
        );
      }
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
          // Seating someone in a chair means they are physically in the shop: acknowledge arrival
          // implicitly (never overwriting an earlier explicit acknowledgement).
          ...(entry.arrivedAt ? {} : { arrivedAt: new Date() }),
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
    await this.logAdminQueueAction(actor, userId, 'ADMIN_QUEUE_ENTRY_ASSIGNED', entryId, {
      salonId: entry.salonId,
      staffId: input.staffId,
      chairId: input.chairId,
      serviceId,
    });

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitQueueUpdated(entry.salonId);

    const assignedStaff = await this.prisma.salonStaff.findUnique({
      where: { id: input.staffId },
      select: { userId: true },
    });
    if (assignedStaff) {
      await this.notifications.notify(
        assignedStaff.userId,
        'staff.assigned',
        { salonId: entry.salonId, queueEntryId: entryId },
        `dashboard/salons/${entry.salonId}/queue`,
      );
    }

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
    const actor = await this.salonAccess.assertAccessOrAdminAccess(userId, entry.salonId);
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
    // Same trusted server-side duration source assign() uses, for the reservation guard below.
    const service = await this.prisma.service.findFirst({
      where: { id: session.serviceId, salonId: entry.salonId },
      select: { durationMinutes: true },
    });
    if (!service) {
      throw new AppException(
        BookingErrorCode.SERVICE_NOT_FOUND,
        'Service not found.',
        HttpStatus.NOT_FOUND,
      );
    }

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
        // Part 5/6 — reassignment is a queue assignment too: moving this visit to a different
        // barber must not overlap that barber's own appointment reservation, and must serialize
        // against a concurrent booking for this salon the same way assign() does. reassign() is
        // itself the deliberate, explicit staff/owner action Part 7 asks for when a barber genuinely
        // needs to change ("Reassign appointment") — it is not locked to Booking.preferredStaffId.
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${entry.salonId}))`);
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-chair:${chairId}`}))`);
        if (staffId !== session.staffId) {
          const now = new Date();
          const candidateEnd = new Date(now.getTime() + service.durationMinutes * 60_000);
          const staffCheck = await this.reservations.isStaffFreeForInterval(
            tx,
            entry.salonId,
            staffId,
            now,
            candidateEnd,
            { excludeBookingId: entry.bookingId ?? undefined, excludeQueueEntryId: entryId },
          );
          if (!staffCheck.free) {
            throw new AppException(
              QueueErrorCode.STAFF_RESERVED_FOR_APPOINTMENT,
              'This barber is reserved for an appointment during that time.',
              HttpStatus.CONFLICT,
            );
          }
        }
        const manualOccupancy = await tx.manualChairOccupancy.findFirst({ where: { chairId, endedAt: null }, select: { id: true } });
        if (manualOccupancy) {
          throw new AppException(QueueErrorCode.CHAIR_ALREADY_OCCUPIED, 'This chair is occupied by a local customer.', HttpStatus.CONFLICT);
        }
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
    await this.logAdminQueueAction(actor, userId, 'ADMIN_QUEUE_ENTRY_REASSIGNED', entryId, {
      salonId: entry.salonId,
      staffId,
      chairId,
    });

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
    const actor = await this.salonAccess.assertAccessOrAdminAccess(
      userId,
      session.queueEntry.salonId,
    );

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
      //
      // FastQue Credits / Wallet V1: completing a service does NOT automatically grant the
      // customer any credit — an earlier version of this method did, which was a misreading of
      // the product rule (floor(price/50)*10 is a redemption CAP, not an earn rate) caught in
      // independent review before any production use. Credits only ever enter a wallet through an
      // authorized PROMO_GRANT (AdminCreditsController) or a redemption restoration
      // (CustomerCreditsService.restoreForCancelledBooking) — never from here.
      if (session.queueEntry.bookingId) {
        await tx.booking.update({
          where: { id: session.queueEntry.bookingId },
          data: { status: BookingStatus.COMPLETED },
        });
      }
    }, TRANSACTION_OPTIONS);
    await this.logAdminQueueAction(
      actor,
      userId,
      'ADMIN_QUEUE_SESSION_COMPLETED',
      session.queueEntryId,
      { salonId: session.queueEntry.salonId, sessionId },
    );

    await this.recomputeEtas(session.queueEntry.salonId);
    this.realtime.emitQueueUpdated(session.queueEntry.salonId);
    return this.getDetailOrThrow(session.queueEntryId);
  }

  async noShow(userId: string, entryId: string): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    const actor = await this.salonAccess.assertAccessOrAdminAccess(userId, entry.salonId);

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
    await this.logAdminQueueAction(actor, userId, 'ADMIN_QUEUE_ENTRY_NO_SHOW', entryId, {
      salonId: entry.salonId,
    });

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  async cancelByStaff(
    userId: string,
    entryId: string,
  ): Promise<QueueEntryDetailDto> {
    const entry = await this.getEntryOrThrow(entryId);
    const actor = await this.salonAccess.assertAccessOrAdminAccess(userId, entry.salonId);

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
    await this.logAdminQueueAction(actor, userId, 'ADMIN_QUEUE_ENTRY_CANCELLED', entryId, {
      salonId: entry.salonId,
    });

    await this.recomputeEtas(entry.salonId);
    this.realtime.emitQueueUpdated(entry.salonId);
    return this.getDetailOrThrow(entryId);
  }

  /** Recompute wait estimates + notify all owner/staff clients after a local chair changes. */
  async onChairOccupancyChanged(salonId: string): Promise<void> {
    await this.recomputeEtas(salonId);
    this.realtime.emitQueueUpdated(salonId);
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

  /** How many of the staff qualified for these services are in `reservationBusyStaffIds` — the
   * intersection ETA math needs to avoid promising a barber who is currently reservation-busy. */
  private async countReservationBusyQualifiedStaff(
    salonId: string,
    serviceIds: string[],
    reservationBusyStaffIds: Set<string>,
  ): Promise<number> {
    if (reservationBusyStaffIds.size === 0) return 0;
    const where = await this.availability.qualifiedStaffWhereForServices(this.prisma, salonId, serviceIds);
    const qualified = await this.prisma.salonStaff.findMany({ where, select: { id: true } });
    return qualified.filter((s) => reservationBusyStaffIds.has(s.id)).length;
  }

  private averageRemainingMinutes(
    sessions: { startedAt: Date; service: { durationMinutes: number } }[],
  ): number {
    if (sessions.length === 0) return 0;
    const now = Date.now();
    const remaining = sessions.map((s) =>
      remainingSessionMinutes(
        s.service.durationMinutes,
        (now - s.startedAt.getTime()) / 60_000,
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
      include: {
        service: { select: { durationMinutes: true } },
        booking: { select: bookingServiceSnapshotSelect },
      },
    });
    if (waiting.length === 0) return;

    const now = new Date();
    const [activeSessions, manualOccupiedCount, activeChairCount, reservedStaffRows] = await Promise.all([
      this.prisma.serviceSession.findMany({
        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
        select: { staffId: true, startedAt: true, service: { select: { durationMinutes: true } } },
      }),
      this.prisma.manualChairOccupancy.count({ where: { salonId, endedAt: null } }),
      this.prisma.chair.count({ where: { salonId, status: ChairStatus.ACTIVE } }),
      // Part 12 — a barber currently reservation-busy (an appointment window covering `now`) must
      // not be counted as an available server, even before any ServiceSession has started for
      // them. This is a present-instant, conservative signal (not a full future-interval
      // simulation — see this file's own header rationale for why that's deliberately out of
      // scope), which is what keeps a walk-in from being promised a barber who is mid-reservation.
      this.prisma.booking.findMany({
        where: {
          salonId,
          preferredStaffId: { not: null },
          ...this.reservations.reservingBookingWhere(),
          slotStart: { lt: new Date(now.getTime() + 1) },
          slotEnd: { gt: now },
        },
        select: { preferredStaffId: true },
      }),
    ]);
    const activeRemaining = this.averageRemainingMinutes(activeSessions);
    const availableOperationalChairs = Math.max(0, activeChairCount - manualOccupiedCount);
    // Deduped against activeSessions' own staff — a barber already reflected via activeRemaining
    // (an ACTIVE session, walk-in or the same appointment's own check-in) must not ALSO be
    // subtracted a second time as a separate reservation-busy unit.
    const activeSessionStaffIds = new Set(activeSessions.map((s) => s.staffId));
    const reservationBusyStaffIds = new Set(
      reservedStaffRows
        .map((r) => r.preferredStaffId as string)
        .filter((id) => !activeSessionStaffIds.has(id)),
    );

    for (let i = 0; i < waiting.length; i++) {
      const entry = waiting[i];
      const peopleAhead = i;
      let serverCount: number;
      let avgServiceDurationMinutes: number;
      if (entry.booking) {
        // Appointment-sourced entry — use the FULL selected service set (not just the legacy
        // primary Booking.serviceId) so a multi-service appointment's ETA reflects its true
        // combined duration and only counts staff qualified for every selected service.
        const effectiveServices = resolveEffectiveBookingServices(entry.booking);
        const serviceIds = effectiveServices.map((s) => s.serviceId);
        const configuredCapacity = await this.availability.getSlotCapacityForServices(
          this.prisma,
          salonId,
          serviceIds,
        );
        const reservationBusyCount = await this.countReservationBusyQualifiedStaff(
          salonId,
          serviceIds,
          reservationBusyStaffIds,
        );
        serverCount = Math.min(
          Math.max(0, configuredCapacity - reservationBusyCount),
          availableOperationalChairs,
        );
        avgServiceDurationMinutes = effectiveServices.reduce(
          (sum, s) => sum + s.durationMinutes,
          0,
        );
      } else if (entry.serviceId) {
        const configuredCapacity = await this.availability.getSlotCapacity(
          this.prisma,
          salonId,
          entry.serviceId,
        );
        const reservationBusyCount = await this.countReservationBusyQualifiedStaff(
          salonId,
          [entry.serviceId],
          reservationBusyStaffIds,
        );
        serverCount = Math.min(
          Math.max(0, configuredCapacity - reservationBusyCount),
          availableOperationalChairs,
        );
        avgServiceDurationMinutes =
          entry.service?.durationMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES;
      } else {
        const staffCount = await this.prisma.salonStaff.count({
          where: { salonId, status: StaffMemberStatus.ACTIVE },
        });
        const adjustedStaffCount = Math.max(0, staffCount - reservationBusyStaffIds.size);
        serverCount = computeSlotCapacity(adjustedStaffCount, availableOperationalChairs);
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

      // Customer-facing "turn approaching" / "wait changed a lot" alert (Phase 5) — a targeted
      // customer-room event, not the salon-wide queue.updated already emitted by every caller of
      // this method. Only entries with a real customer (an app-joined visit, not a walk-in the
      // owner logged for someone with no account) have anyone to alert. Comparing against
      // entry.estimatedWaitMinutes (the value fetched *before* this loop overwrote it) is what
      // makes this a real state-transition check, not a re-alert on every recompute cycle.
      if (
        entry.customerId &&
        isWaitAlertWorthy(entry.estimatedWaitMinutes, eta)
      ) {
        this.realtime.emitQueueEntryWaitAlert(
          salonId,
          entry.customerId,
          entry.id,
        );
        await this.notifications.notify(
          entry.customerId,
          'queue.turn_approaching',
          { salonId, queueEntryId: entry.id, estimatedWaitMinutes: eta },
        );
      }
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
    // Token numbering resets once per SALON-LOCAL day — a real, definite answer is required here
    // (unlike the read-only capacity summary above), so this throws rather than guessing IST for
    // a salon with no trustworthy timezone. A plain (non-transaction) read is fine: timezone is
    // effectively immutable within one request's lifetime.
    const timeZone = await this.availability.resolveTimeZoneOrThrow(salonId);
    const bounds = zonedDayBounds(new Date(), timeZone);
    if (!bounds) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Could not resolve today in this salon’s timezone.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const last = await tx.queueEntry.findFirst({
      where: { salonId, joinedAt: { gte: bounds.start, lt: bounds.end } },
      orderBy: { tokenNumber: 'desc' },
    });
    return (last?.tokenNumber ?? 0) + 1;
  }

  // Part 2 — delegated shop management. Called only after a queue mutation's core write has
  // already committed successfully (never inside the same transaction the write itself needs to
  // roll back cleanly on conflict) — a no-op for a real staff/owner actor, an AuditLog row with the
  // real admin actor otherwise.
  private async logAdminQueueAction(
    actor: 'STAFF_OR_OWNER' | 'PLATFORM_ADMIN',
    userId: string,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    if (actor !== 'PLATFORM_ADMIN') return;
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action,
        entityType: 'QueueEntry',
        entityId,
        metadata,
      },
    });
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
    // Appointment-sourced entries must show every selected service (e.g. "Haircut + Beard
    // Trim"), not just the legacy primary Booking.serviceId — a walk-in entry has no linked
    // booking and keeps showing its single directly-assigned service.
    const serviceName = entry.booking
      ? resolveEffectiveBookingServices(entry.booking)
          .map((s) => s.serviceName)
          .join(' + ')
      : (entry.service?.name ?? null);
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
      serviceName,
      position,
      customerPhone: entry.contactPhone ?? entry.customer?.phone ?? null,
      customerName: entry.contactName ?? null,
      arrivedAt: entry.arrivedAt?.toISOString() ?? null,
      assignedStaffName: entry.assignedStaff?.displayName ?? null,
      assignedChairLabel: entry.assignedChair?.label ?? null,
      preferredStaffId: entry.booking?.preferredStaffId ?? null,
      preferredStaffName: entry.booking?.preferredStaff?.displayName ?? null,
      activeServiceSessionId: entry.serviceSessions[0]?.id ?? null,
      joinedAt: entry.joinedAt.toISOString(),
      calledAt: entry.calledAt?.toISOString() ?? null,
      estimatedWaitRangeMinutes: estimateWaitRangeMinutes(
        entry.estimatedWaitMinutes,
      ),
      turnApproaching:
        entry.estimatedWaitMinutes !== null &&
        entry.estimatedWaitMinutes <= TURN_APPROACHING_THRESHOLD_MINUTES,
    };
  }
}

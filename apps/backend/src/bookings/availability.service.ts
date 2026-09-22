import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, Service } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  ChairStatus,
  MAX_SERVICES_PER_BOOKING,
  SalonStatus,
  ServiceSessionStatus,
  StaffMemberStatus,
  computeSlotCapacity,
  isSlotBookable,
  type AvailabilitySlotDto,
  type RecentActivityItemDto,
  type StaffOptionDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ReservationService } from './reservation.service';
import {
  resolveSalonTimeZone,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
  utcToZonedDateStr,
} from '../common/timezone/timezone';

// Every OperatingHours/StaffWorkingHours "HH:mm" and every `date=` query param is interpreted in
// the SALON's own IANA timezone (Salon.timezone, falling back to Asia/Kolkata only when the
// salon's city is in India — see resolveSalonTimeZone's own doc comment). A salon with neither an
// explicit timezone nor a resolvable India fallback cannot have its booking-critical time math
// validated safely, so every method below throws SALON_TIMEZONE_REQUIRED rather than silently
// guessing IST for a shop that might not even be in that zone.
const SLOT_GRANULARITY_MINUTES = 15;
const MAX_BOOKING_DAYS_AHEAD = 30;
// Issue #13 Mission H — the ticker's own "last 30 minutes" window.
const RECENT_ACTIVITY_WINDOW_MINUTES = 30;
const RECENT_ACTIVITY_LIMIT = 8;

// Exported so queue.service.ts (Phase 3C) can pass its own transaction client into the reused
// qualifiedStaffWhere/getSlotCapacity helpers below.
export type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationService,
  ) {}

  // Issue #13 Mission H — real, privacy-safe recent-activity signal for a salon's public profile
  // page. Deliberately anonymized (see RecentActivityItemDto's own doc comment for why: this
  // schema has no customer display-name field at all). Two independent, cheap, indexed-by-salonId
  // queries, merged and re-sorted in memory — no join, no per-row N+1.
  async getRecentActivity(salonId: string): Promise<RecentActivityItemDto[]> {
    const since = new Date(
      Date.now() - RECENT_ACTIVITY_WINDOW_MINUTES * 60_000,
    );
    const [bookings, queueEntries] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          salonId,
          status: BookingStatus.CONFIRMED,
          createdAt: { gte: since },
        },
        select: { createdAt: true, service: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
      this.prisma.queueEntry.findMany({
        where: { salonId, joinedAt: { gte: since } },
        select: { joinedAt: true, service: { select: { name: true } } },
        orderBy: { joinedAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
    ]);

    const items: RecentActivityItemDto[] = [
      ...bookings.map((b) => ({
        type: 'booking' as const,
        serviceName: b.service.name,
        occurredAt: b.createdAt.toISOString(),
      })),
      ...queueEntries.map((q) => ({
        type: 'queue' as const,
        serviceName: q.service?.name ?? null,
        occurredAt: q.joinedAt.toISOString(),
      })),
    ];
    items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return items.slice(0, RECENT_ACTIVITY_LIMIT);
  }

  async getSalonOrThrow(salonId: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon || salon.status !== SalonStatus.ACTIVE) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return salon;
  }

  /**
   * Resolves the IANA zone every OperatingHours/StaffWorkingHours wall-clock time in this salon
   * must be interpreted in, or null if none can be trusted (see resolveSalonTimeZone's own doc
   * comment). A minimal, indexed lookup — not a reuse of getSalonOrThrow's row — so callers that
   * already hold a full salon record don't pay for one they don't need. Public: queue.service.ts
   * (already injects this service) reuses it too, rather than re-implementing the same salon+city
   * lookup, for its own read-only "degrade to unknown, don't throw" call sites.
   */
  async getSalonTimeZone(salonId: string): Promise<string | null> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true, city: { select: { countryCode: true } } },
    });
    return salon
      ? resolveSalonTimeZone({
          timezone: salon.timezone,
          countryCode: salon.city.countryCode,
        })
      : null;
  }

  /** Booking-critical variant of getSalonTimeZone: throws SALON_TIMEZONE_REQUIRED rather than
   * ever falling back to a fixed IST offset for a salon outside India — see this file's own
   * header comment. Every booking-path caller needs a definite answer; read-only/display call
   * sites should call getSalonTimeZone directly instead and degrade to an honest unknown state. */
  async resolveTimeZoneOrThrow(salonId: string): Promise<string> {
    const zone = await this.getSalonTimeZone(salonId);
    if (!zone) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'This salon has not set a timezone yet, so bookings cannot be validated safely.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return zone;
  }

  async getServiceOrThrow(
    salonId: string,
    serviceId: string,
  ): Promise<Service> {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId, isActive: true },
    });
    if (!service) {
      throw new AppException(
        BookingErrorCode.SERVICE_NOT_FOUND,
        'Service not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return service;
  }

  /**
   * Multi-service booking core mission — the one place a candidate serviceIds[] is turned into
   * real, trusted Service rows. Never trusts client-supplied duration/price: every caller
   * downstream (availability, booking creation, reschedule) sums THESE rows' own durationMinutes/
   * price, never anything the client sent alongside the ids.
   *
   * Rejects, in this order:
   *  - more ids than MAX_SERVICES_PER_BOOKING (schema-level shape check already covers this for
   *    HTTP callers, but this is the real authority — any caller, HTTP or not, gets the same limit)
   *  - a duplicate id in the selection (DUPLICATE_SERVICE_SELECTION) — "the same service twice" is
   *    a well-formed but invalid combination, distinct from a missing/foreign/inactive one
   *  - any id that isn't an ACTIVE service belonging to this exact salon (SERVICE_NOT_FOUND) — a
   *    single generic reason, deliberately never distinguishing "wrong salon" from "inactive" from
   *    "doesn't exist" to an external caller, same as the existing single-service getServiceOrThrow
   *
   * Returns the matched services in the EXACT order serviceIds was given — Prisma's findMany gives
   * no ordering guarantee for an `id: { in: [...] }` filter, and selection order is meaningful
   * (Booking.serviceId / BookingService.sortOrder both key off "the first one requested").
   */
  async getServicesOrThrow(
    salonId: string,
    serviceIds: string[],
  ): Promise<Service[]> {
    if (serviceIds.length === 0 || serviceIds.length > MAX_SERVICES_PER_BOOKING) {
      throw new AppException(
        BookingErrorCode.SERVICE_NOT_FOUND,
        'Select at least one and no more than the maximum number of services.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (new Set(serviceIds).size !== serviceIds.length) {
      throw new AppException(
        BookingErrorCode.DUPLICATE_SERVICE_SELECTION,
        'The same service was selected more than once.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const services = await this.prisma.service.findMany({
      where: { id: { in: serviceIds }, salonId, isActive: true },
    });
    if (services.length !== serviceIds.length) {
      throw new AppException(
        BookingErrorCode.SERVICE_NOT_FOUND,
        'One or more selected services were not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const byId = new Map(services.map((s) => [s.id, s]));
    return serviceIds.map((id) => byId.get(id)!);
  }

  /**
   * DATABASE.md's StaffService rule: "If a salon has zero StaffService rows for a given service,
   * every ACTIVE staff member is treated as qualified for it."
   *
   * Not private: Phase 3C's queue.service.ts reuses this exact rule for live queue-assignment
   * qualification, so it isn't duplicated between booking-time and assignment-time checks.
   */
  async qualifiedStaffWhere(
    db: Db,
    salonId: string,
    serviceId: string,
  ): Promise<Prisma.SalonStaffWhereInput> {
    return this.qualifiedStaffWhereForServices(db, salonId, [serviceId]);
  }

  /**
   * Multi-service booking core mission — the "Any Staff" / capacity-pool qualification rule for a
   * COMPLETE multi-service appointment: a staff member counts as qualified only if they are
   * qualified for EVERY selected service, applying DATABASE.md's existing per-service "zero
   * StaffService rows means everyone qualifies" rule independently to each one first.
   *
   * This is a real AND, not an OR: for each service that DOES have at least one StaffService row
   * (i.e. the salon has deliberately restricted who can perform it), the where-clause requires a
   * separate `services: { some: { serviceId } }` match — one per such service — combined with
   * Prisma's implicit AND across array entries. A naive `services: { some: { serviceId: { in:
   * [...] } } }` would be WRONG here: it only requires the staff to be qualified for at least one
   * of the services, which would let a barber qualified for only 1 of 3 selected services pass.
   * Services with zero StaffService rows are correctly excluded from that AND entirely (nothing to
   * require) rather than accidentally requiring a StaffService row that was never meant to exist.
   */
  async qualifiedStaffWhereForServices(
    db: Db,
    salonId: string,
    serviceIds: string[],
  ): Promise<Prisma.SalonStaffWhereInput> {
    const base: Prisma.SalonStaffWhereInput = {
      salonId,
      status: StaffMemberStatus.ACTIVE,
    };
    const qualificationCounts = await Promise.all(
      serviceIds.map((serviceId) => db.staffService.count({ where: { serviceId } })),
    );
    const restrictedServiceIds = serviceIds.filter((_, i) => qualificationCounts[i] > 0);
    if (restrictedServiceIds.length === 0) return base;
    return {
      ...base,
      AND: restrictedServiceIds.map((serviceId) => ({
        services: { some: { serviceId } },
      })),
    };
  }

  async listQualifiedStaff(
    salonId: string,
    serviceId: string,
  ): Promise<StaffOptionDto[]> {
    return this.listQualifiedStaffForServices(salonId, [serviceId]);
  }

  async listQualifiedStaffForServices(
    salonId: string,
    serviceIds: string[],
  ): Promise<StaffOptionDto[]> {
    await this.getServicesOrThrow(salonId, serviceIds);
    const where = await this.qualifiedStaffWhereForServices(
      this.prisma,
      salonId,
      serviceIds,
    );
    const staff = await this.prisma.salonStaff.findMany({
      where,
      orderBy: { displayName: 'asc' },
    });
    return staff.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      photoUrl: s.photoUrl,
      bio: s.bio,
      yearsExperience: s.yearsExperience,
    }));
  }

  async assertStaffQualified(
    salonId: string,
    serviceId: string,
    staffId: string,
  ): Promise<void> {
    return this.assertStaffQualifiedForServices(salonId, [serviceId], staffId);
  }

  /**
   * A specific requested barber must be qualified for EVERY selected service, not merely one of
   * them — see qualifiedStaffWhereForServices's own doc comment. STAFF_NOT_QUALIFIED is thrown
   * exactly the same way whether the barber fails on one service or all of them; the error never
   * says which service(s) disqualified them, matching the existing single-service message's level
   * of detail.
   */
  async assertStaffQualifiedForServices(
    salonId: string,
    serviceIds: string[],
    staffId: string,
  ): Promise<void> {
    const where = await this.qualifiedStaffWhereForServices(
      this.prisma,
      salonId,
      serviceIds,
    );
    const qualified = await this.prisma.salonStaff.findFirst({
      where: { ...where, id: staffId },
    });
    if (qualified) return;

    const exists = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
    });
    if (!exists) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    throw new AppException(
      BookingErrorCode.STAFF_NOT_QUALIFIED,
      'This staff member is not qualified for every selected service.',
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Same intersection-of-hours check getAvailability applies when generating the slot grid, but
   * re-validated authoritatively at the moment a booking with a specific preferredStaffId is
   * actually created/rescheduled — a client could otherwise request a slot outside that barber's
   * configured hours without ever calling getAvailability first. A no-op when the barber has no
   * configured working hours (the "unrestricted" default).
   */
  async assertStaffWithinWorkingHours(
    salonId: string,
    staffId: string,
    slotStart: Date,
    slotEnd: Date,
  ): Promise<void> {
    const timeZone = await this.resolveTimeZoneOrThrow(salonId);
    const dateStr = utcToZonedDateStr(slotStart, timeZone);
    const dayOfWeek = zonedDateToDayOfWeek(dateStr);
    const staffHours = await this.prisma.staffWorkingHours.findUnique({
      where: { staffId_dayOfWeek: { staffId, dayOfWeek } },
    });
    if (!staffHours) return;
    const openAt = !staffHours.isClosed
      ? zonedWallTimeToUtc(dateStr, staffHours.openTime, timeZone)
      : null;
    const closeAt = !staffHours.isClosed
      ? zonedWallTimeToUtc(dateStr, staffHours.closeTime, timeZone)
      : null;
    if (!openAt || !closeAt || slotStart < openAt || slotEnd > closeAt) {
      throw new AppException(
        BookingErrorCode.OUTSIDE_OPERATING_HOURS,
        'This barber is not working at the requested time.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /** DATABASE.md's capacity model: slotCapacity = min(qualifiedStaffPool, activeChairPool). */
  async getSlotCapacity(
    db: Db,
    salonId: string,
    serviceId: string,
  ): Promise<number> {
    return this.getSlotCapacityForServices(db, salonId, [serviceId]);
  }

  /**
   * Multi-service booking core mission — the same capacity model, but the qualified-staff pool is
   * now the set of staff qualified for the COMPLETE selection (see
   * qualifiedStaffWhereForServices). Chair capacity is unaffected by which/how many services were
   * selected — one appointment still occupies exactly one chair for its whole duration regardless
   * of how many services make it up.
   */
  async getSlotCapacityForServices(
    db: Db,
    salonId: string,
    serviceIds: string[],
  ): Promise<number> {
    const where = await this.qualifiedStaffWhereForServices(db, salonId, serviceIds);
    const [qualifiedStaffCount, chairCount] = await Promise.all([
      db.salonStaff.count({ where }),
      db.chair.count({ where: { salonId, status: ChairStatus.ACTIVE } }),
    ]);
    return computeSlotCapacity(qualifiedStaffCount, chairCount);
  }

  /**
   * Used by booking creation (not just the day-grid `getAvailability` view above) — a slot must
   * start and end entirely within that IST calendar day's OperatingHours window.
   */
  async assertWithinOperatingHours(
    salonId: string,
    slotStart: Date,
    slotEnd: Date,
  ): Promise<void> {
    const timeZone = await this.resolveTimeZoneOrThrow(salonId);
    const dateStr = utcToZonedDateStr(slotStart, timeZone);
    const dayOfWeek = zonedDateToDayOfWeek(dateStr);
    const hours = await this.prisma.operatingHours.findUnique({
      where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
    });
    const openAt =
      hours && !hours.isClosed
        ? zonedWallTimeToUtc(dateStr, hours.openTime, timeZone)
        : null;
    const closeAt =
      hours && !hours.isClosed
        ? zonedWallTimeToUtc(dateStr, hours.closeTime, timeZone)
        : null;
    if (!openAt || !closeAt || slotStart < openAt || slotEnd > closeAt) {
      throw new AppException(
        BookingErrorCode.OUTSIDE_OPERATING_HOURS,
        'The salon is closed at the requested time.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /**
   * Candidate slots at a fixed 15-minute granularity across the day's OperatingHours window,
   * skipping isClosed days entirely and any slot whose end would cross closing time. `staffId` is
   * optional; when supplied it narrows the window (qualification/active status checked as before,
   * and if that barber has configured personal working hours (StaffWorkingHours) for this day, the
   * returned slots are additionally clipped to the intersection of shop hours and that barber's
   * hours, or emptied entirely if they're off — a barber with no configured hours is unaffected,
   * same "0 rows = unrestricted" fallback qualifiedStaffWhere already uses for StaffService) AND
   * makes that specific barber's own exclusivity authoritative: a slot where the pool has spare
   * capacity is still marked unavailable if this exact barber already holds a conflicting booking.
   * "Any Staff" (no staffId) is unaffected by this and continues to reflect pool capacity alone —
   * see BookingsService.create()/reschedule(), which enforce the identical rule at write time so
   * the grid a customer sees here can never disagree with what booking actually allows.
   */
  async getAvailability(
    salonId: string,
    serviceIds: string[],
    date: string,
    staffId?: string,
  ): Promise<AvailabilitySlotDto[]> {
    await this.getSalonOrThrow(salonId);
    // Multi-service booking core mission — the candidate interval a slot must fit is the SUM of
    // every selected service's duration, never just one of them. Loaded via getServicesOrThrow so
    // an unknown/foreign-salon/inactive/duplicate id is rejected here, before any slot math runs,
    // exactly as it was for a single serviceId.
    const services = await this.getServicesOrThrow(salonId, serviceIds);
    if (staffId) await this.assertStaffQualifiedForServices(salonId, serviceIds, staffId);
    const timeZone = await this.resolveTimeZoneOrThrow(salonId);

    const now = new Date();
    const maxAdvance = new Date(
      now.getTime() + MAX_BOOKING_DAYS_AHEAD * 24 * 60 * 60_000,
    );
    // `date` is the requested SALON-LOCAL calendar day (never IST-fixed) — if midnight itself
    // falls in a DST spring-forward gap for this zone, there is no honest instant to return, so
    // the day is treated as having no slots rather than guessing.
    const dayStart = zonedWallTimeToUtc(date, '00:00', timeZone);
    if (!dayStart || dayStart > maxAdvance) return [];

    const dayOfWeek = zonedDateToDayOfWeek(date);
    const hours = await this.prisma.operatingHours.findUnique({
      where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
    });
    if (!hours || hours.isClosed) return [];

    let openAt = zonedWallTimeToUtc(date, hours.openTime, timeZone);
    let closeAt = zonedWallTimeToUtc(date, hours.closeTime, timeZone);
    if (!openAt || !closeAt) return [];

    if (staffId) {
      const staffHours = await this.prisma.staffWorkingHours.findUnique({
        where: { staffId_dayOfWeek: { staffId, dayOfWeek } },
      });
      if (staffHours) {
        if (staffHours.isClosed) return [];
        const staffOpenAt = zonedWallTimeToUtc(
          date,
          staffHours.openTime,
          timeZone,
        );
        const staffCloseAt = zonedWallTimeToUtc(
          date,
          staffHours.closeTime,
          timeZone,
        );
        if (!staffOpenAt || !staffCloseAt) return [];
        openAt = openAt > staffOpenAt ? openAt : staffOpenAt;
        closeAt = closeAt < staffCloseAt ? closeAt : staffCloseAt;
        if (openAt >= closeAt) return [];
      }
    }

    const totalDurationMinutes = services.reduce((sum, s) => sum + s.durationMinutes, 0);
    const durationMs = totalDurationMinutes * 60_000;
    const slotCapacity = await this.getSlotCapacityForServices(
      this.prisma,
      salonId,
      serviceIds,
    );

    // Booking/queue resource-reservation mission — reservingBookingWhere() (CONFIRMED,
    // PENDING_PAYMENT, and now COMPLETED) replaces the old [CONFIRMED, PENDING_PAYMENT]-only
    // filter: a COMPLETED appointment whose service finished early must still occupy its slot
    // grid cells through its original slotEnd (see ReservationService's own header comment for
    // why). The per-slot overlap filter below is what naturally stops a COMPLETED booking from
    // blocking anything once real time passes its slotEnd — no separate cutoff needed.
    const overlapCandidates = await this.prisma.booking.findMany({
      where: {
        salonId,
        ...this.reservations.reservingBookingWhere(),
        slotStart: { lt: closeAt },
        slotEnd: { gt: openAt },
      },
      select: { slotStart: true, slotEnd: true, preferredStaffId: true },
    });
    // Part 3/4 — an ACTIVE ServiceSession (walk-in or appointment check-in) is a second, separate
    // reservation source layered on top of Booking rows: a barber (or the pool) currently serving
    // someone is truly occupied even though that fact may not exist as a future Booking row at
    // all (a walk-in has none). Fetched once for the whole day-grid request — bounded by this
    // salon's chair count, never an unbounded scan — and filtered in memory per slot exactly like
    // overlapCandidates above, so this stays O(chairs) DB work regardless of how many 15-minute
    // slots the day produces.
    const activeSessions = await this.prisma.serviceSession.findMany({
      where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },
      select: {
        staffId: true,
        startedAt: true,
        service: { select: { durationMinutes: true } },
        queueEntry: { select: { bookingId: true } },
      },
    });
    const projectedSessions = activeSessions.map((s) => ({
      staffId: s.staffId,
      isWalkIn: s.queueEntry.bookingId === null,
      start: s.startedAt,
      end: this.reservations.projectedActiveSessionEnd(s.startedAt, s.service.durationMinutes, now),
    }));

    const slots: AvailabilitySlotDto[] = [];
    for (
      let slotStart = openAt;
      slotStart.getTime() + durationMs <= closeAt.getTime();
      slotStart = new Date(
        slotStart.getTime() + SLOT_GRANULARITY_MINUTES * 60_000,
      )
    ) {
      if (slotStart <= now) continue;
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      const overlappingBookings = overlapCandidates.filter(
        (b) => b.slotStart < slotEnd && b.slotEnd > slotStart,
      );
      // A genuine walk-in session (no linked booking) is a real pool unit not otherwise
      // represented above; an appointment's own check-in session is already counted via its
      // Booking row and would double-count the same reservation if included here too.
      const overlappingWalkInSessions = projectedSessions.filter(
        (s) => s.isWalkIn && this.reservations.intervalsOverlap(s.start, s.end, slotStart, slotEnd),
      );
      // Pool capacity governs "Any Staff" bookability regardless of who holds each overlapping
      // slot. A specific requested staffId additionally needs that exact professional free — the
      // pool could have room while that one named barber is already taken, and vice versa.
      const staffTaken =
        !!staffId &&
        (overlappingBookings.some((b) => b.preferredStaffId === staffId) ||
          projectedSessions.some(
            (s) => s.staffId === staffId && this.reservations.intervalsOverlap(s.start, s.end, slotStart, slotEnd),
          ));
      const consumed = overlappingBookings.length + overlappingWalkInSessions.length;
      const available = isSlotBookable(slotCapacity, consumed) && !staffTaken;
      slots.push({
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        available,
        state: available ? 'AVAILABLE' : 'OCCUPIED',
      });
    }
    return slots;
  }
}

export { MAX_BOOKING_DAYS_AHEAD };

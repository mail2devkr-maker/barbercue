import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, Service } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  ChairStatus,
  SalonStatus,
  StaffMemberStatus,
  computeSlotCapacity,
  isSlotBookable,
  type AvailabilitySlotDto,
  type StaffOptionDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
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

// Exported so queue.service.ts (Phase 3C) can pass its own transaction client into the reused
// qualifiedStaffWhere/getSlotCapacity helpers below.
export type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

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
    const qualificationCount = await db.staffService.count({
      where: { serviceId },
    });
    const base: Prisma.SalonStaffWhereInput = {
      salonId,
      status: StaffMemberStatus.ACTIVE,
    };
    return qualificationCount === 0
      ? base
      : { ...base, services: { some: { serviceId } } };
  }

  async listQualifiedStaff(
    salonId: string,
    serviceId: string,
  ): Promise<StaffOptionDto[]> {
    await this.getServiceOrThrow(salonId, serviceId);
    const where = await this.qualifiedStaffWhere(
      this.prisma,
      salonId,
      serviceId,
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
    const where = await this.qualifiedStaffWhere(
      this.prisma,
      salonId,
      serviceId,
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
      'This staff member is not qualified for the selected service.',
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
    const openAt =
      !staffHours.isClosed
        ? zonedWallTimeToUtc(dateStr, staffHours.openTime, timeZone)
        : null;
    const closeAt =
      !staffHours.isClosed
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
    const where = await this.qualifiedStaffWhere(db, salonId, serviceId);
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
   * optional; per the soft-preference decision (DATABASE.md) it never changes the *pool capacity*
   * math (that stays min(qualifiedStaffCount, activeChairCount) regardless of which specific staff
   * are scheduled) — but Phase 7 narrows the window itself when a specific barber is requested:
   * qualification/active status is checked as before, and if that barber has configured personal
   * working hours (StaffWorkingHours) for this day, the returned slots are additionally clipped to
   * the intersection of shop hours and that barber's hours (or emptied entirely if they're off).
   * A barber with no configured hours is unaffected — same "0 rows = unrestricted" fallback
   * qualifiedStaffWhere already uses for StaffService.
   */
  async getAvailability(
    salonId: string,
    serviceId: string,
    date: string,
    staffId?: string,
  ): Promise<AvailabilitySlotDto[]> {
    await this.getSalonOrThrow(salonId);
    const service = await this.getServiceOrThrow(salonId, serviceId);
    if (staffId) await this.assertStaffQualified(salonId, serviceId, staffId);
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
        const staffOpenAt = zonedWallTimeToUtc(date, staffHours.openTime, timeZone);
        const staffCloseAt = zonedWallTimeToUtc(date, staffHours.closeTime, timeZone);
        if (!staffOpenAt || !staffCloseAt) return [];
        openAt = openAt > staffOpenAt ? openAt : staffOpenAt;
        closeAt = closeAt < staffCloseAt ? closeAt : staffCloseAt;
        if (openAt >= closeAt) return [];
      }
    }

    const durationMs = service.durationMinutes * 60_000;
    const slotCapacity = await this.getSlotCapacity(
      this.prisma,
      salonId,
      serviceId,
    );

    const overlapCandidates = await this.prisma.booking.findMany({
      where: {
        salonId,
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
        },
        slotStart: { lt: closeAt },
        slotEnd: { gt: openAt },
      },
      select: { slotStart: true, slotEnd: true, preferredStaffId: true },
    });

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
      const overlappingHere = overlapCandidates.filter(
        (b) => b.slotStart < slotEnd && b.slotEnd > slotStart,
      );
      // Pool capacity governs "Any Staff" bookability regardless of who holds each overlapping
      // slot. A *specific* requested staffId additionally needs that exact professional free —
      // the pool could have room while that one named barber is already taken, and vice versa.
      const staffTaken =
        !!staffId && overlappingHere.some((b) => b.preferredStaffId === staffId);
      const available =
        isSlotBookable(slotCapacity, overlappingHere.length) && !staffTaken;
      slots.push({
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        available,
      });
    }
    return slots;
  }
}

export { MAX_BOOKING_DAYS_AHEAD };

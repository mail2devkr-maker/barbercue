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

// V1 is India-only (Razorpay/INR throughout DATABASE.md/PAYMENTS.md) and Salon/OperatingHours have
// no timezone field — a deliberate, explicitly-stated assumption, not a silent pick: every
// OperatingHours "HH:mm" and every `date=` query param is interpreted as Asia/Kolkata wall-clock
// time, a fixed +05:30 offset with no DST.
const IST_OFFSET_MINUTES = 330;
const SLOT_GRANULARITY_MINUTES = 15;
const MAX_BOOKING_DAYS_AHEAD = 30;

// Exported so queue.service.ts (Phase 3C) can pass its own transaction client into the reused
// qualifiedStaffWhere/getSlotCapacity helpers below.
export type Db = PrismaService | Prisma.TransactionClient;

function istWallTimeToUtc(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * 60_000,
  );
}

function istDateToDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Inverse of istWallTimeToUtc's date component — which IST calendar day does this instant fall on. */
function utcToIstDateStr(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
    return staff.map((s) => ({ id: s.id, displayName: s.displayName }));
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
    const dateStr = utcToIstDateStr(slotStart);
    const dayOfWeek = istDateToDayOfWeek(dateStr);
    const hours = await this.prisma.operatingHours.findUnique({
      where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
    });
    const openAt =
      hours && !hours.isClosed
        ? istWallTimeToUtc(dateStr, hours.openTime)
        : null;
    const closeAt =
      hours && !hours.isClosed
        ? istWallTimeToUtc(dateStr, hours.closeTime)
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
   * optional and, per the soft-preference decision (DATABASE.md), only validated for
   * qualification/active status — it never changes which slots come back.
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

    const now = new Date();
    const maxAdvance = new Date(
      now.getTime() + MAX_BOOKING_DAYS_AHEAD * 24 * 60 * 60_000,
    );
    const dayStart = istWallTimeToUtc(date, '00:00');
    if (dayStart > maxAdvance) return [];

    const dayOfWeek = istDateToDayOfWeek(date);
    const hours = await this.prisma.operatingHours.findUnique({
      where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
    });
    if (!hours || hours.isClosed) return [];

    const openAt = istWallTimeToUtc(date, hours.openTime);
    const closeAt = istWallTimeToUtc(date, hours.closeTime);
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
      select: { slotStart: true, slotEnd: true },
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
      const consumed = overlapCandidates.filter(
        (b) => b.slotStart < slotEnd && b.slotEnd > slotStart,
      ).length;
      slots.push({
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        available: isSlotBookable(slotCapacity, consumed),
      });
    }
    return slots;
  }
}

export {
  istWallTimeToUtc,
  istDateToDayOfWeek,
  utcToIstDateStr,
  MAX_BOOKING_DAYS_AHEAD,
};

import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  type SetStaffWorkingHoursInput,
  type StaffWorkingHoursDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

// Shown for a day this barber has never configured. Unlike SalonOperatingHoursService's UNSET_DAY
// (deliberately CLOSED — a shop that never sets hours has no bookable slots), this defaults to
// unrestricted: a barber most owners never touch this screen for should keep working their normal
// shop hours, not silently vanish from every slot. `configured: false` is the real signal a client
// should branch on; openTime/closeTime here are just a sensible starting point for the editor.
const UNSET_DAY: Omit<StaffWorkingHoursDto, 'dayOfWeek'> = {
  openTime: '00:00',
  closeTime: '23:59',
  isClosed: false,
  configured: false,
};

/**
 * Owner-side per-barber working hours (Phase 7) — an optional refinement layer on top of the
 * salon's own OperatingHours. Same shape/rationale as SalonOperatingHoursService (whole week
 * replaced in one call, upserted rather than delete-then-insert), scoped to one staffId within one
 * salon rather than the salon itself.
 */
@Injectable()
export class StaffWorkingHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  private async assertStaffInSalon(
    salonId: string,
    staffId: string,
  ): Promise<void> {
    const staff = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
    });
    if (!staff) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /** Always returns exactly 7 entries, ordered Sunday..Saturday, so the UI has a stable shape. */
  async list(
    userId: string,
    salonId: string,
    staffId: string,
  ): Promise<StaffWorkingHoursDto[]> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    await this.assertStaffInSalon(salonId, staffId);

    const rows = await this.prisma.staffWorkingHours.findMany({
      where: { staffId },
    });
    const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
    return DAYS_OF_WEEK.map((dayOfWeek) => {
      const row = byDay.get(dayOfWeek);
      return row
        ? {
            dayOfWeek,
            openTime: row.openTime,
            closeTime: row.closeTime,
            isClosed: row.isClosed,
            configured: true,
          }
        : { dayOfWeek, ...UNSET_DAY };
    });
  }

  async set(
    userId: string,
    salonId: string,
    staffId: string,
    input: SetStaffWorkingHoursInput,
  ): Promise<StaffWorkingHoursDto[]> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    await this.assertStaffInSalon(salonId, staffId);

    await this.prisma.$transaction(
      input.days.map((day) =>
        this.prisma.staffWorkingHours.upsert({
          where: { staffId_dayOfWeek: { staffId, dayOfWeek: day.dayOfWeek } },
          update: {
            openTime: day.openTime,
            closeTime: day.closeTime,
            isClosed: day.isClosed,
          },
          create: {
            staffId,
            dayOfWeek: day.dayOfWeek,
            openTime: day.openTime,
            closeTime: day.closeTime,
            isClosed: day.isClosed,
          },
        }),
      ),
    );

    return this.list(userId, salonId, staffId);
  }
}

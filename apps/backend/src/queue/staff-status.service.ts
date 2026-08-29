import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  QueueErrorCode,
  Role,
  type AuthenticatedUser,
  type StaffMemberStatus,
  type StaffStatusDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/**
 * PATCH /dashboard/staff/:id/status — "clock-in/break/clock-out" per API.md's notes column. The
 * existing StaffMemberStatus enum only has ACTIVE/INACTIVE (no schema change here per the plan);
 * "clock-in" maps to ACTIVE, "break" and "clock-out" both map to INACTIVE — a deliberate V1
 * simplification, not a bug (see PROJECT_STRUCTURE.md/DATABASE.md deltas for this phase).
 */
@Injectable()
export class StaffStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async updateStatus(
    actor: AuthenticatedUser,
    staffId: string,
    status: StaffMemberStatus,
  ): Promise<StaffStatusDto> {
    const staff = await this.prisma.salonStaff.findUnique({
      where: { id: staffId },
    });
    if (!staff) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (staff.userId !== actor.id) {
      if (!actor.roles.includes(Role.SALON_OWNER)) {
        throw new AppException(
          QueueErrorCode.NOT_YOUR_STAFF_PROFILE,
          'You can only update your own clock-in status.',
          HttpStatus.FORBIDDEN,
        );
      }
      // A global SALON_OWNER role is not enough: someone may own salon A while being ordinary
      // staff at salon B. Updating another barber at B therefore requires an owner membership
      // specifically for B, not SalonAccessService's broader owner-or-staff check.
      await this.salonAccess.assertOwnerAccess(actor.id, staff.salonId);
    } else if (
      !actor.roles.includes(Role.SALON_STAFF) &&
      !actor.roles.includes(Role.SALON_OWNER)
    ) {
      throw new AppException(
        QueueErrorCode.NOT_YOUR_STAFF_PROFILE,
        'You can only update your own clock-in status.',
        HttpStatus.FORBIDDEN,
      );
    }

    const updated = await this.prisma.salonStaff.update({
      where: { id: staffId },
      data: { status },
    });
    this.realtime.emitStaffStatusChanged(staff.salonId, staffId);
    return {
      id: updated.id,
      displayName: updated.displayName,
      status: updated.status,
    };
  }

  // "Which SalonStaff row is *me*, at this salon" — resolves the gap noted in staff-status.service's
  // own updateStatus() above, where a caller must already know their staffId. Null (not a 404) when
  // this user has no roster row here: an owner viewing a salon they don't work a chair at is not an
  // error, just "nothing to self clock-in as."
  async getMe(userId: string, salonId: string): Promise<StaffStatusDto | null> {
    const staff = await this.prisma.salonStaff.findFirst({
      where: { userId, salonId },
    });
    if (!staff) return null;
    return {
      id: staff.id,
      displayName: staff.displayName,
      status: staff.status,
    };
  }
}

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

    if (actor.roles.includes(Role.SALON_OWNER)) {
      await this.salonAccess.assertAccess(actor.id, staff.salonId);
    } else if (staff.userId !== actor.id) {
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
}

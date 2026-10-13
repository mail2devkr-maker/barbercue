import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import {
  BookingErrorCode,
  OwnerOpsErrorCode,
  QueueErrorCode,
  Role,
  SessionAudience,
  StaffMemberStatus,
  type StaffAccessChangeInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { QueueAssignmentReleaseService } from '../queue/queue-assignment-release.service';

export interface StaffAccessResult {
  staffId: string;
  accessRevoked: boolean;
  status: StaffMemberStatus;
}

/**
 * Owner control over a barber's LOGIN ACCESS - distinct from the clock-in/out duty flag.
 *
 * Revoking removes the barber's SALON_STAFF role for this shop (the single thing every salon-scoped
 * check consults, so it takes effect on the next request even with a still-valid access token),
 * ends their staff sessions when it was their last staff role, takes them off duty, and records who
 * did it and when. History (their completed services, audit rows) is untouched - nothing is
 * deleted. Re-activation is explicit and symmetrical.
 */
@Injectable()
export class StaffAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly realtime: RealtimeGateway,
    @Optional() private readonly assignmentRelease?: QueueAssignmentReleaseService,
  ) {}

  async revoke(
    userId: string,
    salonId: string,
    staffId: string,
    input: StaffAccessChangeInput,
  ): Promise<StaffAccessResult> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(
      userId,
      salonId,
    );
    const staff = await this.findStaff(salonId, staffId);
    if (staff.userId === userId) {
      throw new AppException(
        QueueErrorCode.NOT_YOUR_STAFF_PROFILE,
        'You cannot remove your own access.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (staff.accessRevokedAt) {
      throw new AppException(
        OwnerOpsErrorCode.STAFF_ACCESS_ALREADY_REVOKED,
        'This barber’s access has already been removed.',
        HttpStatus.CONFLICT,
      );
    }
    const serving = await this.prisma.serviceSession.findFirst({
      where: { staffId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (serving) {
      throw new AppException(
        QueueErrorCode.STAFF_ALREADY_OCCUPIED,
        'This barber is serving a customer right now. Finish or reassign that service first.',
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.salonStaff.update({
        where: { id: staffId },
        data: {
          status: StaffMemberStatus.INACTIVE,
          accessRevokedAt: new Date(),
          accessRevokedById: userId,
        },
      });
      await tx.userRole.deleteMany({
        where: { userId: staff.userId, salonId, role: Role.SALON_STAFF },
      });
      const stillOperator = await tx.userRole.count({
        where: {
          userId: staff.userId,
          role: { in: [Role.SALON_STAFF, Role.SALON_OWNER] },
        },
      });
      if (stillOperator === 0) {
        await tx.refreshToken.updateMany({
          where: {
            userId: staff.userId,
            audience: SessionAudience.STAFF,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'STAFF_ACCESS_REVOKED',
          entityType: 'SalonStaff',
          entityId: staffId,
          metadata: {
            salonId,
            actor,
            reason: input.reason ?? null,
            targetUserId: staff.userId,
          },
        },
      });
    });
    // A customer assigned to this barber (service not started) goes back to waiting.
    await this.assignmentRelease?.releaseForStaff(salonId, staffId, 'STAFF_ACCESS_REVOKED', userId);
    this.realtime.emitStaffStatusChanged(salonId, staffId);
    this.realtime.emitQueueUpdated(salonId);
    return { staffId, accessRevoked: true, status: StaffMemberStatus.INACTIVE };
  }

  async restore(
    userId: string,
    salonId: string,
    staffId: string,
    input: StaffAccessChangeInput,
  ): Promise<StaffAccessResult> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(
      userId,
      salonId,
    );
    const staff = await this.findStaff(salonId, staffId);
    if (!staff.accessRevokedAt) {
      throw new AppException(
        OwnerOpsErrorCode.STAFF_ACCESS_NOT_REVOKED,
        'This barber’s access is already active.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.salonStaff.update({
        where: { id: staffId },
        data: { accessRevokedAt: null, accessRevokedById: null },
      });
      await tx.userRole.upsert({
        where: {
          userId_role_salonId: {
            userId: staff.userId,
            role: Role.SALON_STAFF,
            salonId,
          },
        },
        update: {},
        create: { userId: staff.userId, role: Role.SALON_STAFF, salonId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'STAFF_ACCESS_RESTORED',
          entityType: 'SalonStaff',
          entityId: staffId,
          metadata: {
            salonId,
            actor,
            reason: input.reason ?? null,
            targetUserId: staff.userId,
          },
        },
      });
    });
    this.realtime.emitStaffStatusChanged(salonId, staffId);
    // Back on the roster but still off duty until they clock in themselves.
    return {
      staffId,
      accessRevoked: false,
      status: StaffMemberStatus.INACTIVE,
    };
  }

  private async findStaff(salonId: string, staffId: string) {
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
    return staff;
  }
}

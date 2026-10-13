import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QueueEntryStatus } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { QueueAutoAssignTrigger } from './queue-auto-assign.trigger';

export type AssignmentReleaseReason =
  | 'STAFF_OFF_DUTY'
  | 'STAFF_ACCESS_REVOKED'
  | 'CHAIR_UNAVAILABLE';

/**
 * Owner-operations corrective mission: an ASSIGNED customer (status CALLED with a reserved barber and
 * chair, service not started) must never stay stuck behind a barber or chair that can no longer
 * serve them. When the barber goes off duty, loses access, or the chair is taken out of use, the
 * customer goes back to WAITING (keeping their place in line - joinedAt is untouched) and the
 * allocator gets a chance to give them someone else.
 *
 * It depends only on Prisma, realtime and the allocator trigger, so any module that changes a
 * barber's or chair's availability (staff status, access revocation, chair settings) can use it
 * without importing the queue engine (which would be a circular dependency).
 *
 * Every release writes a QUEUE_ASSIGNMENT_RELEASED audit row naming the reason. The release is a
 * conditional claim (status still CALLED and still held by that barber), so it can never overwrite a
 * service that the barber started a moment earlier.
 */
@Injectable()
export class QueueAssignmentReleaseService {
  private readonly logger = new Logger(QueueAssignmentReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly trigger: QueueAutoAssignTrigger,
  ) {}

  releaseForStaff(
    salonId: string,
    staffId: string,
    reason: AssignmentReleaseReason,
    actorUserId: string | null = null,
  ): Promise<number> {
    return this.release(salonId, { assignedStaffId: staffId }, reason, actorUserId);
  }

  releaseForChair(
    salonId: string,
    chairId: string,
    reason: AssignmentReleaseReason,
    actorUserId: string | null = null,
  ): Promise<number> {
    return this.release(salonId, { assignedChairId: chairId }, reason, actorUserId);
  }

  private async release(
    salonId: string,
    holder: Prisma.QueueEntryWhereInput,
    reason: AssignmentReleaseReason,
    actorUserId: string | null,
  ): Promise<number> {
    const held = await this.prisma.queueEntry.findMany({
      where: {
        salonId,
        status: QueueEntryStatus.CALLED,
        assignedStaffId: { not: null },
        ...holder,
      },
      select: { id: true, assignedStaffId: true, assignedChairId: true },
    });
    let released = 0;
    for (const row of held) {
      const done = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.queueEntry.updateMany({
          where: {
            id: row.id,
            status: QueueEntryStatus.CALLED,
            assignedStaffId: row.assignedStaffId,
          },
          data: {
            status: QueueEntryStatus.WAITING,
            assignedStaffId: null,
            assignedChairId: null,
            assignedAt: null,
            calledAt: null,
          },
        });
        if (claim.count === 0) return false;
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'QUEUE_ASSIGNMENT_RELEASED',
            entityType: 'QueueEntry',
            entityId: row.id,
            metadata: {
              salonId,
              reason,
              staffId: row.assignedStaffId,
              chairId: row.assignedChairId,
            },
          },
        });
        return true;
      });
      if (done) released += 1;
    }
    if (released > 0) {
      this.logger.log(`Released ${released} assigned customer(s) at salon ${salonId} (${reason}).`);
      this.realtime.emitQueueUpdated(salonId);
      // Someone else may now be able to take them.
      this.trigger.trigger(salonId);
    }
    return released;
  }
}

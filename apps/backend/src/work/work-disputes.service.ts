import { Injectable } from '@nestjs/common';
import { WorkAssignmentStatus, WorkDisputeReason, WorkDisputeStatus, WorkParty } from '@prisma/client';
import { WORK_LIMITS, type WorkDisputeDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkAssignmentsService } from './work-assignments.service';
import { WorkAuditService } from './work-audit.service';
import { WorkPaymentsService } from './work-payments.service';
import { workInvalidState, workNotFound, workValidation } from './work-errors';
import { lockAssignment, lockJob } from './work-internal';

/** Which party may open a dispute from which assignment state. */
const OPENABLE: Record<'WORKER' | 'EMPLOYER', WorkAssignmentStatus[]> = {
  WORKER: [WorkAssignmentStatus.REWORK_REQUESTED, WorkAssignmentStatus.NO_SHOW_REVIEW, WorkAssignmentStatus.CHECKED_IN],
  EMPLOYER: [WorkAssignmentStatus.SUBMITTED, WorkAssignmentStatus.REWORK_REQUESTED],
};

/**
 * Neutral review pathway. Either side opens a dispute with a reason code and their account; the
 * assignment is frozen in DISPUTED (no auto-approval, no auto-rejection). Only a platform
 * reviewer resolves it, by awarding an amount between zero and the agreed pay with a written
 * reason both parties can see. Nothing here is decided by an AI score.
 */
@Injectable()
export class WorkDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: WorkAssignmentsService,
    private readonly payments: WorkPaymentsService,
    private readonly audit: WorkAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  toDto(d: { id: string; assignmentId: string; openedByParty: WorkParty; reasonCode: WorkDisputeReason; description: string; status: WorkDisputeStatus; awardPaise: number | null; resolutionNote: string | null; createdAt: Date; resolvedAt: Date | null }): WorkDisputeDto {
    return {
      id: d.id,
      assignmentId: d.assignmentId,
      openedBy: d.openedByParty,
      reasonCode: d.reasonCode,
      description: d.description,
      status: d.status,
      awardPaise: d.awardPaise,
      resolutionNote: d.resolutionNote,
      createdAt: d.createdAt.toISOString(),
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
    };
  }

  async open(userId: string, assignmentId: string, reasonCode: WorkDisputeReason, description: string): Promise<WorkDisputeDto> {
    const { party } = await this.assignments.partyOf(userId, assignmentId);
    const side = party === WorkParty.WORKER ? 'WORKER' : 'EMPLOYER';
    return this.prisma.$transaction(async (tx) => {
      await lockAssignment(tx, assignmentId);
      const a = await tx.workAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { job: true } });
      if (!OPENABLE[side].includes(a.status)) throw workInvalidState('A dispute cannot be opened from the assignment’s current state.', { status: a.status });
      const dispute = await tx.workDispute.create({
        data: {
          assignmentId,
          openedById: userId,
          openedByParty: party,
          reasonCode,
          description,
          fromStatus: a.status,
          slaDueAt: new Date(Date.now() + WORK_LIMITS.disputeSlaHours * 3600_000),
        },
      });
      await tx.workAssignment.update({ where: { id: a.id }, data: { status: WorkAssignmentStatus.DISPUTED, reviewDueAt: null } });
      await this.audit.record(tx, { entityType: 'ASSIGNMENT', entityId: a.id, action: 'DISPUTE_OPENED', fromStatus: a.status, toStatus: 'DISPUTED', actorUserId: userId, actorParty: party, orgId: a.job.orgId, jobId: a.jobId, metadata: { disputeId: dispute.id, reasonCode } });
      await this.audit.record(tx, { entityType: 'DISPUTE', entityId: dispute.id, action: 'DISPUTE_OPENED', toStatus: 'OPEN', actorUserId: userId, actorParty: party, orgId: a.job.orgId, jobId: a.jobId });
      if (party === WorkParty.EMPLOYER) {
        await this.notifications.notifyInTransaction(tx, a.workerId, 'work.dispute.updated', { assignmentId: a.id, disputeId: dispute.id }, `/work/me/assignments/${a.id}`);
      }
      return this.toDto(dispute);
    });
  }

  async adminList(status?: WorkDisputeStatus) {
    const rows = await this.prisma.workDispute.findMany({
      where: status ? { status } : {},
      include: { assignment: { include: { job: { include: { org: true } } } } },
      orderBy: { slaDueAt: 'asc' },
      take: 200,
    });
    return rows.map((d) => ({
      ...this.toDto(d),
      jobId: d.assignment.jobId,
      jobTitle: d.assignment.job.title,
      orgName: d.assignment.job.org.displayName,
      agreedPayPaise: d.assignment.agreedPayPaise,
      slaDueAt: d.slaDueAt.toISOString(),
      overdue: d.status === WorkDisputeStatus.OPEN && d.slaDueAt < new Date(),
    }));
  }

  async resolve(adminId: string, disputeId: string, awardPaise: number, note: string) {
    let payoutId: string | null = null;
    const r = await this.prisma.$transaction(async (tx) => {
      const d = await tx.workDispute.findUnique({ where: { id: disputeId } });
      if (!d) throw workNotFound('Dispute not found.');
      await lockAssignment(tx, d.assignmentId);
      const fresh = await tx.workDispute.findUniqueOrThrow({ where: { id: disputeId } });
      if (fresh.status !== WorkDisputeStatus.OPEN) throw workInvalidState('This dispute is already resolved.');
      const a = await tx.workAssignment.findUniqueOrThrow({ where: { id: d.assignmentId }, include: { job: true } });
      if (a.status !== WorkAssignmentStatus.DISPUTED) throw workInvalidState('The assignment is not in dispute.');
      if (awardPaise > a.agreedPayPaise) throw workValidation('The award cannot exceed the agreed pay.');
      await tx.workDispute.update({ where: { id: d.id }, data: { status: WorkDisputeStatus.RESOLVED, awardPaise, resolutionNote: note, resolvedById: adminId, resolvedAt: new Date() } });
      await this.audit.record(tx, { entityType: 'DISPUTE', entityId: d.id, action: 'DISPUTE_RESOLVED', fromStatus: 'OPEN', toStatus: 'RESOLVED', actorUserId: adminId, actorParty: WorkParty.PLATFORM, orgId: a.job.orgId, jobId: a.jobId, note, metadata: { awardPaise } });
      if (awardPaise > 0) {
        ({ payoutId } = await this.payments.makePayable(tx, { assignmentId: a.id, amountPaise: awardPaise, reason: 'DISPUTE_AWARD', actorUserId: adminId, actorParty: WorkParty.PLATFORM, note }));
      } else {
        await tx.workAssignment.update({ where: { id: a.id }, data: { status: WorkAssignmentStatus.CLOSED_UNPAID } });
        await this.audit.record(tx, {
          entityType: 'ASSIGNMENT',
          entityId: a.id,
          action: d.reasonCode === 'NO_SHOW' || d.fromStatus === WorkAssignmentStatus.NO_SHOW_REVIEW ? 'NO_SHOW_UPHELD' : 'DISPUTE_CLOSED_UNPAID',
          fromStatus: 'DISPUTED',
          toStatus: 'CLOSED_UNPAID',
          actorUserId: adminId,
          actorParty: WorkParty.PLATFORM,
          orgId: a.job.orgId,
          jobId: a.jobId,
          note,
          metadata: { workerId: a.workerId },
        });
        await lockJob(tx, a.jobId);
        const filled = await tx.workAssignment.count({ where: { jobId: a.jobId, status: { notIn: [WorkAssignmentStatus.WITHDRAWN, WorkAssignmentStatus.CANCELLED, WorkAssignmentStatus.CLOSED_UNPAID] } } });
        await tx.workJob.update({ where: { id: a.jobId }, data: { filledCount: filled } });
      }
      await this.notifications.notifyInTransaction(tx, a.workerId, 'work.dispute.updated', { assignmentId: a.id, disputeId: d.id, awardPaise }, `/work/me/assignments/${a.id}`);
      return { id: d.id, status: WorkDisputeStatus.RESOLVED, awardPaise };
    });
    if (payoutId) await this.payments.initiatePayout(payoutId);
    return r;
  }
}

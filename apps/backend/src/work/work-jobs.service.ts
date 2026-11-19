import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  WorkHiringMode,
  WorkLocationType,
  WorkAssignmentStatus,
  WorkJobStatus,
  WorkOrgStatus,
  WorkParty,
} from '@prisma/client';
import {
  evaluateWorkEligibility,
  quoteWorkJob,
  screenWorkJob,
  WORK_JOB_PUBLIC_STATUSES,
  WorkErrorCode,
  type WorkCategoryDto,
  type WorkEmployerJobDto,
  type WorkJobCardDto,
  type WorkJobDetailDto,
  type WorkJobUpsertInput,
  type WorkJobQuote,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkAccessService, JOB_EDITORS } from './work-access.service';
import { WorkAuditService } from './work-audit.service';
import { WorkPaymentsService } from './work-payments.service';
import { workPlatformFeeBps } from './work-config';
import { workError, workInvalidState, workNotFound, workValidation } from './work-errors';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  employerTrust,
  isPubliclyVisible,
  JOB_REFS,
  lockJob,
  newCheckInCode,
  toJobCard,
  toJobDetail,
  type JobWithRefs,
} from './work-internal';

const PAGE = 20;

@Injectable()
export class WorkJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkAccessService,
    private readonly audit: WorkAuditService,
    private readonly payments: WorkPaymentsService,
  ) {}

  async categories(): Promise<WorkCategoryDto[]> {
    const rows = await this.prisma.workCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows.map((c) => ({ slug: c.slug, name: c.name, description: c.description }));
  }

  // ------------------------------------------------------------------ public discovery

  async search(query: { q?: string; city?: string; category?: string; minPayPaise?: number; locationType?: string; instantOnly?: string; cursor?: string }): Promise<{ items: WorkJobCardDto[]; nextCursor: string | null }> {
    const and: Prisma.WorkJobWhereInput[] = [
      { status: { in: WORK_JOB_PUBLIC_STATUSES as WorkJobStatus[] } },
      { org: { status: WorkOrgStatus.VERIFIED } },
      { endsAt: { gt: new Date() } },
    ];
    if (query.city) and.push({ city: { equals: query.city, mode: 'insensitive' } });
    if (query.category) and.push({ category: { slug: query.category } });
    if (query.minPayPaise) and.push({ payPerWorkerPaise: { gte: query.minPayPaise } });
    if (query.locationType) and.push({ locationType: query.locationType as WorkLocationType });
    if (query.instantOnly === 'true') and.push({ hiringMode: WorkHiringMode.INSTANT_ACCEPT });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
          { requiredSkills: { has: query.q.toLowerCase() } },
        ],
      });
    }
    const where: Prisma.WorkJobWhereInput = { AND: and };
    const rows = await this.prisma.workJob.findMany({
      where,
      include: JOB_REFS,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: PAGE + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, PAGE);
    const trust = await employerTrust(this.prisma, [...new Map(page.map((j) => [j.org.id, j.org])).values()]);
    return {
      items: page.map((j) => toJobCard(j, trust.get(j.orgId)!)),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  async publicDetail(jobId: string): Promise<WorkJobDetailDto> {
    const job = await this.prisma.workJob.findUnique({ where: { id: jobId }, include: JOB_REFS });
    if (!job || !isPubliclyVisible(job)) throw workNotFound('Job not found.');
    const trust = await employerTrust(this.prisma, [job.org]);
    return toJobDetail(job, trust.get(job.orgId)!);
  }

  /** The signed-in worker's view of a job: eligibility (every failed rule, explained) and their status. */
  async viewerDetail(userId: string, jobId: string): Promise<WorkJobDetailDto> {
    const detail = await this.publicDetail(jobId);
    const job = await this.prisma.workJob.findUniqueOrThrow({ where: { id: jobId } });
    const [profile, isMember, assignment, application] = await Promise.all([
      this.prisma.workerProfile.findUnique({ where: { userId } }),
      this.access.isOrgMember(userId, job.orgId),
      this.prisma.workAssignment.findFirst({ where: { jobId, workerId: userId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } }, select: { id: true } }),
      this.prisma.workApplication.findUnique({ where: { jobId_workerId: { jobId, workerId: userId } } }),
    ]);
    if (!profile) {
      detail.viewer = { hasProfile: false, eligible: false, reasons: [], missingSkills: [], assignmentId: null, applicationId: null, applicationStatus: null };
      return detail;
    }
    const e = evaluateWorkEligibility({
      now: new Date(),
      job,
      worker: { dateOfBirth: profile.dateOfBirth, verificationLevel: profile.verificationLevel, skills: profile.skills, isOrgMember: isMember, suspended: !!profile.suspendedAt },
    });
    detail.viewer = {
      hasProfile: true,
      eligible: e.eligible,
      reasons: e.reasons,
      missingSkills: e.missingSkills,
      assignmentId: assignment?.id ?? null,
      applicationId: application?.id ?? null,
      applicationStatus: application?.status ?? null,
    };
    return detail;
  }

  // ------------------------------------------------------------------ employer

  private async resolveCategory(slug: string) {
    const category = await this.prisma.workCategory.findUnique({ where: { slug } });
    if (!category || !category.active) throw workValidation('Choose one of the listed job categories.', { field: 'categorySlug' });
    return category;
  }

  private jobData(input: WorkJobUpsertInput, categoryId: string) {
    return {
      categoryId,
      title: input.title,
      description: input.description,
      locationType: input.locationType,
      addressLine: input.addressLine ?? null,
      city: input.city,
      locality: input.locality ?? null,
      positions: input.positions,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      applicationDeadline: input.applicationDeadline ? new Date(input.applicationDeadline) : null,
      payType: input.payType,
      payPerWorkerPaise: input.payPerWorkerPaise,
      bonusDescription: input.bonusDescription ?? null,
      minAge: input.minAge,
      minVerificationLevel: input.minVerificationLevel,
      requiredSkills: [...new Set(input.requiredSkills)],
      languages: input.languages,
      hiringMode: input.hiringMode,
      requiresCheckIn: input.requiresCheckIn,
      checklist: input.checklist as unknown as Prisma.InputJsonValue,
      completionCriteria: input.completionCriteria,
      cancellationTerms: input.cancellationTerms as unknown as Prisma.InputJsonValue,
      reviewWindowHours: input.reviewWindowHours,
    };
  }

  async createDraft(userId: string, orgId: string, input: WorkJobUpsertInput): Promise<WorkEmployerJobDto> {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    const category = await this.resolveCategory(input.categorySlug);
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workJob.create({
        data: { ...this.jobData(input, category.id), orgId, feeBps: workPlatformFeeBps(), checkInCode: newCheckInCode(), createdById: userId },
      });
      await this.audit.record(tx, { entityType: 'JOB', entityId: created.id, action: 'JOB_DRAFTED', toStatus: 'DRAFT', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, jobId: created.id });
      return created;
    });
    return this.employerJob(userId, orgId, job.id);
  }

  /**
   * Edits are only possible while the job is a draft, or before anyone could see it (awaiting
   * moderation or funding) — in which case it returns to DRAFT and must be approved again. Pay
   * and terms of a job workers can see are never edited in place.
   */
  async updateDraft(userId: string, orgId: string, jobId: string, input: WorkJobUpsertInput): Promise<WorkEmployerJobDto> {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    const category = await this.resolveCategory(input.categorySlug);
    await this.prisma.$transaction(async (tx) => {
      await lockJob(tx, jobId);
      const job = await tx.workJob.findFirst({ where: { id: jobId, orgId } });
      if (!job) throw workNotFound('Job not found.');
      const editable: WorkJobStatus[] = [WorkJobStatus.DRAFT, WorkJobStatus.PENDING_VERIFICATION, WorkJobStatus.FUNDING_REQUIRED];
      if (!editable.includes(job.status)) {
        throw workError(WorkErrorCode.JOB_NOT_EDITABLE, 'A published job cannot be changed. Cancel it and post a new one.', HttpStatus.CONFLICT);
      }
      await tx.workJob.update({
        where: { id: jobId },
        data: { ...this.jobData(input, category.id), status: WorkJobStatus.DRAFT, version: { increment: 1 }, screeningFlags: Prisma.DbNull, moderationNote: null },
      });
      await this.audit.record(tx, { entityType: 'JOB', entityId: jobId, action: 'JOB_EDITED', fromStatus: job.status, toStatus: 'DRAFT', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, jobId });
    });
    return this.employerJob(userId, orgId, jobId);
  }

  quote(job: { positions: number; payPerWorkerPaise: number; feeBps: number }): WorkJobQuote {
    return quoteWorkJob(job.positions, job.payPerWorkerPaise, job.feeBps);
  }

  /**
   * Mandatory pre-publication validation. The employer has seen the full preview and quote and
   * sends back the version they approved. Rules: verified business, schedule in the future,
   * anti-scam screening. A screening match goes to human moderation; otherwise the job waits
   * for funding. Nothing becomes visible to workers until funding is confirmed.
   */
  async publish(userId: string, orgId: string, jobId: string, approvedVersion: number): Promise<WorkEmployerJobDto> {
    const { org } = await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    if (org.status !== WorkOrgStatus.VERIFIED) {
      throw workError(WorkErrorCode.ORG_NOT_VERIFIED, 'Your business must be verified before you can publish paid work.', HttpStatus.FORBIDDEN);
    }
    await this.prisma.$transaction(async (tx) => {
      await lockJob(tx, jobId);
      const job = await tx.workJob.findFirst({ where: { id: jobId, orgId } });
      if (!job) throw workNotFound('Job not found.');
      if (job.status !== WorkJobStatus.DRAFT) throw workInvalidState('Only a draft can be submitted for publishing.');
      if (job.version !== approvedVersion) throw workInvalidState('The job changed since you reviewed it. Review the latest version.', { currentVersion: job.version });
      const now = Date.now();
      if (job.startsAt.getTime() < now + 30 * 60_000) throw workValidation('The work must start at least 30 minutes from now.');
      if (job.applicationDeadline && job.applicationDeadline.getTime() <= now) throw workValidation('The application deadline has already passed.');
      const checklist = job.checklist as unknown as { label: string }[];
      const screening = screenWorkJob({ title: job.title, description: job.description, completionCriteria: job.completionCriteria, bonusDescription: job.bonusDescription, checklistLabels: checklist.map((c) => c.label) });
      const to = screening.flagged ? WorkJobStatus.PENDING_VERIFICATION : WorkJobStatus.FUNDING_REQUIRED;
      await tx.workJob.update({
        where: { id: jobId },
        data: { status: to, screeningFlags: screening.flags.length ? (screening.flags as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      });
      await this.audit.record(tx, {
        entityType: 'JOB',
        entityId: jobId,
        action: screening.flagged ? 'JOB_HELD_FOR_MODERATION' : 'JOB_VALIDATED',
        fromStatus: 'DRAFT',
        toStatus: to,
        actorUserId: userId,
        actorParty: WorkParty.EMPLOYER,
        orgId,
        jobId,
        metadata: { version: job.version, flags: screening.flags.map((f) => f.code), quote: this.quote(job) },
      });
    });
    return this.employerJob(userId, orgId, jobId);
  }

  async moderate(adminId: string, jobId: string, decision: 'APPROVE' | 'REJECT', reason?: string) {
    if (decision === 'REJECT' && !reason?.trim()) throw workValidation('A reason is required — the business is shown it.');
    return this.prisma.$transaction(async (tx) => {
      await lockJob(tx, jobId);
      const job = await tx.workJob.findUnique({ where: { id: jobId } });
      if (!job) throw workNotFound('Job not found.');
      if (job.status !== WorkJobStatus.PENDING_VERIFICATION) throw workInvalidState('This job is not awaiting moderation.');
      const to = decision === 'APPROVE' ? WorkJobStatus.FUNDING_REQUIRED : WorkJobStatus.REJECTED;
      await tx.workJob.update({ where: { id: jobId }, data: { status: to, moderationNote: reason?.trim() || null } });
      await this.audit.record(tx, { entityType: 'JOB', entityId: jobId, action: `JOB_MODERATION_${decision}`, fromStatus: job.status, toStatus: to, actorUserId: adminId, actorParty: WorkParty.PLATFORM, orgId: job.orgId, jobId, note: reason ?? null });
      return { id: jobId, status: to };
    });
  }

  /**
   * Cancels a whole job. Work already submitted must be reviewed first. Workers who accepted get
   * the compensation the job disclosed for an employer cancellation (handled per assignment by
   * the assignments service through the callback), then unused funds are released.
   */
  async cancelJob(
    userId: string,
    orgId: string,
    jobId: string,
    reason: string,
    cancelAssignment: (tx: Prisma.TransactionClient, assignmentId: string) => Promise<void>,
  ) {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    return this.prisma.$transaction(async (tx) => {
      await lockJob(tx, jobId);
      const job = await tx.workJob.findFirst({ where: { id: jobId, orgId } });
      if (!job) throw workNotFound('Job not found.');
      const cancellable: WorkJobStatus[] = [WorkJobStatus.DRAFT, WorkJobStatus.PENDING_VERIFICATION, WorkJobStatus.FUNDING_REQUIRED, WorkJobStatus.OPEN, WorkJobStatus.PARTIALLY_FILLED, WorkJobStatus.FILLED, WorkJobStatus.IN_PROGRESS, WorkJobStatus.PAUSED];
      if (!cancellable.includes(job.status)) throw workInvalidState('This job can no longer be cancelled.');
      const blocking = await tx.workAssignment.count({ where: { jobId, status: { in: [WorkAssignmentStatus.SUBMITTED, WorkAssignmentStatus.REWORK_REQUESTED, WorkAssignmentStatus.DISPUTED] } } });
      if (blocking) throw workInvalidState('Review the work already submitted before cancelling this job.', { assignmentsToReview: blocking });
      const live = await tx.workAssignment.findMany({ where: { jobId, status: { in: [WorkAssignmentStatus.ACCEPTED, WorkAssignmentStatus.CHECKED_IN, WorkAssignmentStatus.NO_SHOW_REVIEW] } }, select: { id: true } });
      for (const a of live) await cancelAssignment(tx, a.id);
      await tx.workJob.update({ where: { id: jobId }, data: { status: WorkJobStatus.CANCELLED } });
      await this.audit.record(tx, { entityType: 'JOB', entityId: jobId, action: 'JOB_CANCELLED', fromStatus: job.status, toStatus: 'CANCELLED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, jobId, note: reason });
      // Unused funds go back now only if nobody is still owed on this job; otherwise at close.
      const owedOpen = await tx.workAssignment.count({ where: { jobId, status: { in: [WorkAssignmentStatus.PAYABLE] } } });
      if (!owedOpen) await this.payments.releaseRemaining(tx, jobId, orgId, 'cancel', 'Job cancelled');
      return { id: jobId, status: WorkJobStatus.CANCELLED };
    });
  }

  /**
   * Completes and closes a job once every assignment is finished (paid, payable, withdrawn,
   * cancelled or closed). Releases whatever prefund was not earned. PAYABLE work keeps its money
   * in the worker-payable account, so closing never touches an outstanding obligation.
   */
  async closeJob(userId: string, orgId: string, jobId: string) {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    return this.prisma.$transaction(async (tx) => {
      await lockJob(tx, jobId);
      const job = await tx.workJob.findFirst({ where: { id: jobId, orgId } });
      if (!job) throw workNotFound('Job not found.');
      const unfinished = await tx.workAssignment.count({
        where: { jobId, status: { in: [WorkAssignmentStatus.ACCEPTED, WorkAssignmentStatus.CHECKED_IN, WorkAssignmentStatus.SUBMITTED, WorkAssignmentStatus.REWORK_REQUESTED, WorkAssignmentStatus.DISPUTED, WorkAssignmentStatus.NO_SHOW_REVIEW] } },
      });
      if (unfinished) throw workInvalidState('Some assignments on this job are still in progress or awaiting review.', { unfinished });
      const fromCompletable: WorkJobStatus[] = [WorkJobStatus.OPEN, WorkJobStatus.PARTIALLY_FILLED, WorkJobStatus.FILLED, WorkJobStatus.IN_PROGRESS];
      let status = job.status;
      if (fromCompletable.includes(status)) {
        if (status === WorkJobStatus.OPEN && job.filledCount === 0 && job.endsAt > new Date()) {
          throw workInvalidState('Cancel the job instead — nobody has taken it yet.');
        }
        await tx.workJob.update({ where: { id: jobId }, data: { status: WorkJobStatus.COMPLETED } });
        await this.audit.record(tx, { entityType: 'JOB', entityId: jobId, action: 'JOB_COMPLETED', fromStatus: status, toStatus: 'COMPLETED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, jobId });
        status = WorkJobStatus.COMPLETED;
      }
      if (!([WorkJobStatus.COMPLETED, WorkJobStatus.CANCELLED, WorkJobStatus.EXPIRED] as WorkJobStatus[]).includes(status)) {
        throw workInvalidState('This job cannot be closed in its current state.');
      }
      const released = await this.payments.releaseRemaining(tx, jobId, orgId, 'close', 'Job closed');
      await tx.workJob.update({ where: { id: jobId }, data: { status: WorkJobStatus.CLOSED, closedAt: new Date() } });
      await this.audit.record(tx, { entityType: 'JOB', entityId: jobId, action: 'JOB_CLOSED', fromStatus: status, toStatus: 'CLOSED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, jobId, metadata: { releasedPaise: released } });
      return { id: jobId, status: WorkJobStatus.CLOSED, releasedPaise: released };
    });
  }

  async listForOrg(userId: string, orgId: string) {
    await this.access.requireOrgRole(userId, orgId);
    const jobs = await this.prisma.workJob.findMany({ where: { orgId }, include: { category: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return jobs.map((j) => ({
      id: j.id,
      title: j.title,
      categoryName: j.category.name,
      status: j.status,
      city: j.city,
      startsAt: j.startsAt.toISOString(),
      positions: j.positions,
      filled: j.filledCount,
      payPerWorkerPaise: j.payPerWorkerPaise,
      version: j.version,
    }));
  }

  async employerJob(userId: string, orgId: string, jobId: string): Promise<WorkEmployerJobDto> {
    await this.access.requireOrgRole(userId, orgId);
    const job = await this.prisma.workJob.findFirst({
      where: { id: jobId, orgId },
      include: {
        ...JOB_REFS,
        fundings: { orderBy: { createdAt: 'desc' }, take: 1 },
        applications: { include: { worker: { select: { workerProfile: true } } }, orderBy: { createdAt: 'asc' } },
        assignments: { include: { worker: { select: { workerProfile: true } }, payouts: { orderBy: { attempt: 'desc' }, take: 1 }, responses: { select: { duplicateFlag: true } } }, orderBy: { slotNumber: 'asc' } },
      },
    });
    if (!job) throw workNotFound('Job not found.');
    const trust = await employerTrust(this.prisma, [job.org]);
    const completedByWorker = await this.completedCounts([...job.applications.map((a) => a.workerId), ...job.assignments.map((a) => a.workerId)]);
    const funding = job.fundings[0];
    return {
      ...toJobDetail(job as JobWithRefs, trust.get(job.orgId)!),
      version: job.version,
      quote: this.quote(job),
      screeningFlags: (job.screeningFlags as unknown as { code: string; label: string }[] | null) ?? [],
      moderationNote: job.moderationNote,
      funding: funding ? this.payments.toFundingDto(funding) : null,
      applications: job.applications.map((a) => ({
        id: a.id,
        workerUserId: a.workerId,
        workerName: a.worker.workerProfile?.fullName ?? 'Worker',
        verificationLevel: a.worker.workerProfile?.verificationLevel ?? 0,
        completedAssignments: completedByWorker.get(a.workerId) ?? 0,
        status: a.status,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
      })),
      assignments: job.assignments.map((a) => ({
        id: a.id,
        jobId: a.jobId,
        jobTitle: job.title,
        employerName: job.org.displayName,
        city: job.city,
        startsAt: job.startsAt.toISOString(),
        endsAt: job.endsAt.toISOString(),
        status: a.status,
        agreedPayPaise: a.agreedPayPaise,
        approvedAmountPaise: a.approvedAmountPaise,
        payoutStatus: a.payouts[0]?.status ?? null,
        workerName: a.worker.workerProfile?.fullName ?? 'Worker',
        slotNumber: a.slotNumber,
        duplicateFlags: a.responses.filter((r) => r.duplicateFlag).length,
      })),
      checkInCode: job.requiresCheckIn ? job.checkInCode : null,
    };
  }

  private async completedCounts(workerIds: string[]): Promise<Map<string, number>> {
    if (!workerIds.length) return new Map();
    const rows = await this.prisma.workAssignment.groupBy({
      by: ['workerId'],
      where: { workerId: { in: [...new Set(workerIds)] }, status: { in: [WorkAssignmentStatus.PAYABLE, WorkAssignmentStatus.PAID] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.workerId, r._count._all]));
  }

  // ------------------------------------------------------------------ admin

  async adminList(status?: WorkJobStatus) {
    const rows = await this.prisma.workJob.findMany({ where: status ? { status } : {}, include: JOB_REFS, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((j) => ({
      id: j.id,
      title: j.title,
      orgId: j.orgId,
      orgName: j.org.displayName,
      orgStatus: j.org.status,
      category: j.category.name,
      status: j.status,
      city: j.city,
      positions: j.positions,
      filled: j.filledCount,
      payPerWorkerPaise: j.payPerWorkerPaise,
      startsAt: j.startsAt.toISOString(),
      screeningFlags: (j.screeningFlags as unknown as { code: string; label: string }[] | null) ?? [],
      description: j.description,
    }));
  }
}

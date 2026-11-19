import { createHash } from 'crypto';
import { HttpStatus, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  Prisma,
  WorkApplicationStatus,
  WorkAssignmentStatus,
  WorkCheckInMethod,
  WorkHiringMode,
  WorkJobStatus,
  WorkOrgMemberRole,
  WorkOrgStatus,
  WorkParty,
  type WorkAssignment,
} from '@prisma/client';
import {
  canTransitionWorkAssignment,
  evaluateWorkEligibility,
  WORK_INELIGIBLE_LABELS,
  WORK_LIMITS,
  WorkErrorCode,
  workJobCapacityStatus,
  type NotificationType,
  type WorkAssignmentDetailDto,
  type WorkCheckInInput,
  type WorkReviewInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DbDeadlineSchedulerService } from '../common/db-deadline-scheduler/db-deadline-scheduler.service';
import { detectImageMimeType } from '../storage/image-signature';
import { WorkAccessService, JOB_EDITORS } from './work-access.service';
import { WorkAuditService } from './work-audit.service';
import { WorkPaymentsService } from './work-payments.service';
import { WorkWorkersService } from './work-workers.service';
import { workMarketplaceEnabled } from './work-config';
import { workError, workForbidden, workInvalidState, workNotFound, workValidation } from './work-errors';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  employerTrust,
  JOB_REFS,
  lockAssignment,
  lockJob,
  normalizeAnswer,
  snapshotChecklist,
  snapshotReviewHours,
  snapshotTerms,
  termsSnapshot,
  toJobDetail,
  type JobWithRefs,
} from './work-internal';

type Tx = Prisma.TransactionClient;

const ACCEPTING: WorkJobStatus[] = [WorkJobStatus.OPEN, WorkJobStatus.PARTIALLY_FILLED];
const CAPACITY_TRACKED: WorkJobStatus[] = [WorkJobStatus.OPEN, WorkJobStatus.PARTIALLY_FILLED, WorkJobStatus.FILLED];
const EDITABLE_RESPONSES: WorkAssignmentStatus[] = [WorkAssignmentStatus.ACCEPTED, WorkAssignmentStatus.CHECKED_IN, WorkAssignmentStatus.REWORK_REQUESTED];

/**
 * Assignment lifecycle (docs/work-marketplace/STATE_MACHINES.md). Every transition:
 *  - runs in a transaction holding the row lock of the job and/or assignment it changes,
 *  - checks the shared state machine before writing,
 *  - writes an append-only audit event on the same transaction,
 *  - is safe to repeat (a second identical request finds the new state and is refused cleanly).
 */
@Injectable()
export class WorkAssignmentsService implements OnModuleInit {
  private readonly logger = new Logger(WorkAssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkAccessService,
    private readonly audit: WorkAuditService,
    private readonly payments: WorkPaymentsService,
    private readonly workers: WorkWorkersService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly deadlines?: DbDeadlineSchedulerService,
  ) {}

  onModuleInit(): void {
    if (!workMarketplaceEnabled() || !this.deadlines) return;
    // Deadline-driven (not polling) so an idle database can sleep — same scheduler the booking
    // and queue sweeps use.
    this.deadlines.register({ name: 'work-deadlines', domain: 'work', nextDueAt: () => this.nextDeadline(), runDue: () => this.sweep().then(() => undefined) });
  }

  // =========================================================================== taking a slot

  /**
   * Atomic capacity reservation. Order of locks is always worker (advisory) → job (row), so two
   * requests can never deadlock. Under the job lock the live slot-holding assignments are
   * counted; the lowest free slot number is taken. Partial unique indexes on (job, slot) and
   * (job, worker) back this up at the database level.
   */
  private async reserveSlot(tx: Tx, userId: string, jobId: string, applicationId: string | null): Promise<WorkAssignment> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-worker:${userId}`}))`;
    await lockJob(tx, jobId);
    const job = await tx.workJob.findUnique({ where: { id: jobId }, include: { org: true } });
    if (!job || job.org.status !== WorkOrgStatus.VERIFIED) throw workNotFound('Job not found.');
    const profile = await tx.workerProfile.findUnique({ where: { userId } });
    if (!profile) throw workError(WorkErrorCode.PROFILE_REQUIRED, 'Create your worker profile first.', HttpStatus.UNPROCESSABLE_ENTITY);

    const existing = await tx.workAssignment.findFirst({ where: { jobId, workerId: userId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } } });
    if (existing) throw workError(WorkErrorCode.ALREADY_ASSIGNED, 'You already have this assignment.', HttpStatus.CONFLICT, { assignmentId: existing.id });

    const eligibility = evaluateWorkEligibility({
      now: new Date(),
      job,
      worker: { dateOfBirth: profile.dateOfBirth, verificationLevel: profile.verificationLevel, skills: profile.skills, isOrgMember: await this.access.isOrgMember(userId, job.orgId, tx), suspended: !!profile.suspendedAt },
    });
    const liveSlots = await tx.workAssignment.findMany({ where: { jobId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } }, select: { slotNumber: true } });
    if (eligibility.reasons.includes('JOB_NOT_ACCEPTING') && liveSlots.length >= job.positions) {
      throw workError(WorkErrorCode.JOB_FULL, 'All places on this job have just been taken.', HttpStatus.CONFLICT);
    }
    if (!eligibility.eligible) {
      throw workError(WorkErrorCode.NOT_ELIGIBLE, WORK_INELIGIBLE_LABELS[eligibility.reasons[0]], HttpStatus.FORBIDDEN, { reasons: eligibility.reasons, missingSkills: eligibility.missingSkills });
    }
    if (liveSlots.length >= job.positions) throw workError(WorkErrorCode.JOB_FULL, 'All places on this job have just been taken.', HttpStatus.CONFLICT);

    const overlap = await tx.workAssignment.findFirst({
      where: {
        workerId: userId,
        status: { in: [WorkAssignmentStatus.ACCEPTED, WorkAssignmentStatus.CHECKED_IN] },
        job: { startsAt: { lt: job.endsAt }, endsAt: { gt: job.startsAt } },
      },
      select: { id: true },
    });
    if (overlap) throw workError(WorkErrorCode.SCHEDULE_CONFLICT, 'You already have work booked at this time.', HttpStatus.CONFLICT, { assignmentId: overlap.id });

    const taken = new Set(liveSlots.map((s) => s.slotNumber));
    let slot = 1;
    while (taken.has(slot)) slot += 1;

    const assignment = await tx.workAssignment.create({
      data: { jobId, workerId: userId, applicationId, slotNumber: slot, agreedPayPaise: job.payPerWorkerPaise, termsSnapshot: termsSnapshot(job) },
    });
    const filled = liveSlots.length + 1;
    await tx.workJob.update({ where: { id: jobId }, data: { filledCount: filled, status: workJobCapacityStatus(filled, job.positions) } });
    await this.audit.record(tx, {
      entityType: 'ASSIGNMENT',
      entityId: assignment.id,
      action: 'SLOT_ACCEPTED',
      toStatus: 'ACCEPTED',
      actorUserId: userId,
      actorParty: WorkParty.WORKER,
      orgId: job.orgId,
      jobId,
      metadata: { slotNumber: slot, filled, positions: job.positions, jobVersion: job.version },
    });
    await this.notifyOrg(tx, job.orgId, 'work.assignment.accepted', { jobId, assignmentId: assignment.id, filled, positions: job.positions }, `/work/business/${job.orgId}/jobs/${jobId}`);
    return assignment;
  }

  /** Re-derives filledCount from live assignments and updates the capacity state of an accepting job. */
  private async recomputeCapacity(tx: Tx, jobId: string): Promise<void> {
    const job = await tx.workJob.findUniqueOrThrow({ where: { id: jobId } });
    const filled = await tx.workAssignment.count({ where: { jobId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } } });
    await tx.workJob.update({
      where: { id: jobId },
      data: { filledCount: filled, ...(CAPACITY_TRACKED.includes(job.status) ? { status: workJobCapacityStatus(filled, job.positions) } : {}) },
    });
  }

  async acceptInstant(userId: string, jobId: string): Promise<{ assignmentId: string }> {
    const job = await this.prisma.workJob.findUnique({ where: { id: jobId }, select: { hiringMode: true } });
    if (!job) throw workNotFound('Job not found.');
    if (job.hiringMode !== WorkHiringMode.INSTANT_ACCEPT) throw workInvalidState('This job needs an application — the employer selects workers.');
    const a = await this.prisma.$transaction((tx) => this.reserveSlot(tx, userId, jobId, null));
    this.deadlines?.signal('work');
    return { assignmentId: a.id };
  }

  // =========================================================================== apply and select

  async apply(userId: string, jobId: string, note?: string): Promise<{ applicationId: string }> {
    return this.prisma.$transaction(async (tx) => {
      await lockJob(tx, jobId);
      const job = await tx.workJob.findUnique({ where: { id: jobId }, include: { org: true } });
      if (!job || job.org.status !== WorkOrgStatus.VERIFIED) throw workNotFound('Job not found.');
      if (job.hiringMode !== WorkHiringMode.APPLY_AND_SELECT) throw workInvalidState('This job is instant-accept — take a place directly.');
      const profile = await tx.workerProfile.findUnique({ where: { userId } });
      if (!profile) throw workError(WorkErrorCode.PROFILE_REQUIRED, 'Create your worker profile first.', HttpStatus.UNPROCESSABLE_ENTITY);
      const e = evaluateWorkEligibility({
        now: new Date(),
        job,
        worker: { dateOfBirth: profile.dateOfBirth, verificationLevel: profile.verificationLevel, skills: profile.skills, isOrgMember: await this.access.isOrgMember(userId, job.orgId, tx), suspended: !!profile.suspendedAt },
      });
      // A full job still takes applications: a selected applicant may fill a slot that frees up.
      const blocking = e.reasons.filter((r) => !(r === 'JOB_NOT_ACCEPTING' && job.status === WorkJobStatus.FILLED));
      if (blocking.length) throw workError(WorkErrorCode.NOT_ELIGIBLE, WORK_INELIGIBLE_LABELS[blocking[0]], HttpStatus.FORBIDDEN, { reasons: blocking, missingSkills: e.missingSkills });
      const prior = await tx.workApplication.findUnique({ where: { jobId_workerId: { jobId, workerId: userId } } });
      let id: string;
      if (prior) {
        if (prior.status !== WorkApplicationStatus.WITHDRAWN) throw workError(WorkErrorCode.ALREADY_APPLIED, 'You have already applied.', HttpStatus.CONFLICT, { applicationId: prior.id });
        await tx.workApplication.update({ where: { id: prior.id }, data: { status: WorkApplicationStatus.APPLIED, note: note ?? null, decidedAt: null, decidedById: null } });
        id = prior.id;
      } else {
        id = (await tx.workApplication.create({ data: { jobId, workerId: userId, note: note ?? null } })).id;
      }
      await this.audit.record(tx, { entityType: 'APPLICATION', entityId: id, action: 'APPLIED', toStatus: 'APPLIED', actorUserId: userId, actorParty: WorkParty.WORKER, orgId: job.orgId, jobId });
      return { applicationId: id };
    });
  }

  async withdrawApplication(userId: string, applicationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.workApplication.findFirst({ where: { id: applicationId, workerId: userId }, include: { job: true } });
      if (!app) throw workNotFound('Application not found.');
      const res = await tx.workApplication.updateMany({ where: { id: app.id, status: { in: [WorkApplicationStatus.APPLIED, WorkApplicationStatus.OFFERED] } }, data: { status: WorkApplicationStatus.WITHDRAWN } });
      if (!res.count) throw workInvalidState('This application can no longer be withdrawn.');
      await this.audit.record(tx, { entityType: 'APPLICATION', entityId: app.id, action: 'APPLICATION_WITHDRAWN', fromStatus: app.status, toStatus: 'WITHDRAWN', actorUserId: userId, actorParty: WorkParty.WORKER, orgId: app.job.orgId, jobId: app.jobId });
      return { id: app.id, status: WorkApplicationStatus.WITHDRAWN };
    });
  }

  async decideApplication(userId: string, orgId: string, applicationId: string, decision: 'OFFER' | 'REJECT') {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.workApplication.findFirst({ where: { id: applicationId, job: { orgId } }, include: { job: true } });
      if (!app) throw workNotFound('Application not found.');
      const to = decision === 'OFFER' ? WorkApplicationStatus.OFFERED : WorkApplicationStatus.REJECTED;
      const res = await tx.workApplication.updateMany({ where: { id: app.id, status: WorkApplicationStatus.APPLIED }, data: { status: to, decidedAt: new Date(), decidedById: userId } });
      if (!res.count) throw workInvalidState('Only a new application can be offered or rejected.');
      await this.audit.record(tx, { entityType: 'APPLICATION', entityId: app.id, action: decision === 'OFFER' ? 'OFFER_MADE' : 'APPLICATION_REJECTED', fromStatus: 'APPLIED', toStatus: to, actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, jobId: app.jobId, metadata: { payPerWorkerPaise: app.job.payPerWorkerPaise, jobVersion: app.job.version } });
      if (decision === 'OFFER') {
        await this.notifications.notifyInTransaction(tx, app.workerId, 'work.offer.received', { jobId: app.jobId, applicationId: app.id }, `/work/jobs/${app.jobId}`);
      }
      return { id: app.id, status: to };
    });
  }

  /** The offer is on the job's published terms, which cannot change after publication. */
  async respondToOffer(userId: string, applicationId: string, response: 'ACCEPT' | 'DECLINE') {
    const r = await this.prisma.$transaction(async (tx) => {
      const app = await tx.workApplication.findFirst({ where: { id: applicationId, workerId: userId } });
      if (!app) throw workNotFound('Application not found.');
      if (app.status !== WorkApplicationStatus.OFFERED) throw workInvalidState('There is no open offer on this application.');
      if (response === 'DECLINE') {
        await tx.workApplication.update({ where: { id: app.id }, data: { status: WorkApplicationStatus.DECLINED } });
        await this.audit.record(tx, { entityType: 'APPLICATION', entityId: app.id, action: 'OFFER_DECLINED', fromStatus: 'OFFERED', toStatus: 'DECLINED', actorUserId: userId, actorParty: WorkParty.WORKER, jobId: app.jobId });
        return { applicationId: app.id, assignmentId: null as string | null };
      }
      const assignment = await this.reserveSlot(tx, userId, app.jobId, app.id);
      await tx.workApplication.update({ where: { id: app.id }, data: { status: WorkApplicationStatus.ACCEPTED } });
      await this.audit.record(tx, { entityType: 'APPLICATION', entityId: app.id, action: 'OFFER_ACCEPTED', fromStatus: 'OFFERED', toStatus: 'ACCEPTED', actorUserId: userId, actorParty: WorkParty.WORKER, jobId: app.jobId, metadata: { assignmentId: assignment.id } });
      return { applicationId: app.id, assignmentId: assignment.id as string | null };
    });
    this.deadlines?.signal('work');
    return r;
  }

  // =========================================================================== reading

  private async loadForParty(userId: string, assignmentId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const a = await db.workAssignment.findUnique({ where: { id: assignmentId }, include: { job: { include: JOB_REFS } } });
    if (!a) throw workNotFound('Assignment not found.');
    if (a.workerId === userId) return { a, party: WorkParty.WORKER as WorkParty, role: null as WorkOrgMemberRole | null };
    const member = await db.workOrgMember.findUnique({ where: { orgId_userId: { orgId: a.job.orgId, userId } } });
    if (!member) throw workNotFound('Assignment not found.');
    return { a, party: WorkParty.EMPLOYER as WorkParty, role: member.role };
  }

  async detail(userId: string, assignmentId: string, asAdmin = false): Promise<WorkAssignmentDetailDto> {
    let party: WorkParty;
    let job: JobWithRefs;
    let a: WorkAssignment;
    if (asAdmin) {
      const row = await this.prisma.workAssignment.findUnique({ where: { id: assignmentId }, include: { job: { include: JOB_REFS } } });
      if (!row) throw workNotFound('Assignment not found.');
      a = row;
      job = row.job;
      party = WorkParty.PLATFORM;
    } else {
      const r = await this.loadForParty(userId, assignmentId);
      a = r.a;
      job = r.a.job;
      party = r.party;
    }
    const [profile, responses, disputes, payout, timeline, trust, reliability] = await Promise.all([
      this.prisma.workerProfile.findUnique({ where: { userId: a.workerId } }),
      this.prisma.workTaskResponse.findMany({ where: { assignmentId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.workDispute.findMany({ where: { assignmentId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.workPayout.findFirst({ where: { assignmentId }, orderBy: { attempt: 'desc' } }),
      this.audit.timeline('ASSIGNMENT', assignmentId),
      employerTrust(this.prisma, [job.org]),
      this.workers.reliability(this.prisma, a.workerId),
    ]);
    // Workers see the terms they accepted, not whatever the job says now.
    const jobDto = toJobDetail(job, trust.get(job.orgId)!);
    jobDto.checklist = snapshotChecklist(a);
    jobDto.cancellationTerms = snapshotTerms(a);
    jobDto.reviewWindowHours = snapshotReviewHours(a);
    return {
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
      payoutStatus: payout?.status ?? null,
      slotNumber: a.slotNumber,
      job: jobDto,
      worker: { userId: a.workerId, fullName: profile?.fullName ?? 'Worker', verificationLevel: profile?.verificationLevel ?? 0, completedAssignments: reliability.completed },
      checkedInAt: a.checkedInAt?.toISOString() ?? null,
      checkInMethod: a.checkInMethod,
      submittedAt: a.submittedAt?.toISOString() ?? null,
      reviewDueAt: a.reviewDueAt?.toISOString() ?? null,
      reviewNote: a.reviewNote,
      responses: responses.map((r) => ({ itemId: r.itemId, confirmed: r.confirmed, text: r.text, evidenceFileId: r.evidenceFileId, duplicateFlag: party === WorkParty.WORKER ? false : r.duplicateFlag, updatedAt: r.updatedAt.toISOString() })),
      disputes: disputes.map((d) => ({ id: d.id, assignmentId: d.assignmentId, openedBy: d.openedByParty, reasonCode: d.reasonCode, description: d.description, status: d.status, awardPaise: d.awardPaise, resolutionNote: d.resolutionNote, createdAt: d.createdAt.toISOString(), resolvedAt: d.resolvedAt?.toISOString() ?? null })),
      timeline,
      ...(party === WorkParty.EMPLOYER && job.requiresCheckIn ? { checkInCode: job.checkInCode } : {}),
    };
  }

  // =========================================================================== execution

  private async transition(
    tx: Tx,
    a: WorkAssignment,
    to: WorkAssignmentStatus,
    data: Prisma.WorkAssignmentUpdateInput,
    audit: { action: string; actorUserId: string | null; actorParty: WorkParty; orgId: string; note?: string | null; metadata?: Record<string, unknown> },
  ) {
    if (!canTransitionWorkAssignment(a.status, to)) {
      throw workInvalidState(`This assignment is ${a.status.toLowerCase().replace(/_/g, ' ')}; that action is not possible now.`, { status: a.status });
    }
    await tx.workAssignment.update({ where: { id: a.id }, data: { ...data, status: to } });
    await this.audit.record(tx, { entityType: 'ASSIGNMENT', entityId: a.id, action: audit.action, fromStatus: a.status, toStatus: to, actorUserId: audit.actorUserId, actorParty: audit.actorParty, orgId: audit.orgId, jobId: a.jobId, note: audit.note ?? null, metadata: audit.metadata });
  }

  private async lockedForWorker(tx: Tx, userId: string, assignmentId: string) {
    await lockAssignment(tx, assignmentId);
    const a = await tx.workAssignment.findFirst({ where: { id: assignmentId, workerId: userId }, include: { job: true } });
    if (!a) throw workNotFound('Assignment not found.');
    return a;
  }

  private async lockedForOrg(tx: Tx, orgId: string, assignmentId: string) {
    await lockAssignment(tx, assignmentId);
    const a = await tx.workAssignment.findFirst({ where: { id: assignmentId, job: { orgId } }, include: { job: true } });
    if (!a) throw workNotFound('Assignment not found.');
    return a;
  }

  /**
   * Check-in with the minimum monitoring necessary: one reading, taken only when the worker
   * presses check-in, only with explicit consent for GPS. QR/code check-in needs no location at
   * all, and an employer can confirm attendance instead (for GPS failure or accessibility needs).
   */
  async checkIn(userId: string, assignmentId: string, input: WorkCheckInInput) {
    return this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForWorker(tx, userId, assignmentId);
      const now = Date.now();
      if (now < a.job.startsAt.getTime() - WORK_LIMITS.checkInEarlyMinutes * 60_000) throw workInvalidState('Check-in opens one hour before the start time.');
      if (now > a.job.endsAt.getTime()) throw workInvalidState('This shift has already ended.');
      let method: WorkCheckInMethod;
      let lat: number | null = null;
      let lng: number | null = null;
      if (input.method === 'QR_CODE') {
        if (!input.code || input.code !== a.job.checkInCode) throw workError(WorkErrorCode.INVALID_CHECK_IN_CODE, 'That check-in code is not right. Ask the person in charge on site.', HttpStatus.UNPROCESSABLE_ENTITY);
        method = WorkCheckInMethod.QR_CODE;
      } else if (input.method === 'GPS') {
        if (!input.locationConsent || input.latitude === undefined || input.longitude === undefined) throw workValidation('Location check-in needs your permission and a location reading.');
        method = WorkCheckInMethod.GPS;
        lat = input.latitude;
        lng = input.longitude;
      } else {
        if (a.job.requiresCheckIn) throw workValidation('This job needs the on-site code or a location check-in. If neither works, ask the employer to confirm your attendance.');
        method = WorkCheckInMethod.SELF_REPORTED;
      }
      await this.transition(tx, a, WorkAssignmentStatus.CHECKED_IN, { checkedInAt: new Date(), checkInMethod: method, checkInLatitude: lat, checkInLongitude: lng }, { action: 'CHECKED_IN', actorUserId: userId, actorParty: WorkParty.WORKER, orgId: a.job.orgId, metadata: { method } });
      await this.markJobStarted(tx, a.jobId, a.job.orgId);
      return { id: a.id, status: WorkAssignmentStatus.CHECKED_IN };
    });
  }

  async confirmAttendance(userId: string, orgId: string, assignmentId: string) {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    return this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForOrg(tx, orgId, assignmentId);
      await this.transition(tx, a, WorkAssignmentStatus.CHECKED_IN, { checkedInAt: a.checkedInAt ?? new Date(), checkInMethod: WorkCheckInMethod.EMPLOYER_CONFIRMED }, { action: 'ATTENDANCE_CONFIRMED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId });
      await this.markJobStarted(tx, a.jobId, orgId);
      return { id: a.id, status: WorkAssignmentStatus.CHECKED_IN };
    });
  }

  private async markJobStarted(tx: Tx, jobId: string, orgId: string) {
    await lockJob(tx, jobId);
    const job = await tx.workJob.findUniqueOrThrow({ where: { id: jobId } });
    if (CAPACITY_TRACKED.includes(job.status)) {
      await tx.workJob.update({ where: { id: jobId }, data: { status: WorkJobStatus.IN_PROGRESS } });
      await this.audit.record(tx, { entityType: 'JOB', entityId: jobId, action: 'JOB_STARTED', fromStatus: job.status, toStatus: 'IN_PROGRESS', actorParty: WorkParty.SYSTEM, orgId, jobId });
    }
  }

  async saveResponse(userId: string, assignmentId: string, itemId: string, body: { confirmed?: boolean; text?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForWorker(tx, userId, assignmentId);
      if (!EDITABLE_RESPONSES.includes(a.status)) throw workInvalidState('Task answers can only be changed while the work is in progress or after a rework request.');
      if (a.status === WorkAssignmentStatus.ACCEPTED && a.job.requiresCheckIn) throw workInvalidState('Check in before recording your work.');
      const item = snapshotChecklist(a).find((i) => i.id === itemId);
      if (!item) throw workNotFound('Checklist item not found.');
      if (item.kind === 'PHOTO') throw workValidation('Upload a photo for this item.');
      const text = item.kind === 'TEXT' ? body.text?.trim() || null : null;
      const normalized = text ? normalizeAnswer(text) : null;
      let duplicateFlag = false;
      if (item.uniqueAcrossJob && normalized) {
        const dup = await tx.workTaskResponse.findFirst({ where: { itemId, normalizedText: normalized, assignmentId: { not: a.id }, assignment: { jobId: a.jobId } }, select: { id: true } });
        duplicateFlag = !!dup;
      }
      const saved = await tx.workTaskResponse.upsert({
        where: { assignmentId_itemId: { assignmentId: a.id, itemId } },
        create: { assignmentId: a.id, itemId, confirmed: item.kind === 'CONFIRM' ? !!body.confirmed : !!text, text, normalizedText: normalized, duplicateFlag },
        update: { confirmed: item.kind === 'CONFIRM' ? !!body.confirmed : !!text, text, normalizedText: normalized, duplicateFlag },
      });
      return { itemId, confirmed: saved.confirmed, text: saved.text, duplicateFlag: false };
    });
  }

  /**
   * Private evidence photo. The stored type is what the bytes are (magic-byte check), never what
   * the client claims; size is capped; the SHA-256 is used to flag the same photo being reused
   * on another assignment. A flag is shown to the reviewer — it never rejects work on its own.
   */
  async uploadEvidence(userId: string, assignmentId: string, itemId: string, file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw workError(WorkErrorCode.EVIDENCE_INVALID, 'Choose a photo to upload.', HttpStatus.UNPROCESSABLE_ENTITY);
    if (file.buffer.length > WORK_LIMITS.maxEvidenceBytes) throw workError(WorkErrorCode.EVIDENCE_INVALID, 'Photos must be 3 MB or smaller.', HttpStatus.UNPROCESSABLE_ENTITY);
    const mime = detectImageMimeType(file.buffer);
    if (!mime) throw workError(WorkErrorCode.EVIDENCE_INVALID, 'Only JPEG, PNG or WebP photos are accepted.', HttpStatus.UNPROCESSABLE_ENTITY);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForWorker(tx, userId, assignmentId);
      if (!EDITABLE_RESPONSES.includes(a.status)) throw workInvalidState('Evidence can only be added while the work is in progress or after a rework request.');
      if (a.status === WorkAssignmentStatus.ACCEPTED && a.job.requiresCheckIn) throw workInvalidState('Check in before recording your work.');
      const item = snapshotChecklist(a).find((i) => i.id === itemId);
      if (!item || item.kind !== 'PHOTO') throw workNotFound('Photo checklist item not found.');
      const reused = await tx.workEvidenceFile.findFirst({ where: { sha256, assignmentId: { not: a.id } }, select: { id: true } });
      const fileRow = await tx.workEvidenceFile.create({ data: { assignmentId: a.id, uploadedById: userId, mimeType: mime, sizeBytes: file.buffer.length, sha256, content: file.buffer } });
      const prior = await tx.workTaskResponse.findUnique({ where: { assignmentId_itemId: { assignmentId: a.id, itemId } } });
      await tx.workTaskResponse.upsert({
        where: { assignmentId_itemId: { assignmentId: a.id, itemId } },
        create: { assignmentId: a.id, itemId, confirmed: true, evidenceFileId: fileRow.id, duplicateFlag: !!reused },
        update: { confirmed: true, evidenceFileId: fileRow.id, duplicateFlag: !!reused },
      });
      if (prior?.evidenceFileId) await tx.workEvidenceFile.delete({ where: { id: prior.evidenceFileId } });
      return { itemId, evidenceFileId: fileRow.id, sizeBytes: fileRow.sizeBytes };
    });
  }

  async evidenceFile(userId: string, fileId: string, asAdmin = false) {
    const file = await this.prisma.workEvidenceFile.findUnique({ where: { id: fileId } });
    if (!file) throw workNotFound('File not found.');
    if (!asAdmin) await this.loadForParty(userId, file.assignmentId); // worker or employer of that assignment only
    return { mimeType: file.mimeType, content: Buffer.from(file.content) };
  }

  async submit(userId: string, assignmentId: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForWorker(tx, userId, assignmentId);
      if (a.status === WorkAssignmentStatus.ACCEPTED && a.job.requiresCheckIn) throw workInvalidState('Check in before submitting your work.');
      const responses = await tx.workTaskResponse.findMany({ where: { assignmentId } });
      const missing = snapshotChecklist(a)
        .filter((i) => i.required)
        .filter((i) => {
          const r = responses.find((x) => x.itemId === i.id);
          if (!r) return true;
          if (i.kind === 'PHOTO') return !r.evidenceFileId;
          if (i.kind === 'TEXT') return !r.text;
          return !r.confirmed;
        })
        .map((i) => i.id);
      if (missing.length) throw workError(WorkErrorCode.CHECKLIST_INCOMPLETE, 'Complete every required checklist item first.', HttpStatus.UNPROCESSABLE_ENTITY, { missing });
      const reviewDueAt = new Date(Date.now() + snapshotReviewHours(a) * 3600_000);
      await this.transition(tx, a, WorkAssignmentStatus.SUBMITTED, { submittedAt: new Date(), reviewDueAt }, { action: a.status === WorkAssignmentStatus.REWORK_REQUESTED ? 'RESUBMITTED' : 'SUBMITTED', actorUserId: userId, actorParty: WorkParty.WORKER, orgId: a.job.orgId, metadata: { reviewDueAt: reviewDueAt.toISOString() } });
      await this.notifyOrg(tx, a.job.orgId, 'work.submission.received', { jobId: a.jobId, assignmentId: a.id, reviewDueAt: reviewDueAt.toISOString() }, `/work/business/${a.job.orgId}/assignments/${a.id}`);
      return { id: a.id, status: WorkAssignmentStatus.SUBMITTED, reviewDueAt: reviewDueAt.toISOString() };
    });
    this.deadlines?.signal('work');
    return r;
  }

  /**
   * Employer review: approve the full agreed pay, or ask for rework (at most twice). Paying less
   * is only possible through a dispute that a platform reviewer decides.
   */
  async review(userId: string, orgId: string, assignmentId: string, input: WorkReviewInput) {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    let payoutId: string | null = null;
    const r = await this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForOrg(tx, orgId, assignmentId);
      if (a.status !== WorkAssignmentStatus.SUBMITTED) throw workInvalidState('Only submitted work can be reviewed.');
      if (input.decision === 'APPROVE') {
        ({ payoutId } = await this.payments.makePayable(tx, { assignmentId: a.id, amountPaise: a.agreedPayPaise, reason: 'APPROVED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, note: input.note ?? null }));
        await tx.workAssignment.update({ where: { id: a.id }, data: { reviewedAt: new Date(), reviewNote: input.note ?? null } });
        await this.notifications.notifyInTransaction(tx, a.workerId, 'work.submission.approved', { assignmentId: a.id, amountPaise: a.agreedPayPaise }, `/work/me/assignments/${a.id}`);
        return { id: a.id, status: WorkAssignmentStatus.PAYABLE };
      }
      const rounds = await tx.workAuditEvent.count({ where: { entityType: 'ASSIGNMENT', entityId: a.id, action: 'REWORK_REQUESTED' } });
      if (rounds >= WORK_LIMITS.maxReworkRounds) throw workInvalidState('Rework has already been requested twice. Approve the work or open a dispute for a platform review.');
      await this.transition(tx, a, WorkAssignmentStatus.REWORK_REQUESTED, { reviewNote: input.note, reviewDueAt: null }, { action: 'REWORK_REQUESTED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, note: input.note });
      await this.notifications.notifyInTransaction(tx, a.workerId, 'work.rework.requested', { assignmentId: a.id }, `/work/me/assignments/${a.id}`);
      return { id: a.id, status: WorkAssignmentStatus.REWORK_REQUESTED };
    });
    if (payoutId) await this.payments.initiatePayout(payoutId);
    return r;
  }

  // =========================================================================== cancellations

  async workerCancel(userId: string, assignmentId: string, reason: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForWorker(tx, userId, assignmentId);
      if (a.status !== WorkAssignmentStatus.ACCEPTED) throw workInvalidState('You can only withdraw before checking in. Contact the employer or open a dispute.');
      const terms = snapshotTerms(a);
      const late = Date.now() > a.job.startsAt.getTime() - terms.workerLateCancelHours * 3600_000;
      await lockJob(tx, a.jobId);
      await this.transition(tx, a, WorkAssignmentStatus.WITHDRAWN, { cancelledAt: new Date(), cancelReason: reason, lateCancellation: late }, { action: late ? 'WORKER_LATE_CANCELLED' : 'WORKER_WITHDREW', actorUserId: userId, actorParty: WorkParty.WORKER, orgId: a.job.orgId, note: reason });
      await this.recomputeCapacity(tx, a.jobId);
      return { id: a.id, status: WorkAssignmentStatus.WITHDRAWN, lateCancellation: late };
    });
    return r;
  }

  /**
   * Employer cancels one worker. The compensation the job disclosed applies automatically:
   * after the worker checked in, the arrival compensation; before arrival but inside the worker's
   * late-cancel window, the late-cancel compensation. Compensation becomes a payable obligation.
   */
  async employerCancel(userId: string, orgId: string, assignmentId: string, reason: string) {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    let payoutId: string | null = null;
    const r = await this.prisma.$transaction(async (tx) => {
      await this.lockedForOrg(tx, orgId, assignmentId);
      payoutId = await this.employerCancelInTx(tx, assignmentId, userId, reason);
      const a = await tx.workAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      return { id: a.id, status: a.status, compensationPaise: a.approvedAmountPaise ?? 0 };
    });
    if (payoutId) await this.payments.initiatePayout(payoutId);
    return r;
  }

  /** Used by single-worker and whole-job cancellation. Caller holds the job/assignment locks. */
  async employerCancelInTx(tx: Tx, assignmentId: string, userId: string, reason: string): Promise<string | null> {
    await lockAssignment(tx, assignmentId);
    const a = await tx.workAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { job: true } });
    const terms = snapshotTerms(a);
    let compensation = 0;
    if (a.status === WorkAssignmentStatus.CHECKED_IN) compensation = terms.employerCancelAfterArrivalPaise;
    else if (a.status === WorkAssignmentStatus.ACCEPTED && Date.now() > a.job.startsAt.getTime() - terms.workerLateCancelHours * 3600_000) compensation = terms.employerLateCancelPaise;
    else if (a.status !== WorkAssignmentStatus.ACCEPTED && a.status !== WorkAssignmentStatus.NO_SHOW_REVIEW) {
      throw workInvalidState('Submitted work must be reviewed, not cancelled.');
    }
    await this.audit.record(tx, { entityType: 'ASSIGNMENT', entityId: a.id, action: 'EMPLOYER_CANCELLED_ASSIGNMENT', fromStatus: a.status, actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId: a.job.orgId, jobId: a.jobId, note: reason, metadata: { compensationPaise: compensation } });
    if (compensation > 0) {
      await tx.workAssignment.update({ where: { id: a.id }, data: { cancelledAt: new Date(), cancelReason: reason } });
      const { payoutId } = await this.payments.makePayable(tx, { assignmentId: a.id, amountPaise: compensation, reason: 'CANCELLATION_COMPENSATION', actorUserId: userId, actorParty: WorkParty.EMPLOYER, note: reason });
      return payoutId;
    }
    await this.transition(tx, a, WorkAssignmentStatus.CANCELLED, { cancelledAt: new Date(), cancelReason: reason }, { action: 'ASSIGNMENT_CANCELLED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId: a.job.orgId, note: reason });
    await lockJob(tx, a.jobId);
    await this.recomputeCapacity(tx, a.jobId);
    return null;
  }

  async flagNoShow(userId: string, orgId: string, assignmentId: string) {
    await this.access.requireOrgRole(userId, orgId, JOB_EDITORS);
    return this.prisma.$transaction(async (tx) => {
      const a = await this.lockedForOrg(tx, orgId, assignmentId);
      if (Date.now() < a.job.startsAt.getTime() + WORK_LIMITS.noShowGraceMinutes * 60_000) throw workInvalidState('A no-show can be reported 30 minutes after the start time.');
      await this.transition(tx, a, WorkAssignmentStatus.NO_SHOW_REVIEW, {}, { action: 'NO_SHOW_REPORTED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId, metadata: { workerId: a.workerId } });
      this.deadlines?.signal('work');
      return { id: a.id, status: WorkAssignmentStatus.NO_SHOW_REVIEW };
    });
  }

  // =========================================================================== deadlines

  private async nextDeadline(): Promise<Date | null> {
    const [review, noShow, unfunded] = await Promise.all([
      this.prisma.workAssignment.findFirst({ where: { status: WorkAssignmentStatus.SUBMITTED, reviewDueAt: { not: null } }, orderBy: { reviewDueAt: 'asc' }, select: { reviewDueAt: true } }),
      this.prisma.workAssignment.findFirst({ where: { status: WorkAssignmentStatus.NO_SHOW_REVIEW }, orderBy: { updatedAt: 'asc' }, select: { updatedAt: true } }),
      this.prisma.workJob.findFirst({ where: { status: { in: [WorkJobStatus.FUNDING_REQUIRED, WorkJobStatus.PENDING_VERIFICATION, WorkJobStatus.OPEN] }, filledCount: 0 }, orderBy: { startsAt: 'asc' }, select: { startsAt: true } }),
    ]);
    const candidates = [review?.reviewDueAt ?? null, noShow ? new Date(noShow.updatedAt.getTime() + WORK_LIMITS.noShowDisputeHours * 3600_000) : null, unfunded?.startsAt ?? null].filter((d): d is Date => !!d);
    return candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
  }

  /**
   * The documented default-resolution rules, so an employer can never delay pay by not
   * responding:
   *  - submitted work not reviewed within the disclosed review window is approved in full;
   *  - a no-show report the worker has not disputed within 72 hours is upheld (no pay, counted
   *    in reliability), and the slot is released;
   *  - an unfunded or untaken job whose start time has passed expires and releases its funds.
   */
  async sweep(now = new Date()): Promise<{ autoApproved: number; noShowsUpheld: number; jobsExpired: number }> {
    let autoApproved = 0;
    let noShowsUpheld = 0;
    let jobsExpired = 0;
    const overdue = await this.prisma.workAssignment.findMany({ where: { status: WorkAssignmentStatus.SUBMITTED, reviewDueAt: { lte: now } }, select: { id: true }, take: 100 });
    for (const { id } of overdue) {
      let payoutId: string | null = null;
      await this.prisma.$transaction(async (tx) => {
        await lockAssignment(tx, id);
        const a = await tx.workAssignment.findUniqueOrThrow({ where: { id } });
        if (a.status !== WorkAssignmentStatus.SUBMITTED || !a.reviewDueAt || a.reviewDueAt > now) return;
        ({ payoutId } = await this.payments.makePayable(tx, { assignmentId: id, amountPaise: a.agreedPayPaise, reason: 'AUTO_APPROVED', actorUserId: null, actorParty: WorkParty.SYSTEM, note: 'Approved automatically: the review window ended without a decision' }));
        await this.notifications.notifyInTransaction(tx, a.workerId, 'work.submission.approved', { assignmentId: id, amountPaise: a.agreedPayPaise, automatic: true }, `/work/me/assignments/${id}`);
        autoApproved += 1;
      });
      if (payoutId) await this.payments.initiatePayout(payoutId);
    }

    const cutoff = new Date(now.getTime() - WORK_LIMITS.noShowDisputeHours * 3600_000);
    const noShows = await this.prisma.workAssignment.findMany({ where: { status: WorkAssignmentStatus.NO_SHOW_REVIEW, updatedAt: { lte: cutoff } }, include: { job: true }, take: 100 });
    for (const row of noShows) {
      await this.prisma.$transaction(async (tx) => {
        await lockAssignment(tx, row.id);
        const a = await tx.workAssignment.findUniqueOrThrow({ where: { id: row.id } });
        if (a.status !== WorkAssignmentStatus.NO_SHOW_REVIEW) return;
        await this.transition(tx, a, WorkAssignmentStatus.CLOSED_UNPAID, {}, { action: 'NO_SHOW_UPHELD', actorUserId: null, actorParty: WorkParty.SYSTEM, orgId: row.job.orgId, note: 'Not disputed within 72 hours', metadata: { workerId: a.workerId } });
        await lockJob(tx, a.jobId);
        await this.recomputeCapacity(tx, a.jobId);
        noShowsUpheld += 1;
      });
    }

    const stale = await this.prisma.workJob.findMany({
      where: { startsAt: { lte: now }, OR: [{ status: { in: [WorkJobStatus.FUNDING_REQUIRED, WorkJobStatus.PENDING_VERIFICATION, WorkJobStatus.DRAFT] } }, { status: WorkJobStatus.OPEN, filledCount: 0 }] },
      select: { id: true },
      take: 100,
    });
    for (const { id } of stale) {
      await this.prisma.$transaction(async (tx) => {
        await lockJob(tx, id);
        const job = await tx.workJob.findUniqueOrThrow({ where: { id } });
        const expirable: WorkJobStatus[] = [WorkJobStatus.FUNDING_REQUIRED, WorkJobStatus.OPEN];
        if (job.startsAt > now) return;
        if (job.status === WorkJobStatus.DRAFT || job.status === WorkJobStatus.PENDING_VERIFICATION) {
          await tx.workJob.update({ where: { id }, data: { status: WorkJobStatus.CANCELLED } });
          await this.audit.record(tx, { entityType: 'JOB', entityId: id, action: 'JOB_LAPSED_UNPUBLISHED', fromStatus: job.status, toStatus: 'CANCELLED', actorParty: WorkParty.SYSTEM, orgId: job.orgId, jobId: id });
          return;
        }
        if (!expirable.includes(job.status) || job.filledCount > 0) return;
        await tx.workJob.update({ where: { id }, data: { status: WorkJobStatus.EXPIRED } });
        await this.audit.record(tx, { entityType: 'JOB', entityId: id, action: 'JOB_EXPIRED', fromStatus: job.status, toStatus: 'EXPIRED', actorParty: WorkParty.SYSTEM, orgId: job.orgId, jobId: id });
        await this.payments.releaseRemaining(tx, id, job.orgId, 'expired', 'Job expired with no workers');
        jobsExpired += 1;
      });
    }
    if (autoApproved || noShowsUpheld || jobsExpired) this.logger.log(`Work sweep: ${autoApproved} auto-approved, ${noShowsUpheld} no-shows upheld, ${jobsExpired} jobs expired.`);
    return { autoApproved, noShowsUpheld, jobsExpired };
  }

  // =========================================================================== helpers

  private async notifyOrg(tx: Tx, orgId: string, type: NotificationType, payload: Record<string, unknown>, deepLink: string) {
    const members = await tx.workOrgMember.findMany({ where: { orgId, role: { in: JOB_EDITORS } }, select: { userId: true } });
    for (const m of members) await this.notifications.notifyInTransaction(tx, m.userId, type, payload, deepLink);
  }

  /** Disputes need to know who may act on an assignment; exposed for WorkDisputesService. */
  async partyOf(userId: string, assignmentId: string) {
    const { a, party } = await this.loadForParty(userId, assignmentId);
    if (party === WorkParty.EMPLOYER) await this.access.requireOrgRole(userId, a.job.orgId, JOB_EDITORS);
    return { assignment: a, party };
  }

  assertWorker(party: WorkParty) {
    if (party !== WorkParty.WORKER) throw workForbidden();
  }
}

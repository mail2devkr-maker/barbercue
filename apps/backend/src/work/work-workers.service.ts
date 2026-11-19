import { Injectable } from '@nestjs/common';
import { WorkAssignmentStatus, WorkParty, WorkPayoutStatus, type WorkerProfile } from '@prisma/client';
import {
  ageOn,
  WORK_LIMITS,
  type WorkAssignmentSummaryDto,
  type WorkerDashboardDto,
  type WorkerEarningsDto,
  type WorkerProfileDto,
  type WorkerProfileUpsertInput,
  type WorkerReliabilityDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkAuditService } from './work-audit.service';
import { WorkAccount, WorkLedgerService } from './work-ledger.service';
import { WorkPaymentsService } from './work-payments.service';
import { workNotFound, workValidation } from './work-errors';
import { maskVpa, type Db } from './work-internal';

@Injectable()
export class WorkWorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: WorkAuditService,
    private readonly ledger: WorkLedgerService,
    private readonly payments: WorkPaymentsService,
  ) {}

  toDto(p: WorkerProfile, phoneVerified: boolean): WorkerProfileDto {
    return {
      userId: p.userId,
      fullName: p.fullName,
      workerType: p.workerType,
      dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
      city: p.city,
      locality: p.locality,
      workRadiusKm: p.workRadiusKm,
      languages: p.languages,
      skills: p.skills,
      preferredCategories: p.preferredCategories,
      collegeName: p.collegeName,
      bio: p.bio,
      verificationLevel: p.verificationLevel,
      payoutUpiVpaMasked: maskVpa(p.payoutUpiVpa),
      phoneVerified,
    };
  }

  async getProfile(userId: string): Promise<WorkerProfileDto | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true, workerProfile: true } });
    if (!user?.workerProfile) return null;
    return this.toDto(user.workerProfile, !!user.phoneVerifiedAt);
  }

  /**
   * Creates or updates the caller's own worker profile. Level 1 verification comes only from the
   * phone the user already verified at login; the profile form can never raise its own level.
   * Leaving payoutUpiVpa out keeps the saved one; sending null removes it.
   */
  async upsertProfile(userId: string, input: WorkerProfileUpsertInput): Promise<WorkerProfileDto> {
    const dob = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(dob.getTime())) throw workValidation('Enter a valid date of birth.');
    if (ageOn(dob, new Date()) < WORK_LIMITS.minAge) {
      throw workValidation('FastQue Work is open to people aged 18 and over.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true } });
    if (!user) throw workNotFound('Account not found.');
    const phoneLevel = user.phoneVerifiedAt ? 1 : 0;
    const data = {
      fullName: input.fullName,
      workerType: input.workerType,
      dateOfBirth: dob,
      city: input.city,
      locality: input.locality ?? null,
      workRadiusKm: input.workRadiusKm,
      languages: input.languages,
      skills: [...new Set(input.skills)],
      preferredCategories: input.preferredCategories,
      collegeName: input.collegeName ?? null,
      bio: input.bio ?? null,
      ...(input.payoutUpiVpa === undefined ? {} : { payoutUpiVpa: input.payoutUpiVpa }),
    };
    const profile = await this.prisma.$transaction(async (tx) => {
      const before = await tx.workerProfile.findUnique({ where: { userId } });
      const saved = before
        ? await tx.workerProfile.update({
            where: { userId },
            // Never lowers a reviewer-granted level; only fills in the phone level if missing.
            data: { ...data, verificationLevel: Math.max(before.verificationLevel, phoneLevel) },
          })
        : await tx.workerProfile.create({ data: { ...data, userId, verificationLevel: phoneLevel } });
      await this.audit.record(tx, {
        entityType: 'WORKER',
        entityId: userId,
        action: before ? 'PROFILE_UPDATED' : 'PROFILE_CREATED',
        actorUserId: userId,
        actorParty: WorkParty.WORKER,
        metadata: { payoutMethodChanged: input.payoutUpiVpa !== undefined },
      });
      return saved;
    });
    if (profile.payoutUpiVpa) await this.payments.initiatePendingPayoutsFor(userId);
    return this.toDto(profile, !!user.phoneVerifiedAt);
  }

  async reliability(db: Db, workerId: string): Promise<WorkerReliabilityDto> {
    const [completed, late, noShows] = await Promise.all([
      db.workAssignment.count({ where: { workerId, status: { in: [WorkAssignmentStatus.PAYABLE, WorkAssignmentStatus.PAID] } } }),
      db.workAssignment.count({ where: { workerId, lateCancellation: true } }),
      db.workAuditEvent.count({ where: { action: 'NO_SHOW_UPHELD', metadata: { path: ['workerId'], equals: workerId } } }),
    ]);
    const denom = completed + late + noShows;
    return { completed, lateCancellations: late, noShows, reliabilityRate: denom ? completed / denom : null };
  }

  async earnings(workerId: string): Promise<WorkerEarningsDto> {
    const [payableSigned, paid, pending, entries] = await Promise.all([
      this.ledger.balance(this.prisma, WorkAccount.workerPayable(workerId)),
      this.prisma.workPayout.aggregate({ where: { workerId, status: WorkPayoutStatus.SUCCEEDED }, _sum: { amountPaise: true } }),
      this.prisma.workAssignment.aggregate({
        where: { workerId, status: { in: [WorkAssignmentStatus.ACCEPTED, WorkAssignmentStatus.CHECKED_IN, WorkAssignmentStatus.SUBMITTED, WorkAssignmentStatus.REWORK_REQUESTED, WorkAssignmentStatus.DISPUTED] } },
        _sum: { agreedPayPaise: true },
      }),
      this.prisma.workLedgerEntry.findMany({
        where: { accountCode: WorkAccount.workerPayable(workerId) },
        include: { journal: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const jobIds = [...new Set(entries.map((e) => e.journal.jobId).filter((x): x is string => !!x))];
    const jobs = jobIds.length ? await this.prisma.workJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true } }) : [];
    return {
      payablePaise: -payableSigned,
      paidPaise: paid._sum.amountPaise ?? 0,
      pendingReviewPaise: pending._sum.agreedPayPaise ?? 0,
      transactions: entries.map((e) => ({
        id: e.id,
        kind: e.journal.kind === 'PAYOUT_SETTLED' ? 'PAID_OUT' : 'EARNED',
        // Worker's perspective: earned is +, paid out reduces what is owed.
        amountPaise: -e.amountPaise,
        createdAt: e.createdAt.toISOString(),
        assignmentId: e.journal.assignmentId,
        jobTitle: jobs.find((j) => j.id === e.journal.jobId)?.title ?? null,
      })),
    };
  }

  async dashboard(userId: string): Promise<WorkerDashboardDto> {
    const profile = await this.getProfile(userId);
    const rows = await this.prisma.workAssignment.findMany({
      where: { workerId: userId },
      include: { job: { include: { org: true } }, payouts: { orderBy: { attempt: 'desc' }, take: 1 } },
      orderBy: { job: { startsAt: 'asc' } },
      take: 200,
    });
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 24 * 3600_000);
    const summary = (a: (typeof rows)[number]): WorkAssignmentSummaryDto => ({
      id: a.id,
      jobId: a.jobId,
      jobTitle: a.job.title,
      employerName: a.job.org.displayName,
      city: a.job.city,
      startsAt: a.job.startsAt.toISOString(),
      endsAt: a.job.endsAt.toISOString(),
      status: a.status,
      agreedPayPaise: a.agreedPayPaise,
      approvedAmountPaise: a.approvedAmountPaise,
      payoutStatus: a.payouts[0]?.status ?? null,
    });
    const live = [WorkAssignmentStatus.ACCEPTED, WorkAssignmentStatus.CHECKED_IN] as WorkAssignmentStatus[];
    const review = [WorkAssignmentStatus.SUBMITTED, WorkAssignmentStatus.REWORK_REQUESTED, WorkAssignmentStatus.DISPUTED, WorkAssignmentStatus.NO_SHOW_REVIEW] as WorkAssignmentStatus[];
    const done = [WorkAssignmentStatus.PAYABLE, WorkAssignmentStatus.PAID, WorkAssignmentStatus.WITHDRAWN, WorkAssignmentStatus.CANCELLED, WorkAssignmentStatus.CLOSED_UNPAID] as WorkAssignmentStatus[];
    const applications = await this.prisma.workApplication.findMany({
      where: { workerId: userId },
      include: { job: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      profile,
      today: rows.filter((a) => live.includes(a.status) && a.job.startsAt < endOfDay && a.job.endsAt >= startOfDay).map(summary),
      upcoming: rows.filter((a) => live.includes(a.status) && a.job.startsAt >= endOfDay).map(summary),
      awaitingReview: rows.filter((a) => review.includes(a.status)).map(summary),
      completed: rows.filter((a) => done.includes(a.status)).reverse().map(summary),
      applications: applications.map((x) => ({ id: x.id, jobId: x.jobId, jobTitle: x.job.title, status: x.status, createdAt: x.createdAt.toISOString() })),
      earnings: await this.earnings(userId),
      reliability: await this.reliability(this.prisma, userId),
    };
  }

  // ---- admin ----

  async adminVerify(adminId: string, userId: string, note: string): Promise<WorkerProfileDto> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const p = await tx.workerProfile.findUnique({ where: { userId } });
      if (!p) throw workNotFound('Worker profile not found.');
      if (p.verificationLevel < 1) throw workValidation('The worker must verify their phone first.');
      const saved = await tx.workerProfile.update({ where: { userId }, data: { verificationLevel: Math.max(2, p.verificationLevel), verifiedById: adminId, verifiedAt: new Date() } });
      await this.audit.record(tx, { entityType: 'WORKER', entityId: userId, action: 'WORKER_VERIFIED_L2', fromStatus: String(p.verificationLevel), toStatus: String(saved.verificationLevel), actorUserId: adminId, actorParty: WorkParty.PLATFORM, note });
      return saved;
    });
    return this.toDto(profile, true);
  }

  async adminSetSuspended(adminId: string, userId: string, suspended: boolean, reason: string): Promise<WorkerProfileDto> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const p = await tx.workerProfile.findUnique({ where: { userId } });
      if (!p) throw workNotFound('Worker profile not found.');
      const saved = await tx.workerProfile.update({ where: { userId }, data: { suspendedAt: suspended ? new Date() : null } });
      await this.audit.record(tx, { entityType: 'WORKER', entityId: userId, action: suspended ? 'WORKER_SUSPENDED' : 'WORKER_REINSTATED', actorUserId: adminId, actorParty: WorkParty.PLATFORM, note: reason });
      return saved;
    });
    return this.toDto(profile, true);
  }

  async adminList(q?: string) {
    const rows = await this.prisma.workerProfile.findMany({
      where: q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => ({ ...this.toDto(p, p.verificationLevel >= 1), suspended: !!p.suspendedAt, createdAt: p.createdAt.toISOString() }));
  }
}

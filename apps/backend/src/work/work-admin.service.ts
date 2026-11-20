import { Injectable } from '@nestjs/common';
import {
  WorkDisputeStatus,
  WorkJobStatus,
  WorkOrgStatus,
  WorkPayoutStatus,
} from '@prisma/client';
import type {
  WorkAdminOverviewDto,
  WorkLedgerTrialBalanceDto,
  WorkOrgReportDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkAccessService } from './work-access.service';
import { WorkAccount, WorkLedgerService } from './work-ledger.service';

@Injectable()
export class WorkAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WorkLedgerService,
    private readonly access: WorkAccessService,
  ) {}

  async trialBalance(): Promise<WorkLedgerTrialBalanceDto> {
    const tb = await this.ledger.trialBalance();
    const held =
      tb.accounts.find((a) => a.accountCode === WorkAccount.providerHeld)
        ?.balancePaise ?? 0;
    // Everything the provider holds must be owed to someone: employers (unused prefund), workers
    // (approved, not yet paid) or the platform (earned fees). Credits are negative.
    const obligations = -tb.accounts
      .filter((a) => a.accountCode !== WorkAccount.providerHeld)
      .reduce((acc, a) => acc + a.balancePaise, 0);
    return {
      balanced: tb.unbalancedJournals.length === 0 && held === obligations,
      unbalancedJournals: tb.unbalancedJournals,
      accounts: tb.accounts,
      providerHeldPaise: held,
      sumOfObligationsPaise: obligations,
    };
  }

  async overview(): Promise<WorkAdminOverviewDto> {
    const [
      workers,
      verifiedWorkers,
      orgGroups,
      jobGroups,
      assignmentGroups,
      payouts,
      openDisputes,
      tb,
    ] = await Promise.all([
      this.prisma.workerProfile.count(),
      this.prisma.workerProfile.count({
        where: { verificationLevel: { gte: 2 } },
      }),
      this.prisma.workOrganization.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.workJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.workAssignment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.workPayout.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { amountPaise: true },
      }),
      this.prisma.workDispute.count({
        where: { status: WorkDisputeStatus.OPEN },
      }),
      this.trialBalance(),
    ]);
    const orgs = Object.fromEntries(
      Object.values(WorkOrgStatus).map((s) => [
        s,
        orgGroups.find((g) => g.status === s)?._count._all ?? 0,
      ]),
    ) as WorkAdminOverviewDto['orgs'];
    const funded = await this.prisma.workLedgerEntry.aggregate({
      where: {
        accountCode: WorkAccount.providerHeld,
        journal: { kind: 'FUNDING_RECEIVED' },
      },
      _sum: { amountPaise: true },
    });
    const fees =
      tb.accounts.find((a) => a.accountCode === WorkAccount.platformFees)
        ?.balancePaise ?? 0;
    const liability = tb.accounts
      .filter((a) => a.accountCode.startsWith('WORKER_PAYABLE:'))
      .reduce((acc, a) => acc - a.balancePaise, 0);
    const succeeded = payouts.find(
      (p) => p.status === WorkPayoutStatus.SUCCEEDED,
    );
    const failed =
      payouts.find((p) => p.status === WorkPayoutStatus.FAILED)?._count._all ??
      0;
    const settledCount = (succeeded?._count._all ?? 0) + failed;
    return {
      workers,
      verifiedWorkers,
      orgs,
      jobs: Object.fromEntries(jobGroups.map((g) => [g.status, g._count._all])),
      assignments: Object.fromEntries(
        assignmentGroups.map((g) => [g.status, g._count._all]),
      ),
      grossFundedPaise: funded._sum.amountPaise ?? 0,
      platformFeesPaise: -fees,
      workerPayoutLiabilityPaise: liability,
      paidOutPaise: succeeded?._sum.amountPaise ?? 0,
      payoutSuccessRate: settledCount
        ? (succeeded?._count._all ?? 0) / settledCount
        : null,
      openDisputes,
      pendingKyc: orgs.SUBMITTED + orgs.UNDER_REVIEW,
      jobsAwaitingModeration:
        jobGroups.find((g) => g.status === WorkJobStatus.PENDING_VERIFICATION)
          ?._count._all ?? 0,
      ledgerBalanced: tb.balanced,
    };
  }

  async payouts(status?: WorkPayoutStatus) {
    const rows = await this.prisma.workPayout.findMany({
      where: status ? { status } : {},
      include: {
        assignment: {
          include: {
            job: {
              select: { title: true, org: { select: { displayName: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      assignmentId: p.assignmentId,
      workerId: p.workerId,
      jobTitle: p.assignment.job.title,
      orgName: p.assignment.job.org.displayName,
      amountPaise: p.amountPaise,
      attempt: p.attempt,
      provider: p.provider,
      status: p.status,
      failureReason: p.failureReason,
      manualUtr: p.manualUtr,
      createdAt: p.createdAt.toISOString(),
      settledAt: p.settledAt?.toISOString() ?? null,
    }));
  }

  async auditTrail(filter: {
    jobId?: string;
    entityType?: string;
    entityId?: string;
    orgId?: string;
  }) {
    const rows = await this.prisma.workAuditEvent.findMany({
      where: {
        ...(filter.jobId ? { jobId: filter.jobId } : {}),
        ...(filter.orgId ? { orgId: filter.orgId } : {}),
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** The employer's own financial report — scoped to their organization only. */
  async orgReport(userId: string, orgId: string): Promise<WorkOrgReportDto> {
    await this.access.requireOrgRole(userId, orgId);
    const t = await this.ledger.orgTotals(this.prisma, orgId);
    const jobs = await this.prisma.workJob.findMany({
      where: { orgId },
      select: {
        id: true,
        title: true,
        status: true,
        positions: true,
        filledCount: true,
        assignments: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      orgId,
      fundedPaise: t.funded,
      workerPayApprovedPaise: t.approvedPay,
      platformFeesPaise: t.fees,
      releasedToEmployerPaise: t.released,
      committedPaise: t.funded - t.approvedPay - t.fees - t.released,
      paidOutPaise: t.paidOut,
      owedToWorkersPaise: t.owedToWorkers,
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        positions: j.positions,
        filled: j.filledCount,
        approved: j.assignments.filter(
          (a) => a.status === 'PAYABLE' || a.status === 'PAID',
        ).length,
        paid: j.assignments.filter((a) => a.status === 'PAID').length,
      })),
    };
  }
}

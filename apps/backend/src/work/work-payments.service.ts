import { randomUUID } from 'crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  WorkAssignmentStatus,
  WorkFundingStatus,
  WorkJobStatus,
  WorkOrgStatus,
  WorkParty,
  WorkPayoutStatus,
} from '@prisma/client';
import {
  canTransitionWorkAssignment,
  quoteWorkJob,
  WorkErrorCode,
  workPlatformFee,
  type WorkFundingDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkAuditService } from './work-audit.service';
import { WorkAccount, WorkLedgerService } from './work-ledger.service';
import {
  SandboxWorkPaymentProvider,
  WORK_PAYMENT_PROVIDER,
  type WorkPaymentProvider,
  type WorkProviderEvent,
} from './payments/work-payment-provider';
import { JOB_FUNDERS, WorkAccessService } from './work-access.service';
import {
  workError,
  workInvalidState,
  workNotFound,
  workValidation,
} from './work-errors';
import {
  lockAssignment,
  lockFunding,
  lockJob,
  lockPayout,
  snapshotFeeBps,
} from './work-internal';

export interface MakePayableInput {
  assignmentId: string;
  amountPaise: number;
  reason:
    | 'APPROVED'
    | 'AUTO_APPROVED'
    | 'CANCELLATION_COMPENSATION'
    | 'DISPUTE_AWARD';
  actorUserId: string | null;
  actorParty: WorkParty;
  note?: string | null;
}

/**
 * Money side of the marketplace. Rules it enforces:
 *  - A job opens only after the provider's signed webhook confirms funding for every slot.
 *  - Approved work becomes a ledger obligation (WORK_APPROVED) in the same transaction as the
 *    assignment becoming PAYABLE; a payout row is created alongside it.
 *  - A payout is only ever marked SUCCEEDED by a signed provider webhook, never by our own call.
 *  - A failed payout leaves the obligation in place; a retry is a new attempt with a new
 *    idempotency key, and a partial unique index forbids two live attempts for one assignment.
 */
@Injectable()
export class WorkPaymentsService {
  private readonly logger = new Logger(WorkPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WorkLedgerService,
    private readonly audit: WorkAuditService,
    private readonly notifications: NotificationsService,
    private readonly access: WorkAccessService,
    @Inject(WORK_PAYMENT_PROVIDER)
    private readonly provider: WorkPaymentProvider,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  get isSandbox(): boolean {
    return this.provider.sandbox;
  }

  toFundingDto(f: {
    id: string;
    status: WorkFundingStatus;
    amountPaise: number;
    provider: string;
    providerOrderId: string;
    createdAt: Date;
  }): WorkFundingDto {
    return {
      id: f.id,
      status: f.status,
      amountPaise: f.amountPaise,
      provider: f.provider,
      providerOrderId: f.providerOrderId,
      sandbox: f.provider === 'sandbox',
      createdAt: f.createdAt.toISOString(),
    };
  }

  /**
   * Creates (or returns the existing) funding order for a job awaiting funding. The amount is
   * computed here from the job as it is now, at the job version the employer approved.
   */
  async createFunding(
    userId: string,
    orgId: string,
    jobId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<WorkFundingDto> {
    const job = await this.prisma.workJob.findFirst({
      where: { id: jobId, orgId },
      include: { org: true },
    });
    if (!job) throw workNotFound('Job not found.');
    if (job.org.status !== WorkOrgStatus.VERIFIED)
      throw workInvalidState('Only verified businesses can fund jobs.');
    if (job.status !== WorkJobStatus.FUNDING_REQUIRED)
      throw workInvalidState('This job is not waiting for funding.');
    if (job.version !== expectedVersion) {
      throw workInvalidState(
        'The job changed since you reviewed it. Review the latest version and try again.',
        { currentVersion: job.version },
      );
    }
    const existing = await this.prisma.workFunding.findFirst({
      where: {
        jobId,
        jobVersion: job.version,
        status: {
          in: [WorkFundingStatus.CREATED, WorkFundingStatus.SUCCEEDED],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.toFundingDto(existing);

    const quote = quoteWorkJob(
      job.positions,
      job.payPerWorkerPaise,
      job.feeBps,
    );
    const fundingId = randomUUID();
    const providerKey = `work-fund:${fundingId}`;
    // Provider call outside any transaction: network latency never holds row locks.
    const { providerOrderId } = await this.provider.createFundingOrder({
      fundingId,
      amountPaise: quote.employerTotalPaise,
      idempotencyKey: providerKey,
    });
    const funding = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workFunding.create({
        data: {
          id: fundingId,
          jobId,
          jobVersion: job.version,
          amountPaise: quote.employerTotalPaise,
          provider: this.provider.name,
          providerOrderId,
          idempotencyKey: `${userId}:${idempotencyKey}`.slice(0, 120),
          createdById: userId,
        },
      });
      await this.audit.record(tx, {
        entityType: 'FUNDING',
        entityId: created.id,
        action: 'FUNDING_ORDER_CREATED',
        toStatus: WorkFundingStatus.CREATED,
        actorUserId: userId,
        actorParty: WorkParty.EMPLOYER,
        orgId,
        jobId,
        metadata: {
          amountPaise: created.amountPaise,
          provider: created.provider,
        },
      });
      return created;
    });
    return this.toFundingDto(funding);
  }

  /** Single entry point for provider webhooks (and the sandbox, which produces signed events). */
  async handleWebhook(
    headers: Record<string, string | undefined>,
    body: unknown,
  ): Promise<{ received: true; duplicate: boolean }> {
    let event: WorkProviderEvent;
    try {
      event = this.provider.verifyAndParseWebhook(headers, body);
    } catch (err) {
      await this.audit.record(this.prisma, {
        entityType: 'WEBHOOK',
        entityId: 'rejected',
        action: 'WEBHOOK_REJECTED',
        actorParty: WorkParty.SYSTEM,
        note: 'Signature, payload or timestamp invalid',
        metadata: { provider: this.provider.name },
      });
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "work_webhook_events" ("id", "provider", "providerEventId", "eventType", "payload", "processedAt")
        VALUES (gen_random_uuid()::text, ${this.provider.name}, ${event.eventId}, ${event.type}, ${JSON.stringify(event)}::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT ("provider", "providerEventId") DO NOTHING
        RETURNING "id"`;
      if (claimed.length === 0)
        return { received: true as const, duplicate: true };

      if (
        event.type === 'funding.succeeded' ||
        event.type === 'funding.failed'
      ) {
        await this.applyFundingEvent(tx, event);
      } else {
        await this.applyPayoutEvent(tx, event);
      }
      return { received: true as const, duplicate: false };
    });
  }

  private async applyFundingEvent(
    tx: Prisma.TransactionClient,
    event: WorkProviderEvent,
  ): Promise<void> {
    const funding = await tx.workFunding.findUnique({
      where: { providerOrderId: event.reference },
    });
    if (!funding) throw workNotFound('Unknown funding reference.');
    await lockFunding(tx, funding.id);
    await lockJob(tx, funding.jobId);
    const fresh = await tx.workFunding.findUniqueOrThrow({
      where: { id: funding.id },
    });
    if (fresh.status !== WorkFundingStatus.CREATED) return; // already settled by an earlier event
    const job = await tx.workJob.findUniqueOrThrow({
      where: { id: fresh.jobId },
    });

    if (event.type === 'funding.failed') {
      await tx.workFunding.update({
        where: { id: fresh.id },
        data: { status: WorkFundingStatus.FAILED },
      });
      await this.audit.record(tx, {
        entityType: 'FUNDING',
        entityId: fresh.id,
        action: 'FUNDING_FAILED',
        fromStatus: 'CREATED',
        toStatus: 'FAILED',
        actorParty: WorkParty.SYSTEM,
        orgId: job.orgId,
        jobId: job.id,
        note: event.failureReason ?? null,
      });
      return;
    }
    if (event.amountPaise !== fresh.amountPaise) {
      // Never open a job on a mismatched amount. Recorded for finance to reconcile by hand.
      await this.audit.record(tx, {
        entityType: 'FUNDING',
        entityId: fresh.id,
        action: 'FUNDING_AMOUNT_MISMATCH',
        actorParty: WorkParty.SYSTEM,
        orgId: job.orgId,
        jobId: job.id,
        metadata: { expected: fresh.amountPaise, received: event.amountPaise },
      });
      throw workValidation('Funding amount does not match the order.');
    }

    await tx.workFunding.update({
      where: { id: fresh.id },
      data: { status: WorkFundingStatus.SUCCEEDED, confirmedAt: new Date() },
    });
    await this.ledger.post(tx, {
      kind: 'FUNDING_RECEIVED',
      idempotencyKey: `fund:${fresh.id}`,
      jobId: job.id,
      memo: `Funding for job ${job.id}`,
      entries: [
        { account: WorkAccount.providerHeld, amountPaise: fresh.amountPaise },
        {
          account: WorkAccount.employerPrefund(job.orgId),
          amountPaise: -fresh.amountPaise,
        },
      ],
    });
    await this.audit.record(tx, {
      entityType: 'FUNDING',
      entityId: fresh.id,
      action: 'FUNDING_SUCCEEDED',
      fromStatus: 'CREATED',
      toStatus: 'SUCCEEDED',
      actorParty: WorkParty.SYSTEM,
      orgId: job.orgId,
      jobId: job.id,
      metadata: { amountPaise: fresh.amountPaise },
    });

    if (
      job.status === WorkJobStatus.FUNDING_REQUIRED &&
      job.version === fresh.jobVersion
    ) {
      await tx.workJob.update({
        where: { id: job.id },
        data: { status: WorkJobStatus.OPEN, publishedAt: new Date() },
      });
      await this.audit.record(tx, {
        entityType: 'JOB',
        entityId: job.id,
        action: 'JOB_OPENED',
        fromStatus: job.status,
        toStatus: 'OPEN',
        actorParty: WorkParty.SYSTEM,
        orgId: job.orgId,
        jobId: job.id,
      });
    } else {
      // Funding arrived for a job that was cancelled or edited meanwhile: nothing is lost — the
      // money is released back to the employer's balance in the same transaction.
      await this.releaseRemaining(
        tx,
        job.id,
        job.orgId,
        `late-funding:${fresh.id}`,
        'Funding arrived after the job changed',
      );
    }
  }

  private async applyPayoutEvent(
    tx: Prisma.TransactionClient,
    event: WorkProviderEvent,
  ): Promise<void> {
    const payout = await tx.workPayout.findUnique({
      where: { providerPayoutId: event.reference },
    });
    if (!payout) throw workNotFound('Unknown payout reference.');
    await lockPayout(tx, payout.id);
    await lockAssignment(tx, payout.assignmentId);
    const fresh = await tx.workPayout.findUniqueOrThrow({
      where: { id: payout.id },
    });
    if (fresh.status !== WorkPayoutStatus.PROCESSING) return;
    const assignment = await tx.workAssignment.findUniqueOrThrow({
      where: { id: fresh.assignmentId },
      include: { job: true },
    });

    if (event.type === 'payout.failed') {
      await tx.workPayout.update({
        where: { id: fresh.id },
        data: {
          status: WorkPayoutStatus.FAILED,
          failureReason: event.failureReason ?? 'Provider reported failure',
          settledAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        entityType: 'PAYOUT',
        entityId: fresh.id,
        action: 'PAYOUT_FAILED',
        fromStatus: 'PROCESSING',
        toStatus: 'FAILED',
        actorParty: WorkParty.SYSTEM,
        jobId: assignment.jobId,
        orgId: assignment.job.orgId,
        note: event.failureReason ?? null,
      });
      await this.notifications.notifyInTransaction(
        tx,
        fresh.workerId,
        'work.payout.failed',
        { assignmentId: assignment.id, amountPaise: fresh.amountPaise },
        `/work/me/assignments/${assignment.id}`,
      );
      return;
    }
    if (event.amountPaise !== fresh.amountPaise) {
      await this.audit.record(tx, {
        entityType: 'PAYOUT',
        entityId: fresh.id,
        action: 'PAYOUT_AMOUNT_MISMATCH',
        actorParty: WorkParty.SYSTEM,
        jobId: assignment.jobId,
        metadata: { expected: fresh.amountPaise, received: event.amountPaise },
      });
      throw workValidation('Payout amount does not match.');
    }
    await tx.workPayout.update({
      where: { id: fresh.id },
      data: { status: WorkPayoutStatus.SUCCEEDED, settledAt: new Date() },
    });
    await this.ledger.post(tx, {
      kind: 'PAYOUT_SETTLED',
      idempotencyKey: `payout:${fresh.id}`,
      jobId: assignment.jobId,
      assignmentId: assignment.id,
      entries: [
        {
          account: WorkAccount.workerPayable(fresh.workerId),
          amountPaise: fresh.amountPaise,
        },
        { account: WorkAccount.providerHeld, amountPaise: -fresh.amountPaise },
      ],
    });
    await this.audit.record(tx, {
      entityType: 'PAYOUT',
      entityId: fresh.id,
      action: 'PAYOUT_SUCCEEDED',
      fromStatus: 'PROCESSING',
      toStatus: 'SUCCEEDED',
      actorParty: WorkParty.SYSTEM,
      jobId: assignment.jobId,
      orgId: assignment.job.orgId,
    });

    // The assignment is PAID only when everything owed on it has been paid out.
    const owed = assignment.approvedAmountPaise ?? 0;
    const paid = await tx.workPayout.aggregate({
      where: {
        assignmentId: assignment.id,
        status: WorkPayoutStatus.SUCCEEDED,
      },
      _sum: { amountPaise: true },
    });
    if (
      assignment.status === WorkAssignmentStatus.PAYABLE &&
      (paid._sum.amountPaise ?? 0) >= owed
    ) {
      await tx.workAssignment.update({
        where: { id: assignment.id },
        data: { status: WorkAssignmentStatus.PAID },
      });
      await this.audit.record(tx, {
        entityType: 'ASSIGNMENT',
        entityId: assignment.id,
        action: 'ASSIGNMENT_PAID',
        fromStatus: 'PAYABLE',
        toStatus: 'PAID',
        actorParty: WorkParty.SYSTEM,
        jobId: assignment.jobId,
        orgId: assignment.job.orgId,
      });
    }
    await this.notifications.notifyInTransaction(
      tx,
      fresh.workerId,
      'work.payout.sent',
      { assignmentId: assignment.id, amountPaise: fresh.amountPaise },
      `/work/me/assignments/${assignment.id}`,
    );
  }

  /**
   * Turns reviewed (or compensated) work into a payment obligation, on the caller's transaction.
   * The caller must already hold the assignment row lock and must have checked the transition.
   * The fee uses the fee rate frozen into the assignment's terms, never today's setting.
   */
  async makePayable(
    tx: Prisma.TransactionClient,
    input: MakePayableInput,
  ): Promise<{ payoutId: string | null }> {
    const a = await tx.workAssignment.findUniqueOrThrow({
      where: { id: input.assignmentId },
      include: { job: true },
    });
    if (!canTransitionWorkAssignment(a.status, WorkAssignmentStatus.PAYABLE)) {
      throw workInvalidState(
        'This assignment cannot become payable from its current state.',
        { status: a.status },
      );
    }
    if (
      !Number.isInteger(input.amountPaise) ||
      input.amountPaise < 0 ||
      input.amountPaise > a.agreedPayPaise
    ) {
      throw workValidation(
        'The amount must be between zero and the agreed pay.',
      );
    }
    const fee = workPlatformFee(input.amountPaise, snapshotFeeBps(a));
    const from = a.status;
    await tx.workAssignment.update({
      where: { id: a.id },
      data: {
        status: WorkAssignmentStatus.PAYABLE,
        approvedAmountPaise: input.amountPaise,
        reviewedAt: a.reviewedAt ?? new Date(),
      },
    });
    await this.audit.record(tx, {
      entityType: 'ASSIGNMENT',
      entityId: a.id,
      action:
        input.reason === 'CANCELLATION_COMPENSATION'
          ? 'COMPENSATION_PAYABLE'
          : input.reason === 'DISPUTE_AWARD'
            ? 'DISPUTE_AWARD_PAYABLE'
            : input.reason === 'AUTO_APPROVED'
              ? 'AUTO_APPROVED'
              : 'APPROVED',
      fromStatus: from,
      toStatus: 'PAYABLE',
      actorUserId: input.actorUserId,
      actorParty: input.actorParty,
      jobId: a.jobId,
      orgId: a.job.orgId,
      note: input.note ?? null,
      metadata: { amountPaise: input.amountPaise, feePaise: fee },
    });
    if (input.amountPaise === 0) return { payoutId: null };

    await this.ledger.post(tx, {
      kind: 'WORK_APPROVED',
      idempotencyKey: `payable:${a.id}`,
      jobId: a.jobId,
      assignmentId: a.id,
      memo: input.reason,
      entries: [
        {
          account: WorkAccount.employerPrefund(a.job.orgId),
          amountPaise: input.amountPaise + fee,
        },
        {
          account: WorkAccount.workerPayable(a.workerId),
          amountPaise: -input.amountPaise,
        },
        { account: WorkAccount.platformFees, amountPaise: -fee },
      ],
    });
    const payout = await tx.workPayout.create({
      data: {
        assignmentId: a.id,
        workerId: a.workerId,
        amountPaise: input.amountPaise,
        attempt: 1,
        provider: this.provider.name,
        idempotencyKey: `work-payout:${a.id}:1`,
      },
    });
    await this.audit.record(tx, {
      entityType: 'PAYOUT',
      entityId: payout.id,
      action: 'PAYOUT_CREATED',
      toStatus: 'PENDING',
      actorParty: WorkParty.SYSTEM,
      jobId: a.jobId,
      orgId: a.job.orgId,
      metadata: { amountPaise: input.amountPaise },
    });
    return { payoutId: payout.id };
  }

  /**
   * Sends a PENDING payout to the provider. Safe to call repeatedly: only a PENDING row with a
   * payout method moves on, and the provider receives the row's fixed idempotency key.
   */
  async initiatePayout(payoutId: string): Promise<void> {
    const payout = await this.prisma.workPayout.findUnique({
      where: { id: payoutId },
    });
    if (!payout || payout.status !== WorkPayoutStatus.PENDING) return;
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId: payout.workerId },
      select: { payoutUpiVpa: true },
    });
    if (!profile?.payoutUpiVpa) return; // waits until the worker adds a UPI ID; the obligation stays
    let providerPayoutId: string;
    try {
      ({ providerPayoutId } = await this.provider.createPayout({
        payoutId: payout.id,
        amountPaise: payout.amountPaise,
        upiVpa: profile.payoutUpiVpa,
        idempotencyKey: payout.idempotencyKey,
      }));
    } catch (err) {
      this.logger.warn(
        `Payout ${payout.id} not initiated: ${(err as Error).message}`,
      );
      return; // stays PENDING — nothing claims money moved
    }
    await this.prisma.$transaction(async (tx) => {
      await lockPayout(tx, payout.id);
      const updated = await tx.workPayout.updateMany({
        where: { id: payout.id, status: WorkPayoutStatus.PENDING },
        data: {
          status: WorkPayoutStatus.PROCESSING,
          providerPayoutId,
          initiatedAt: new Date(),
        },
      });
      if (updated.count) {
        await this.audit.record(tx, {
          entityType: 'PAYOUT',
          entityId: payout.id,
          action: 'PAYOUT_INITIATED',
          fromStatus: 'PENDING',
          toStatus: 'PROCESSING',
          actorParty: WorkParty.SYSTEM,
          metadata: { provider: this.provider.name },
        });
      }
    });
  }

  async initiatePendingPayoutsFor(workerId?: string): Promise<number> {
    const pending = await this.prisma.workPayout.findMany({
      where: {
        status: WorkPayoutStatus.PENDING,
        ...(workerId ? { workerId } : {}),
      },
      select: { id: true },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });
    for (const p of pending) await this.initiatePayout(p.id);
    return pending.length;
  }

  /** A new attempt after a FAILED one. The obligation itself is untouched. */
  async retryPayout(
    adminUserId: string,
    payoutId: string,
  ): Promise<{ payoutId: string }> {
    const created = await this.prisma.$transaction(async (tx) => {
      await lockPayout(tx, payoutId);
      const failed = await tx.workPayout.findUnique({
        where: { id: payoutId },
      });
      if (!failed) throw workNotFound('Payout not found.');
      if (failed.status !== WorkPayoutStatus.FAILED)
        throw workInvalidState('Only a failed payout can be retried.');
      await lockAssignment(tx, failed.assignmentId);
      const live = await tx.workPayout.findFirst({
        where: {
          assignmentId: failed.assignmentId,
          status: {
            in: [
              WorkPayoutStatus.PENDING,
              WorkPayoutStatus.PROCESSING,
              WorkPayoutStatus.SUCCEEDED,
            ],
          },
        },
      });
      if (live)
        throw workInvalidState(
          'This assignment already has a payout in progress or paid.',
        );
      const last = await tx.workPayout.aggregate({
        where: { assignmentId: failed.assignmentId },
        _max: { attempt: true },
      });
      const attempt = (last._max.attempt ?? 1) + 1;
      const next = await tx.workPayout.create({
        data: {
          assignmentId: failed.assignmentId,
          workerId: failed.workerId,
          amountPaise: failed.amountPaise,
          attempt,
          provider: this.provider.name,
          idempotencyKey: `work-payout:${failed.assignmentId}:${attempt}`,
        },
      });
      const owner = await tx.workAssignment.findUniqueOrThrow({
        where: { id: failed.assignmentId },
        select: { jobId: true, job: { select: { orgId: true } } },
      });
      await this.audit.record(tx, {
        entityType: 'PAYOUT',
        entityId: next.id,
        action: 'PAYOUT_RETRY_CREATED',
        toStatus: 'PENDING',
        actorUserId: adminUserId,
        actorParty: WorkParty.PLATFORM,
        jobId: owner.jobId,
        orgId: owner.job.orgId,
        metadata: { previousPayoutId: failed.id, attempt },
      });
      return next;
    });
    await this.initiatePayout(created.id);
    return { payoutId: created.id };
  }

  /** Returns a job's unused prefund to the employer balance. No-op when nothing is left. */
  async releaseRemaining(
    tx: Prisma.TransactionClient,
    jobId: string,
    orgId: string,
    key: string,
    memo: string,
  ): Promise<number> {
    const remaining = await this.ledger.jobPrefundRemaining(tx, orgId, jobId);
    if (remaining <= 0) return 0;
    await this.ledger.post(tx, {
      kind: 'FUNDS_RELEASED',
      idempotencyKey: `release:${jobId}:${key}`,
      jobId,
      memo,
      entries: [
        { account: WorkAccount.employerPrefund(orgId), amountPaise: remaining },
        { account: WorkAccount.providerHeld, amountPaise: -remaining },
      ],
    });
    await this.audit.record(tx, {
      entityType: 'JOB',
      entityId: jobId,
      action: 'FUNDS_RELEASED',
      actorParty: WorkParty.SYSTEM,
      orgId,
      jobId,
      note: memo,
      metadata: { amountPaise: remaining },
    });
    return remaining;
  }

  // ------------------------------------------------------------------ sandbox (never production)

  private sandbox(): SandboxWorkPaymentProvider {
    if (!(this.provider instanceof SandboxWorkPaymentProvider)) {
      throw workError(
        WorkErrorCode.SANDBOX_DISABLED,
        'The payment sandbox is not enabled.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.provider;
  }

  /** Simulates the employer completing payment at the sandbox "bank" — via a signed webhook. */
  async sandboxCompleteFunding(
    userId: string,
    fundingId: string,
    outcome: 'SUCCEEDED' | 'FAILED',
  ) {
    const sandbox = this.sandbox();
    const funding = await this.prisma.workFunding.findUnique({
      where: { id: fundingId },
      include: { job: true },
    });
    if (!funding) throw workNotFound('Funding not found.');
    await this.access.requireOrgRole(userId, funding.job.orgId, JOB_FUNDERS);
    const { event, headers } = sandbox.buildEvent(
      outcome === 'SUCCEEDED' ? 'funding.succeeded' : 'funding.failed',
      funding.providerOrderId,
      funding.amountPaise,
      outcome === 'FAILED' ? 'Sandbox: payment declined' : undefined,
    );
    return this.handleWebhook(headers, event);
  }

  /** Simulates the sandbox "bank" settling a payout — via a signed webhook. Platform admins only. */
  async sandboxSettlePayout(
    payoutId: string,
    outcome: 'SUCCEEDED' | 'FAILED',
    failureReason?: string,
  ) {
    const sandbox = this.sandbox();
    const payout = await this.prisma.workPayout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw workNotFound('Payout not found.');
    if (!payout.providerPayoutId)
      throw workInvalidState(
        'This payout has not been sent to the provider yet (the worker may have no UPI ID).',
      );
    const { event, headers } = sandbox.buildEvent(
      outcome === 'SUCCEEDED' ? 'payout.succeeded' : 'payout.failed',
      payout.providerPayoutId,
      payout.amountPaise,
      outcome === 'FAILED'
        ? (failureReason ?? 'Sandbox: beneficiary bank unavailable')
        : undefined,
    );
    return this.handleWebhook(headers, event);
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FINANCE_FUNDING_CLASSIFICATION_LABEL,
  FINANCE_PERSONAL_TREATMENT_LABEL,
  FINANCE_RECOGNISED_STATUSES,
  FINANCE_REPAYABLE_CLASSIFICATIONS,
  FinanceErrorCode,
  reimbursementStatusAfterPayouts,
  type FinanceClaimablePaymentDto,
  type FinanceContributorLedgerDto,
  type FinanceFundingDto,
  type FinanceFundingInput,
  type FinanceLedgerEntryDto,
  type FinancePayoutInput,
  type FinanceReimbursementCreateInput,
  type FinanceReimbursementDto,
  type FinanceReimbursementReviewInput,
  type FinanceReimbursementStatus,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { recordFinanceAudit } from './finance-audit';
import {
  dateOnly,
  forbidden,
  invalid,
  invalidState,
  isUniqueViolation,
  isoDay,
  money,
  notFound,
  type FinanceActor,
} from './finance-access';
import { FinanceSetupService, toContributorDto } from './finance-setup.service';

const ZERO = new Prisma.Decimal(0);
/** Expenses whose personal payments still count (not thrown away). */
const LIVE_EXPENSE: Prisma.FinanceExpenseWhereInput = {
  status: { notIn: ['REJECTED', 'CANCELLED'] },
};

const reimbursementInclude = {
  contributor: { select: { id: true, name: true, userId: true } },
  expensePayment: {
    select: {
      id: true,
      amount: true,
      expense: {
        select: { id: true, number: true, description: true, status: true },
      },
    },
  },
  payouts: {
    orderBy: { createdAt: 'asc' },
    include: { account: { select: { id: true, name: true } } },
  },
} satisfies Prisma.FinanceReimbursementInclude;
type ReimbursementRow = Prisma.FinanceReimbursementGetPayload<{
  include: typeof reimbursementInclude;
}>;

const paidOut = (r: {
  payouts: Array<{ amount: Prisma.Decimal; voidedAt: Date | null }>;
}) =>
  r.payouts.filter((p) => !p.voidedAt).reduce((t, p) => t.plus(p.amount), ZERO);

/**
 * What the company owes for each reimbursable personal payment: the approved amount minus payouts
 * when a claim is approved; the full amount while unclaimed or under review; nothing once rejected.
 */
export function reimbursableOwed(payment: {
  amount: Prisma.Decimal;
  reimbursements: Array<{
    status: FinanceReimbursementStatus;
    amountRequested: Prisma.Decimal;
    amountApproved: Prisma.Decimal | null;
    payouts: Array<{ amount: Prisma.Decimal; voidedAt: Date | null }>;
  }>;
}): {
  owed: Prisma.Decimal;
  awaitingReview: Prisma.Decimal;
  reimbursed: Prisma.Decimal;
} {
  const open = payment.reimbursements.find(
    (r) => !['REJECTED', 'CANCELLED'].includes(r.status),
  );
  const reimbursed = payment.reimbursements.reduce(
    (t, r) => t.plus(paidOut(r)),
    ZERO,
  );
  if (!open) {
    const rejected = payment.reimbursements.some(
      (r) => r.status === 'REJECTED',
    );
    return {
      owed: rejected
        ? ZERO
        : Prisma.Decimal.max(payment.amount.minus(reimbursed), 0),
      awaitingReview: ZERO,
      reimbursed,
    };
  }
  if (open.status === 'SUBMITTED' || open.status === 'UNDER_REVIEW')
    return { owed: ZERO, awaitingReview: open.amountRequested, reimbursed };
  return {
    owed: Prisma.Decimal.max(
      (open.amountApproved ?? ZERO).minus(paidOut(open)),
      0,
    ),
    awaitingReview: ZERO,
    reimbursed,
  };
}

@Injectable()
export class FinanceFundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinanceSetupService,
  ) {}

  // ------------------------------------------------------------ funding

  async listFunding(
    actor: FinanceActor,
    contributorId?: string,
  ): Promise<FinanceFundingDto[]> {
    if (!actor.viewCompany) throw forbidden();
    const rows = await this.prisma.financeFunding.findMany({
      where: contributorId ? { contributorId } : {},
      include: {
        contributor: { select: { id: true, name: true, type: true } },
        account: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((f) => ({
      id: f.id,
      number: f.number,
      contributor: f.contributor,
      kind: f.kind,
      classification: f.classification,
      date: isoDay(f.date),
      amount: money(f.amount),
      account: f.account,
      method: f.method,
      sourceAccount: f.sourceAccount,
      reference: f.reference,
      purpose: f.purpose,
      remarks: f.remarks,
      voided: !!f.voidedAt,
      voidReason: f.voidReason,
      createdAt: f.createdAt.toISOString(),
    }));
  }

  async createFunding(
    actor: FinanceActor,
    input: FinanceFundingInput,
  ): Promise<{ id: string }> {
    if (!actor.manage) throw forbidden();
    if (input.clientRequestId) {
      const replay = await this.prisma.financeFunding.findUnique({
        where: { clientRequestId: input.clientRequestId },
      });
      if (replay) return { id: replay.id };
    }
    const contributor = await this.prisma.financeContributor.findUnique({
      where: { id: input.contributorId },
    });
    if (!contributor) throw notFound('That contributor');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.setup.assertActiveAccount(tx, input.accountId);
        const row = await tx.financeFunding.create({
          data: {
            contributorId: input.contributorId,
            kind: input.kind,
            classification: input.classification,
            date: dateOnly(input.date),
            amount: new Prisma.Decimal(input.amount),
            accountId: input.accountId,
            method: input.method,
            sourceAccount: input.sourceAccount ?? null,
            reference: input.reference ?? null,
            purpose: input.purpose ?? null,
            remarks: input.remarks ?? null,
            createdByUserId: actor.userId,
            clientRequestId: input.clientRequestId ?? null,
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'FUNDING',
          entityId: row.id,
          action: input.kind === 'CONTRIBUTION' ? 'RECEIVED' : 'REPAID',
          actorUserId: actor.userId,
          after: {
            contributorId: row.contributorId,
            kind: row.kind,
            classification: row.classification,
            date: input.date,
            amount: row.amount,
            accountId: row.accountId,
            method: row.method,
            reference: row.reference,
          },
        });
        return { id: row.id };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'clientRequestId')) {
        const row = await this.prisma.financeFunding.findUnique({
          where: { clientRequestId: input.clientRequestId },
        });
        if (row) return { id: row.id };
      }
      throw error;
    }
  }

  async voidFunding(
    actor: FinanceActor,
    id: string,
    reason: string,
  ): Promise<{ id: string }> {
    if (!actor.manage) throw forbidden();
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.financeFunding.updateMany({
        where: { id, voidedAt: null },
        data: {
          voidedAt: new Date(),
          voidReason: reason,
          voidedByUserId: actor.userId,
        },
      });
      if (count !== 1) throw notFound('That active funding record');
      await recordFinanceAudit(tx, {
        entityType: 'FUNDING',
        entityId: id,
        action: 'VOIDED',
        actorUserId: actor.userId,
        before: { voided: false },
        after: { voided: true },
        note: reason,
      });
      return { id };
    });
  }

  // ------------------------------------------------------------ reimbursements

  private async ownContributorId(userId: string) {
    return (
      (
        await this.prisma.financeContributor.findUnique({
          where: { userId },
          select: { id: true },
        })
      )?.id ?? null
    );
  }

  private toDto(
    actor: FinanceActor,
    r: ReimbursementRow,
    names: Map<string, string>,
  ): FinanceReimbursementDto {
    const reimbursed = paidOut(r);
    const own = r.contributor.userId === actor.userId;
    return {
      id: r.id,
      number: r.number,
      requestedBy: { id: r.contributor.id, name: r.contributor.name },
      expense: {
        id: r.expensePayment.expense.id,
        number: r.expensePayment.expense.number,
        description: r.expensePayment.expense.description,
      },
      expensePaymentId: r.expensePayment.id,
      paymentAmount: money(r.expensePayment.amount),
      amountRequested: money(r.amountRequested),
      amountApproved: r.amountApproved ? money(r.amountApproved) : null,
      amountReimbursed: money(reimbursed),
      remaining: money(
        r.amountApproved
          ? Prisma.Decimal.max(r.amountApproved.minus(reimbursed), 0)
          : ZERO,
      ),
      status: r.status,
      reviewNote: r.reviewNote,
      approvedBy: r.reviewedByUserId
        ? (names.get(r.reviewedByUserId) ?? 'FastQue user')
        : null,
      approvedAt: r.reviewedAt?.toISOString() ?? null,
      submittedAt: r.createdAt.toISOString(),
      payouts: r.payouts.map((p) => ({
        id: p.id,
        amount: money(p.amount),
        paidOn: isoDay(p.paidOn),
        account: p.account,
        method: p.method,
        reference: p.reference,
        voided: !!p.voidedAt,
      })),
      can: {
        review:
          actor.approve &&
          ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status) &&
          (!own || actor.isPlatformAdmin),
        pay:
          actor.manage &&
          ['APPROVED', 'PARTIALLY_REIMBURSED'].includes(r.status),
        cancel:
          ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(r.status) &&
          reimbursed.isZero() &&
          (actor.manage || own),
      },
    };
  }

  private async reviewerNames(rows: ReimbursementRow[]) {
    const ids = [
      ...new Set(
        rows.map((r) => r.reviewedByUserId).filter((v): v is string => !!v),
      ),
    ];
    if (!ids.length) return new Map<string, string>();
    const contributors = await this.prisma.financeContributor.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, name: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    });
    const byUser = new Map(contributors.map((c) => [c.userId!, c.name]));
    return new Map(
      users.map((u) => [u.id, byUser.get(u.id) ?? u.email ?? 'FastQue user']),
    );
  }

  async listReimbursements(
    actor: FinanceActor,
    status?: FinanceReimbursementStatus,
  ): Promise<FinanceReimbursementDto[]> {
    const own = actor.viewCompany
      ? null
      : await this.ownContributorId(actor.userId);
    if (!actor.viewCompany && !own) return [];
    const rows = await this.prisma.financeReimbursement.findMany({
      where: {
        ...(own ? { contributorId: own } : {}),
        ...(status ? { status } : {}),
      },
      include: reimbursementInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const names = await this.reviewerNames(rows);
    return rows.map((r) => this.toDto(actor, r, names));
  }

  /** Reimbursable personal payments without an open claim: the caller's own, or anyone's for finance managers. */
  async claimablePayments(
    actor: FinanceActor,
  ): Promise<FinanceClaimablePaymentDto[]> {
    const own = actor.manage ? null : await this.ownContributorId(actor.userId);
    if (!actor.manage && !own) return [];
    const rows = await this.prisma.financeExpensePayment.findMany({
      where: {
        voidedAt: null,
        payerType: 'PERSON',
        personalTreatment: 'REIMBURSABLE',
        expense: LIVE_EXPENSE,
        reimbursements: {
          none: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
        },
        ...(own ? { contributorId: own } : {}),
      },
      include: {
        contributor: { select: { id: true, name: true } },
        expense: {
          select: { id: true, number: true, description: true, status: true },
        },
      },
      orderBy: { paidOn: 'desc' },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      amount: money(p.amount),
      paidOn: isoDay(p.paidOn),
      contributor: p.contributor!,
      expense: p.expense,
    }));
  }

  async createReimbursement(
    actor: FinanceActor,
    input: FinanceReimbursementCreateInput,
  ): Promise<{ id: string }> {
    if (input.clientRequestId) {
      const replay = await this.prisma.financeReimbursement.findUnique({
        where: { clientRequestId: input.clientRequestId },
      });
      if (replay) return { id: replay.id };
    }
    const payment = await this.prisma.financeExpensePayment.findUnique({
      where: { id: input.expensePaymentId },
      include: {
        contributor: true,
        expense: { select: { status: true, number: true } },
      },
    });
    if (!payment || payment.voidedAt) throw notFound('That payment');
    if (
      payment.payerType !== 'PERSON' ||
      payment.personalTreatment !== 'REIMBURSABLE'
    )
      throw invalid(
        'Only a personal payment marked "to be reimbursed" can be claimed.',
      );
    if (['REJECTED', 'CANCELLED'].includes(payment.expense.status))
      throw invalidState('That expense was rejected or cancelled.');
    if (!actor.manage && payment.contributor?.userId !== actor.userId)
      throw forbidden('You can only claim what you paid yourself.');
    if (new Prisma.Decimal(input.amountRequested).greaterThan(payment.amount))
      throw invalid(
        `You can claim at most ${money(payment.amount)} for this payment.`,
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.financeReimbursement.create({
          data: {
            expensePaymentId: payment.id,
            contributorId: payment.contributorId!,
            amountRequested: new Prisma.Decimal(input.amountRequested),
            note: input.note ?? null,
            createdByUserId: actor.userId,
            clientRequestId: input.clientRequestId ?? null,
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'REIMBURSEMENT',
          entityId: row.id,
          action: 'SUBMITTED',
          actorUserId: actor.userId,
          after: {
            expensePaymentId: payment.id,
            amountRequested: row.amountRequested,
          },
          note: input.note ?? null,
        });
        return { id: row.id };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'clientRequestId')) {
        const row = await this.prisma.financeReimbursement.findUnique({
          where: { clientRequestId: input.clientRequestId },
        });
        if (row) return { id: row.id };
      }
      // The partial unique index allows only one open claim per payment.
      if (isUniqueViolation(error))
        throw new AppException(
          FinanceErrorCode.DUPLICATE_CLAIM,
          `A reimbursement claim for this payment on ${payment.expense.number} already exists.`,
          HttpStatus.CONFLICT,
        );
      throw error;
    }
  }

  private async loadClaim(
    actor: FinanceActor,
    id: string,
  ): Promise<ReimbursementRow> {
    const r = await this.prisma.financeReimbursement.findUnique({
      where: { id },
      include: reimbursementInclude,
    });
    if (!r) throw notFound('That reimbursement');
    if (!actor.viewCompany && r.contributor.userId !== actor.userId)
      throw notFound('That reimbursement');
    return r;
  }

  async reviewReimbursement(
    actor: FinanceActor,
    id: string,
    input: FinanceReimbursementReviewInput,
  ): Promise<{ id: string }> {
    const r = await this.loadClaim(actor, id);
    if (!actor.approve) throw forbidden();
    if (r.contributor.userId === actor.userId && !actor.isPlatformAdmin)
      throw new AppException(
        FinanceErrorCode.SELF_APPROVAL,
        'Someone else has to review your own claim.',
        HttpStatus.FORBIDDEN,
      );
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(r.status))
      throw invalidState('Only a submitted claim can be reviewed.');
    if (input.action === 'REJECT' && !input.note)
      throw invalid('Give a reason for rejecting.');
    let next: FinanceReimbursementStatus =
      input.action === 'START_REVIEW'
        ? 'UNDER_REVIEW'
        : input.action === 'REJECT'
          ? 'REJECTED'
          : 'APPROVED';
    let approved: Prisma.Decimal | null = null;
    if (input.action === 'APPROVE') {
      if (
        !FINANCE_RECOGNISED_STATUSES.includes(r.expensePayment.expense.status)
      )
        throw invalidState(
          `Approve expense ${r.expensePayment.expense.number} before approving its reimbursement.`,
        );
      approved = new Prisma.Decimal(
        input.amountApproved ?? money(r.amountRequested),
      );
      if (approved.greaterThan(r.amountRequested))
        throw invalid(
          'The approved amount cannot exceed the amount requested.',
        );
      next = reimbursementStatusAfterPayouts(
        'APPROVED',
        money(approved),
        money(paidOut(r)),
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.financeReimbursement.updateMany({
        where: { id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
        data: {
          status: next,
          ...(input.action === 'START_REVIEW'
            ? {}
            : {
                reviewedByUserId: actor.userId,
                reviewedAt: new Date(),
                reviewNote: input.note ?? null,
              }),
          ...(approved ? { amountApproved: approved } : {}),
        },
      });
      if (count !== 1)
        throw invalidState(
          'This claim was changed by someone else. Reload and try again.',
        );
      await recordFinanceAudit(tx, {
        entityType: 'REIMBURSEMENT',
        entityId: id,
        action:
          input.action === 'START_REVIEW'
            ? 'REVIEW_STARTED'
            : input.action === 'APPROVE'
              ? 'APPROVED'
              : 'REJECTED',
        actorUserId: actor.userId,
        before: { status: r.status, amountApproved: r.amountApproved },
        after: { status: next, amountApproved: approved ?? r.amountApproved },
        note: input.note ?? null,
      });
      return { id };
    });
  }

  async cancelReimbursement(
    actor: FinanceActor,
    id: string,
    reason: string,
  ): Promise<{ id: string }> {
    const r = await this.loadClaim(actor, id);
    const names = new Map<string, string>();
    if (!this.toDto(actor, r, names).can.cancel)
      throw invalidState('This claim cannot be cancelled.');
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.financeReimbursement.updateMany({
        where: { id, status: r.status },
        data: { status: 'CANCELLED' },
      });
      if (count !== 1)
        throw invalidState(
          'This claim was changed by someone else. Reload and try again.',
        );
      await recordFinanceAudit(tx, {
        entityType: 'REIMBURSEMENT',
        entityId: id,
        action: 'CANCELLED',
        actorUserId: actor.userId,
        before: { status: r.status },
        after: { status: 'CANCELLED' },
        note: reason,
      });
      return { id };
    });
  }

  /** Company money paid back to the person — settles the claim; it is not another expense. */
  async addPayout(
    actor: FinanceActor,
    id: string,
    input: FinancePayoutInput,
  ): Promise<{ id: string }> {
    if (!actor.manage) throw forbidden();
    if (input.clientRequestId) {
      const replay = await this.prisma.financeReimbursementPayout.findUnique({
        where: { clientRequestId: input.clientRequestId },
      });
      if (replay) return { id: replay.id };
    }
    await this.loadClaim(actor, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "finance_reimbursements" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const r = await tx.financeReimbursement.findUniqueOrThrow({
        where: { id },
        include: {
          payouts: {
            where: { voidedAt: null },
            select: { amount: true, voidedAt: true },
          },
        },
      });
      if (
        !['APPROVED', 'PARTIALLY_REIMBURSED'].includes(r.status) ||
        !r.amountApproved
      )
        throw invalidState('Only an approved claim can be paid out.');
      const already = paidOut(r);
      const remaining = r.amountApproved.minus(already);
      const amount = new Prisma.Decimal(input.amount);
      if (amount.greaterThan(remaining))
        throw new AppException(
          FinanceErrorCode.OVERPAYMENT,
          `Only ${money(remaining)} is left to reimburse.`,
          HttpStatus.CONFLICT,
        );
      await this.setup.assertActiveAccount(tx, input.accountId);
      const payout = await tx.financeReimbursementPayout.create({
        data: {
          reimbursementId: id,
          amount,
          paidOn: dateOnly(input.paidOn),
          accountId: input.accountId,
          method: input.method,
          reference: input.reference ?? null,
          createdByUserId: actor.userId,
          clientRequestId: input.clientRequestId ?? null,
        },
      });
      const next = reimbursementStatusAfterPayouts(
        r.status,
        money(r.amountApproved),
        money(already.plus(amount)),
      );
      if (next !== r.status)
        await tx.financeReimbursement.update({
          where: { id },
          data: { status: next },
        });
      await recordFinanceAudit(tx, {
        entityType: 'PAYOUT',
        entityId: payout.id,
        action: 'PAID',
        actorUserId: actor.userId,
        after: {
          reimbursementId: id,
          amount,
          paidOn: input.paidOn,
          accountId: input.accountId,
          method: input.method,
          reference: payout.reference,
        },
      });
      if (next !== r.status)
        await recordFinanceAudit(tx, {
          entityType: 'REIMBURSEMENT',
          entityId: id,
          action: 'STATUS_CHANGED',
          actorUserId: actor.userId,
          before: { status: r.status },
          after: { status: next },
        });
      return { id: payout.id };
    });
  }

  async voidPayout(
    actor: FinanceActor,
    payoutId: string,
    reason: string,
  ): Promise<{ id: string }> {
    if (!actor.manage) throw forbidden();
    const payout = await this.prisma.financeReimbursementPayout.findUnique({
      where: { id: payoutId },
    });
    if (!payout || payout.voidedAt) throw notFound('That active payout');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "finance_reimbursements" WHERE "id" = ${payout.reimbursementId}::uuid FOR UPDATE`;
      await tx.financeReimbursementPayout.update({
        where: { id: payoutId },
        data: {
          voidedAt: new Date(),
          voidReason: reason,
          voidedByUserId: actor.userId,
        },
      });
      const r = await tx.financeReimbursement.findUniqueOrThrow({
        where: { id: payout.reimbursementId },
        include: {
          payouts: {
            where: { voidedAt: null },
            select: { amount: true, voidedAt: true },
          },
        },
      });
      const next = reimbursementStatusAfterPayouts(
        r.status,
        r.amountApproved ? money(r.amountApproved) : null,
        money(paidOut(r)),
      );
      if (next !== r.status)
        await tx.financeReimbursement.update({
          where: { id: r.id },
          data: { status: next },
        });
      await recordFinanceAudit(tx, {
        entityType: 'PAYOUT',
        entityId: payoutId,
        action: 'VOIDED',
        actorUserId: actor.userId,
        before: { voided: false },
        after: { voided: true },
        note: reason,
      });
      return { id: payoutId };
    });
  }

  // ------------------------------------------------------------ contributor ledger

  async ledger(
    actor: FinanceActor,
    contributorId: string,
  ): Promise<FinanceContributorLedgerDto> {
    const contributor = await this.prisma.financeContributor.findUnique({
      where: { id: contributorId },
      include: { user: { select: { email: true } } },
    });
    if (!contributor) throw notFound('That contributor');
    if (!actor.viewCompany && contributor.userId !== actor.userId)
      throw notFound('That contributor');

    const [funding, payments] = await Promise.all([
      this.prisma.financeFunding.findMany({
        where: { contributorId, voidedAt: null },
        orderBy: { date: 'asc' },
      }),
      this.prisma.financeExpensePayment.findMany({
        where: {
          contributorId,
          voidedAt: null,
          payerType: 'PERSON',
          expense: LIVE_EXPENSE,
        },
        include: {
          expense: { select: { number: true, description: true } },
          reimbursements: {
            select: {
              status: true,
              amountRequested: true,
              amountApproved: true,
              number: true,
              payouts: {
                select: {
                  amount: true,
                  voidedAt: true,
                  paidOn: true,
                  reference: true,
                },
              },
            },
          },
        },
        orderBy: { paidOn: 'asc' },
      }),
    ]);

    let fundedIn = ZERO;
    let repaid = ZERO;
    let loansIn = ZERO;
    const byClassification: Record<string, Prisma.Decimal> = {};
    const entries: FinanceLedgerEntryDto[] = [];
    for (const f of funding) {
      if (f.kind === 'CONTRIBUTION') {
        fundedIn = fundedIn.plus(f.amount);
        byClassification[f.classification] = (
          byClassification[f.classification] ?? ZERO
        ).plus(f.amount);
        if (FINANCE_REPAYABLE_CLASSIFICATIONS.includes(f.classification))
          loansIn = loansIn.plus(f.amount);
      } else repaid = repaid.plus(f.amount);
      entries.push({
        date: isoDay(f.date),
        kind: f.kind === 'CONTRIBUTION' ? 'FUNDING_IN' : 'REPAYMENT',
        description:
          f.purpose ??
          (f.kind === 'CONTRIBUTION'
            ? 'Funds received by FastQue'
            : 'Repaid by FastQue'),
        amount: money(f.amount),
        label: FINANCE_FUNDING_CLASSIFICATION_LABEL[f.classification],
        reference: f.reference ?? f.number,
      });
    }

    let paidPersonally = ZERO;
    let owed = ZERO;
    let awaiting = ZERO;
    let reimbursed = ZERO;
    const byTreatment: Record<string, Prisma.Decimal> = {};
    for (const p of payments) {
      paidPersonally = paidPersonally.plus(p.amount);
      const t = p.personalTreatment!;
      byTreatment[t] = (byTreatment[t] ?? ZERO).plus(p.amount);
      if (t === 'FOUNDER_LOAN') loansIn = loansIn.plus(p.amount);
      if (t === 'REIMBURSABLE') {
        const r = reimbursableOwed(p);
        owed = owed.plus(r.owed);
        awaiting = awaiting.plus(r.awaitingReview);
        reimbursed = reimbursed.plus(r.reimbursed);
      }
      entries.push({
        date: isoDay(p.paidOn),
        kind: 'PERSONAL_PAYMENT',
        description: `${p.expense.number} · ${p.expense.description}`,
        amount: money(p.amount),
        label: FINANCE_PERSONAL_TREATMENT_LABEL[t],
        reference: p.reference,
      });
      for (const claim of p.reimbursements)
        for (const payout of claim.payouts.filter((x) => !x.voidedAt))
          entries.push({
            date: isoDay(payout.paidOn),
            kind: 'REIMBURSEMENT_PAYOUT',
            description: `Reimbursed for ${p.expense.number}`,
            amount: money(payout.amount),
            label: claim.number,
            reference: payout.reference,
          });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const loanBalance = Prisma.Decimal.max(loansIn.minus(repaid), 0);
    const toStrings = (o: Record<string, Prisma.Decimal>) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, money(v)]));
    return {
      contributor: toContributorDto(contributor),
      totals: {
        fundedIntoCompany: money(fundedIn),
        byClassification: toStrings(byClassification),
        paidPersonally: money(paidPersonally),
        paidPersonallyByTreatment: toStrings(byTreatment),
        reimbursementOutstanding: money(owed.plus(awaiting)),
        reimbursed: money(reimbursed),
        loanBalance: money(loanBalance),
        repaid: money(repaid),
        netOwedByCompany: money(owed.plus(awaiting).plus(loanBalance)),
        totalContributed: money(fundedIn.plus(paidPersonally)),
      },
      entries,
    };
  }
}

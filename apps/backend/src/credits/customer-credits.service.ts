import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeMaxRedeemableCredits,
  CreditFundingSource,
  CreditsErrorCode,
  CreditTransactionType,
} from '@barbercue/shared';
import type {
  CustomerCreditBalanceDto,
  CustomerCreditTransactionDto,
  GrantPromotionalCreditsInput,
  PaginatedResult,
  PromotionalCreditGrantResultDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_HISTORY_PAGE_SIZE = 20;

interface RedeemResult {
  /** The amount actually applied — may be less than requested; see redeemUpTo's own doc comment. */
  actualUsed: number;
  /** The portion of actualUsed drawn from FASTQUE_FUNDED lots — what BookingsService should
   * actually record as FastQue's subsidy liability to the shop (never the full actualUsed once a
   * SHOP_FUNDED grant exists — see PlatformShopSubsidyEntry's own doc comment). */
  fastQueFundedConsumed: number;
}

/**
 * The only writer of CustomerCreditTransaction — BookingsService and AdminCreditsController never
 * touch the table directly, only call redeem/restore/grant here.
 *
 * LOT-BASED LEDGER, NO CACHED BALANCE (corrected design, post-review): there is no
 * CustomerCreditAccount.balance column. A customer's spendable balance is always computed live as
 * the sum of `remainingAmount` over their PROMO_GRANT/RESTORED rows ("lots") that are not expired.
 * This is what makes expiry actually work — an expired lot is mechanically excluded from every
 * balance/redemption query, not "marked inactive" by some sweep job that could fall behind or be
 * forgotten. See getBalance/redeemUpTo for the exact queries.
 *
 * There is no automatic "complete a service, earn credits back" mechanism. The ONLY ways spendable
 * value enters a wallet are an authorized PROMO_GRANT (grantPromotionalCredits, PLATFORM_ADMIN-only
 * — see AdminCreditsController) and a RESTORED reversal of a redemption whose booking was
 * cancelled (restoreForCancelledBooking).
 *
 * redeemUpTo/restoreForCancelledBooking take the CALLER's own transaction client (`tx`) rather than
 * opening one: they run inside BookingsService.create/cancel's existing transactions, so a credit
 * mutation is never committed for a booking creation/cancellation that itself gets rolled back.
 * grantPromotionalCredits is the exception — it is always the outermost transaction boundary,
 * since granting credit is never nested inside some other domain operation.
 */
@Injectable()
export class CustomerCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The REDEMPTION CAP for one booking at this price — see
   * packages/shared/src/calc.computeMaxRedeemableCredits, the single implementation this
   * delegates to so the server and every client-side preview can never disagree.
   */
  computeMaxRedeemable(servicePrice: number): number {
    return computeMaxRedeemableCredits(servicePrice);
  }

  /** Live sum of remainingAmount over this customer's still-valid (unexpired) lots. Never a cached
   * counter — see this class's own doc comment for why. */
  async getBalance(userId: string): Promise<CustomerCreditBalanceDto> {
    const account = await this.prisma.customerCreditAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) return { balance: 0 };
    const balance = await this.sumValidLots(this.prisma, account.id, new Date());
    return { balance };
  }

  async getHistory(
    userId: string,
    cursor?: string,
    limit = DEFAULT_HISTORY_PAGE_SIZE,
  ): Promise<PaginatedResult<CustomerCreditTransactionDto>> {
    const account = await this.prisma.customerCreditAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) return { items: [], nextCursor: null };

    const transactions = await this.prisma.customerCreditTransaction.findMany(
      {
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      },
    );
    const hasMore = transactions.length > limit;
    const page = hasMore ? transactions.slice(0, limit) : transactions;
    return {
      items: page.map((t) => this.toTransactionDto(t)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Applies up to `requestedAmount` credits against a booking, inside the caller's own transaction
   * (BookingsService.create). NEVER rejects for "not enough credits" — the backend does not trust
   * the client-supplied `requestedAmount` at all; it always computes:
   *
   *   actualUsed = min(requestedAmount, live unexpired balance, maxCreditsAllowed)
   *
   * and applies exactly that. `maxCreditsAllowed` must be `computeMaxRedeemable(price)`, computed
   * by the caller from the service's own server-trusted price — never client-supplied. This means
   * a booking's credit redemption always succeeds (possibly for 0), which is why this returns the
   * actual amount rather than throwing: BookingsService uses the return value, not the client's
   * request, to snapshot Booking.creditsRedeemedAmount.
   *
   * Concurrency: a per-customer Postgres advisory lock (held for this transaction) serializes every
   * redeem/restore/grant for this customer, so the read-then-write lot consumption below can never
   * race with another one — a second concurrent redemption simply sees whatever balance is left
   * once it acquires the lock, which naturally prevents double-spend/negative balances without
   * needing a single-statement atomic guard (unlike a cached-counter design).
   */
  async redeemUpTo(
    tx: Prisma.TransactionClient,
    customerId: string,
    bookingId: string,
    requestedAmount: number,
    maxCreditsAllowed: number,
  ): Promise<RedeemResult> {
    if (requestedAmount <= 0 || maxCreditsAllowed <= 0) {
      return { actualUsed: 0, fastQueFundedConsumed: 0 };
    }

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`credits:${customerId}`}))`,
    );

    const account = await tx.customerCreditAccount.findUnique({
      where: { userId: customerId },
      select: { id: true },
    });
    if (!account) return { actualUsed: 0, fastQueFundedConsumed: 0 };

    const now = new Date();
    const lots = await this.validLots(tx, account.id, now);
    const available = lots.reduce((sum, lot) => sum + Number(lot.remainingAmount), 0);
    const target = Math.min(requestedAmount, available, maxCreditsAllowed);
    if (target <= 0) return { actualUsed: 0, fastQueFundedConsumed: 0 };

    let remaining = target;
    let fastQueFundedConsumed = 0;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(Number(lot.remainingAmount), remaining);
      if (take <= 0) continue;
      await tx.customerCreditTransaction.update({
        where: { id: lot.id },
        data: { remainingAmount: { decrement: take } },
      });
      if (lot.fundingSource === CreditFundingSource.FASTQUE_FUNDED) {
        fastQueFundedConsumed += take;
      }
      remaining -= take;
    }
    const actualUsed = target - remaining;

    await tx.customerCreditTransaction.create({
      data: {
        accountId: account.id,
        type: CreditTransactionType.REDEEMED,
        amount: actualUsed,
        bookingId,
      },
    });

    return { actualUsed, fastQueFundedConsumed };
  }

  /**
   * Called from inside BookingsService.cancel's transaction. Restores exactly the amount snapshot
   * on Booking.creditsRedeemedAmount at creation time — never re-derived from current state.
   *
   * Deliberately mints a brand-new, never-expiring lot rather than crediting back whichever
   * original lot(s) funded the redemption: a customer should never lose restored money to an
   * expiry clock that kept ticking while it was tied up in a since-cancelled booking. See
   * CreditTransactionType.RESTORED's own doc comment.
   */
  async restoreForCancelledBooking(
    tx: Prisma.TransactionClient,
    customerId: string,
    bookingId: string,
    amount: number,
  ): Promise<void> {
    if (amount <= 0) return;

    const account = await tx.customerCreditAccount.upsert({
      where: { userId: customerId },
      create: { userId: customerId },
      update: {},
    });
    await tx.customerCreditTransaction.create({
      data: {
        accountId: account.id,
        type: CreditTransactionType.RESTORED,
        amount,
        remainingAmount: amount,
        bookingId,
      },
    });
  }

  /**
   * The ONLY way (besides restoration) new spendable credit enters a wallet. Always the outermost
   * transaction boundary — never called from inside another service's transaction. Caller
   * (AdminCreditsController) is PLATFORM_ADMIN-gated at the route level; this method additionally
   * takes `grantedByUserId` purely for the AuditLog row, never for authorization — the route guard
   * is the actual authorization boundary.
   *
   * Idempotency: `idempotencyKey` is required and unique at the database level (not just via the
   * generic @Idempotent() request-cache interceptor already on this route — a second, independent
   * backstop). A retried request with the exact same key AND the same customerId/amount/reason is
   * treated as a replay and returns the original grant unchanged; the same key with DIFFERENT
   * parameters is a real conflict (GRANT_IDEMPOTENCY_KEY_REUSED) — never silently overwritten or
   * silently granted twice.
   */
  async grantPromotionalCredits(
    grantedByUserId: string,
    idempotencyKey: string,
    input: GrantPromotionalCreditsInput,
  ): Promise<PromotionalCreditGrantResultDto> {
    const customer = await this.prisma.user.findUnique({
      where: { id: input.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new AppException(
        CreditsErrorCode.CUSTOMER_NOT_FOUND,
        'No customer found with that id.',
        HttpStatus.NOT_FOUND,
      );
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.customerCreditAccount.upsert({
          where: { userId: input.customerId },
          create: { userId: input.customerId },
          update: {},
        });
        const created = await tx.customerCreditTransaction.create({
          data: {
            accountId: account.id,
            type: CreditTransactionType.PROMO_GRANT,
            amount: input.amount,
            remainingAmount: input.amount,
            campaignRef: input.campaignRef ?? null,
            fundingSource: input.fundingSource,
            expiresAt,
            idempotencyKey,
            reason: input.reason,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: grantedByUserId,
            action: 'CREDIT_GRANTED',
            entityType: 'CustomerCreditTransaction',
            entityId: created.id,
            metadata: {
              customerId: input.customerId,
              amount: input.amount,
              reason: input.reason,
              campaignRef: input.campaignRef ?? null,
              fundingSource: input.fundingSource,
              expiresAt: expiresAt?.toISOString() ?? null,
            },
          },
        });
        return this.toTransactionDto(created);
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.customerCreditTransaction.findUnique({
          where: { idempotencyKey },
        });
        if (
          existing &&
          existing.type === CreditTransactionType.PROMO_GRANT &&
          Number(existing.amount) === input.amount &&
          existing.reason === input.reason
        ) {
          const existingAccount = await this.prisma.customerCreditAccount.findUnique({
            where: { id: existing.accountId },
            select: { userId: true },
          });
          if (existingAccount?.userId === input.customerId) {
            return this.toTransactionDto(existing);
          }
        }
        throw new AppException(
          CreditsErrorCode.GRANT_IDEMPOTENCY_KEY_REUSED,
          'This Idempotency-Key was already used for a different grant.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  private async validLots(
    client: Prisma.TransactionClient | PrismaService,
    accountId: string,
    now: Date,
  ) {
    return client.customerCreditTransaction.findMany({
      where: {
        accountId,
        remainingAmount: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
  }

  private async sumValidLots(
    client: Prisma.TransactionClient | PrismaService,
    accountId: string,
    now: Date,
  ): Promise<number> {
    const result = await client.customerCreditTransaction.aggregate({
      where: {
        accountId,
        remainingAmount: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: { remainingAmount: true },
    });
    return Number(result._sum.remainingAmount ?? 0);
  }

  private toTransactionDto(t: {
    id: string;
    type: string;
    amount: Prisma.Decimal;
    bookingId: string | null;
    remainingAmount: Prisma.Decimal | null;
    campaignRef: string | null;
    fundingSource: string | null;
    expiresAt: Date | null;
    reason: string | null;
    note: string | null;
    createdAt: Date;
  }): CustomerCreditTransactionDto {
    return {
      id: t.id,
      type: t.type as CustomerCreditTransactionDto['type'],
      amount: Number(t.amount),
      bookingId: t.bookingId,
      remainingAmount: t.remainingAmount !== null ? Number(t.remainingAmount) : null,
      campaignRef: t.campaignRef,
      fundingSource: t.fundingSource as CustomerCreditTransactionDto['fundingSource'],
      expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
      reason: t.reason,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    };
  }
}

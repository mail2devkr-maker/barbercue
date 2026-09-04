import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CREDIT_PER_SLAB_INR,
  CREDIT_SLAB_AMOUNT_INR,
  CreditsErrorCode,
  CreditTransactionType,
} from '@barbercue/shared';
import type {
  CustomerCreditBalanceDto,
  CustomerCreditTransactionDto,
  PaginatedResult,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_HISTORY_PAGE_SIZE = 20;

/**
 * The only writer of CustomerCreditAccount.balance and CustomerCreditTransaction — BookingsService
 * and QueueService never touch either table directly, only call earn/redeem/restore here (same
 * "one service owns the column" contract as AiCreditService for the unrelated AI-credit pool).
 *
 * Every mutating method takes the caller's own transaction client (`tx`) rather than opening one
 * itself: earning happens inside QueueService.completeSession's existing transaction (so a credit
 * is never granted for a session-completion that itself gets rolled back), and
 * redeem/restore happen inside BookingsService.create/cancel's existing transactions for the same
 * reason. This service is intentionally never the outermost transaction boundary for any of the
 * three — see each method's own doc comment for exactly which caller-held lock makes it safe.
 */
@Injectable()
export class CustomerCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * floor(price / CREDIT_SLAB_AMOUNT_INR) * CREDIT_PER_SLAB_INR — see CREDIT_SLAB_AMOUNT_INR's own
   * doc comment in packages/shared/src/constants for why this can never exceed 20% of price.
   */
  computeEarnedCredits(servicePrice: number): number {
    const slabs = Math.floor(servicePrice / CREDIT_SLAB_AMOUNT_INR);
    return slabs * CREDIT_PER_SLAB_INR;
  }

  async getBalance(userId: string): Promise<CustomerCreditBalanceDto> {
    const account = await this.prisma.customerCreditAccount.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return { balance: account ? Number(account.balance) : 0 };
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
      items: page.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        bookingId: t.bookingId,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Called from inside QueueService.completeSession's transaction, only after that method's own
   * updateMany-with-count-guard has confirmed this exact session is transitioning ACTIVE ->
   * COMPLETED for the first (and only) time — that guard is what makes this idempotent: a session
   * can never complete twice, so this can never double-earn for one booking/visit.
   *
   * A brand-new CustomerCreditAccount is created with `upsert` on first earn rather than requiring
   * one to exist ahead of time — most customers will never have redeemed anything yet, so forcing
   * an account row to exist before it does anything useful would just be ceremony.
   */
  async earnForCompletedSession(
    tx: Prisma.TransactionClient,
    customerId: string,
    bookingId: string | null,
    servicePrice: Prisma.Decimal | number,
  ): Promise<number> {
    const amount = this.computeEarnedCredits(Number(servicePrice));
    if (amount <= 0) return 0;

    const account = await tx.customerCreditAccount.upsert({
      where: { userId: customerId },
      create: { userId: customerId, balance: amount },
      update: { balance: { increment: amount } },
    });
    await tx.customerCreditTransaction.create({
      data: {
        accountId: account.id,
        type: CreditTransactionType.EARNED,
        amount,
        bookingId: bookingId ?? undefined,
      },
    });
    return amount;
  }

  /**
   * Called from inside BookingsService.create's transaction, itself already holding a per-salon
   * advisory lock for slot-capacity purposes. That lock does not protect the customer's own
   * balance against a second, unrelated booking request racing to redeem from the same account, so
   * this additionally takes its own per-customer advisory lock before the balance-guarded
   * updateMany below — the same "advisory lock + updateMany guard" idiom as AiCreditService's
   * reserveCredit, scoped to a different key so the two locks never collide or need to be taken in
   * a fixed order relative to each other.
   *
   * Throws INSUFFICIENT_CREDITS (never silently clamps) if the requested amount exceeds the live
   * balance at the moment this actually runs — the caller must re-fetch/redisplay rather than
   * assume a stale balance shown earlier in the request is still correct.
   */
  async redeemForBooking(
    tx: Prisma.TransactionClient,
    customerId: string,
    bookingId: string,
    amount: number,
  ): Promise<void> {
    if (amount <= 0) return;

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`credits:${customerId}`}))`,
    );

    const claim = await tx.customerCreditAccount.updateMany({
      where: { userId: customerId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (claim.count === 0) {
      throw new AppException(
        CreditsErrorCode.INSUFFICIENT_CREDITS,
        "You don't have enough FastQue Credits to redeem that amount. Refresh your balance and try again.",
        HttpStatus.CONFLICT,
      );
    }

    const account = await tx.customerCreditAccount.findUniqueOrThrow({
      where: { userId: customerId },
      select: { id: true },
    });
    await tx.customerCreditTransaction.create({
      data: {
        accountId: account.id,
        type: CreditTransactionType.REDEEMED,
        amount,
        bookingId,
      },
    });
  }

  /**
   * Called from inside BookingsService.cancel's transaction. Restores exactly the amount snapshot
   * on Booking.creditsRedeemedAmount at creation time — never re-derived from current state, so a
   * later balance-affecting event elsewhere can never change how much a cancellation gives back.
   * No advisory lock needed here: this only ever increments (can never drive the balance negative
   * or race against another redemption to overspend), so a plain `increment` is safe under
   * concurrent access the same way AiCreditService.releaseCredit's decrement-guarded updateMany is
   * safe for its own direction.
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
      create: { userId: customerId, balance: amount },
      update: { balance: { increment: amount } },
    });
    await tx.customerCreditTransaction.create({
      data: {
        accountId: account.id,
        type: CreditTransactionType.RESTORED,
        amount,
        bookingId,
      },
    });
  }
}

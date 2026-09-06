import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeMaxRedeemableCreditsPaise,
  CreditFundingSource,
  CreditsErrorCode,
  CreditTransactionType,
  decimalStringToPaise,
  numberToPaise,
  paiseToDecimalString,
  paiseToRupees,
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
  /** The amount actually applied, in exact integer PAISE — may be less than requested; see
   * redeemUpTo's own doc comment. Paise, not rupees (Part 11 precision hardening): the caller
   * converts straight to a Decimal string at the point of persistence, never through a rupee
   * float. */
  actualUsedPaise: number;
  /** The portion of actualUsedPaise drawn from FASTQUE_FUNDED lots, in paise — what
   * BookingsService should actually record as FastQue's subsidy liability to the shop (never the
   * full actualUsedPaise once a SHOP_FUNDED grant exists — see PlatformShopSubsidyEntry's own doc
   * comment). */
  fastQueFundedConsumedPaise: number;
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
   * The AUTHORITATIVE REDEMPTION CAP for one booking at this price (Part 11 precision hardening).
   * Accepts the service's own Prisma.Decimal directly — never `Number(service.price)` — and
   * converts it to exact integer paise via its `.toString()` before the slab formula runs, so the
   * cap the server actually enforces is never derived from a floating-point division of a
   * fractional rupee value. A plain `number`/`string` is also accepted (existing call sites and
   * tests that already hold a whole-rupee value) — safe because `String(n)` for any such value is
   * the exact literal (see packages/shared's money module for why), never a source of the
   * float-division risk this hardening exists to remove.
   *
   * packages/shared/src/calc.computeMaxRedeemableCredits is the float-based CLIENT PREVIEW ONLY
   * (web/mobile render it before a booking exists, purely for UX) — the server never calls it or
   * trusts its result; this method is the one true authority.
   */
  computeMaxRedeemable(servicePrice: Prisma.Decimal | string | number): number {
    const paise = decimalStringToPaise(servicePrice.toString());
    return paiseToRupees(computeMaxRedeemableCreditsPaise(paise));
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
   * Part 11 precision hardening: `requestedAmount`/`maxCreditsAllowed` are still rupee `number`s at
   * this public boundary (the caller's existing values — a client-supplied, already-validated
   * ≤2-decimal request amount, and computeMaxRedeemable's own rupee return value), but everything
   * from here on — the live balance, the min() clamp, and every lot decrement — happens in exact
   * integer PAISE. The result (RedeemResult) is paise too, so BookingsService never has to convert
   * back through a rupee float before writing a Decimal field.
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
      return { actualUsedPaise: 0, fastQueFundedConsumedPaise: 0 };
    }

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`credits:${customerId}`}))`,
    );

    const account = await tx.customerCreditAccount.findUnique({
      where: { userId: customerId },
      select: { id: true },
    });
    if (!account) return { actualUsedPaise: 0, fastQueFundedConsumedPaise: 0 };

    const now = new Date();
    const lots = await this.validLots(tx, account.id, now);
    // Every lot's remainingAmount is converted from its exact Decimal string once, here — never
    // via Number(lot.remainingAmount). The validLots query's own `remainingAmount: { gt: 0 }`
    // filter guarantees this is never null for a row actually returned.
    const lotPaise = lots.map((lot) => decimalStringToPaise(lot.remainingAmount!.toString()));
    const requestedPaise = numberToPaise(requestedAmount);
    const maxCreditsAllowedPaise = numberToPaise(maxCreditsAllowed);
    const availablePaise = lotPaise.reduce((sum, paise) => sum + paise, 0);
    const targetPaise = Math.min(requestedPaise, availablePaise, maxCreditsAllowedPaise);
    if (targetPaise <= 0) return { actualUsedPaise: 0, fastQueFundedConsumedPaise: 0 };

    let remainingPaise = targetPaise;
    let fastQueFundedConsumedPaise = 0;
    for (let i = 0; i < lots.length; i++) {
      if (remainingPaise <= 0) break;
      const takePaise = Math.min(lotPaise[i], remainingPaise);
      if (takePaise <= 0) continue;
      await tx.customerCreditTransaction.update({
        where: { id: lots[i].id },
        data: { remainingAmount: { decrement: paiseToDecimalString(takePaise) } },
      });
      if (lots[i].fundingSource === CreditFundingSource.FASTQUE_FUNDED) {
        fastQueFundedConsumedPaise += takePaise;
      }
      remainingPaise -= takePaise;
    }
    const actualUsedPaise = targetPaise - remainingPaise;

    await tx.customerCreditTransaction.create({
      data: {
        accountId: account.id,
        type: CreditTransactionType.REDEEMED,
        amount: paiseToDecimalString(actualUsedPaise),
        bookingId,
      },
    });

    return { actualUsedPaise, fastQueFundedConsumedPaise };
  }

  /**
   * Called from inside BookingsService.cancel's transaction. Restores exactly the amount snapshot
   * on Booking.creditsRedeemedAmount at creation time — never re-derived from current state.
   *
   * Deliberately mints a brand-new, never-expiring lot rather than crediting back whichever
   * original lot(s) funded the redemption: a customer should never lose restored money to an
   * expiry clock that kept ticking while it was tied up in a since-cancelled booking. See
   * CreditTransactionType.RESTORED's own doc comment.
   *
   * Part 11 precision hardening: `amountPaise` is exact integer paise (the caller reads
   * Booking.creditsRedeemedAmount's own Decimal string directly into paise, never via
   * Number(decimal)) — this method is a pure passthrough with zero arithmetic on it, so the
   * restored amount can never drift from the original redemption by even a fraction of a paisa.
   */
  async restoreForCancelledBooking(
    tx: Prisma.TransactionClient,
    customerId: string,
    bookingId: string,
    amountPaise: number,
  ): Promise<void> {
    if (amountPaise <= 0) return;

    const account = await tx.customerCreditAccount.upsert({
      where: { userId: customerId },
      create: { userId: customerId },
      update: {},
    });
    const amountDecimal = paiseToDecimalString(amountPaise);
    await tx.customerCreditTransaction.create({
      data: {
        accountId: account.id,
        type: CreditTransactionType.RESTORED,
        amount: amountDecimal,
        remainingAmount: amountDecimal,
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
    // Part 11 precision hardening: input.amount is already zod-validated to at most 2 decimal
    // places (grantPromotionalCreditsSchema's multipleOf(0.01)) — numberToPaise re-validates that
    // defensively and gives an exact decimal string to persist, rather than handing the raw JS
    // number straight to Prisma's Decimal constructor.
    const amountPaise = numberToPaise(input.amount);
    const amountDecimal = paiseToDecimalString(amountPaise);

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
            amount: amountDecimal,
            remainingAmount: amountDecimal,
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
        // Every field the request actually controls must match for this to be a genuine replay —
        // not just type/amount/reason. The primary defense against a same-key-different-payload
        // retry is the generic @Idempotent() interceptor's full-request-hash cache (see
        // IdempotencyInterceptor), but that cache has a 24h TTL; this DB-level fallback is reached
        // whenever it has expired or was bypassed, so it must independently enforce the same "same
        // key + different payload -> reject" rule on its own, not just on the subset of fields
        // originally checked here.
        if (
          existing &&
          existing.type === CreditTransactionType.PROMO_GRANT &&
          decimalStringToPaise(existing.amount.toString()) === amountPaise &&
          existing.reason === input.reason &&
          existing.campaignRef === (input.campaignRef ?? null) &&
          existing.fundingSource === input.fundingSource &&
          (existing.expiresAt?.getTime() ?? null) === (expiresAt?.getTime() ?? null)
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
    // The SUM itself is computed by Postgres on the Decimal column (exact — no JS arithmetic
    // involved at all). Converting through paise here is for representation consistency with the
    // rest of this file, not because this specific aggregate was ever at risk.
    const result = await client.customerCreditTransaction.aggregate({
      where: {
        accountId,
        remainingAmount: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: { remainingAmount: true },
    });
    const sum = result._sum.remainingAmount;
    return sum ? paiseToRupees(decimalStringToPaise(sum.toString())) : 0;
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

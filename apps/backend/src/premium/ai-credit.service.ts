import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AiCreditTransactionType,
  CustomerSubscriptionStatus,
  StyleAdvisorErrorCode,
} from '@barbercue/shared';
import type { AiCreditBalanceDto } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The only writer of CustomerSubscription.aiCredits{Reserved,Consumed} and AiCreditTransaction —
 * StyleAdvisorService never touches these columns directly. Reserve/consume/release model a
 * classic hold-then-settle flow: reserve() moves capacity out of "available" the moment a
 * generation request starts (so a second concurrent request can't also spend it), and the caller
 * MUST follow up with exactly one of consumeCredit (generation succeeded) or releaseCredit
 * (generation failed) using the subscriptionId reserve() returned.
 */
@Injectable()
export class AiCreditService {
  private readonly logger = new Logger(AiCreditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string): Promise<AiCreditBalanceDto> {
    const subscription = await this.findActiveSubscription(userId);
    if (!subscription) {
      return { allocated: 0, reserved: 0, consumed: 0, available: 0 };
    }
    return this.toBalanceDto(subscription);
  }

  private toBalanceDto(subscription: {
    aiCreditsAllocated: number;
    aiCreditsReserved: number;
    aiCreditsConsumed: number;
  }): AiCreditBalanceDto {
    const available = Math.max(
      0,
      subscription.aiCreditsAllocated -
        subscription.aiCreditsReserved -
        subscription.aiCreditsConsumed,
    );
    return {
      allocated: subscription.aiCreditsAllocated,
      reserved: subscription.aiCreditsReserved,
      consumed: subscription.aiCreditsConsumed,
      available,
    };
  }

  private async findActiveSubscription(userId: string) {
    const subscription = await this.prisma.customerSubscription.findFirst({
      where: { userId, status: CustomerSubscriptionStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription || subscription.periodEnd <= new Date()) return null;
    return subscription;
  }

  /**
   * Reserves exactly one AI credit for `userId`'s active Premium subscription. Throws
   * PREMIUM_REQUIRED (no active subscription) or AI_CREDITS_EXHAUSTED (zero available balance) —
   * the caller (StyleAdvisorService) must map neither to a generic error, and must never call the
   * AI provider without a successful reservation first.
   *
   * The whole check-then-increment is wrapped in a single transaction holding a per-user Postgres
   * advisory lock (same pattern as BookingsService's per-salon slot-capacity lock) so two
   * concurrent requests for the same user — e.g. two browser tabs — can't both observe "1 credit
   * available" and both proceed; the second one serializes behind the first and sees the
   * post-reservation balance.
   */
  async reserveCredit(userId: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`,
      );

      const subscription = await tx.customerSubscription.findFirst({
        where: { userId, status: CustomerSubscriptionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
      if (!subscription || subscription.periodEnd <= new Date()) {
        throw new AppException(
          StyleAdvisorErrorCode.PREMIUM_REQUIRED,
          'The AI Style Advisor is a Premium feature. Upgrade to Premium to preview hairstyles on your photo.',
          HttpStatus.FORBIDDEN,
        );
      }

      const available =
        subscription.aiCreditsAllocated -
        subscription.aiCreditsReserved -
        subscription.aiCreditsConsumed;
      if (available < 1) {
        throw new AppException(
          StyleAdvisorErrorCode.AI_CREDITS_EXHAUSTED,
          "You've used all your AI Style credits for this subscription period.",
          HttpStatus.FORBIDDEN,
        );
      }

      await tx.customerSubscription.update({
        where: { id: subscription.id },
        data: { aiCreditsReserved: { increment: 1 } },
      });
      await tx.aiCreditTransaction.create({
        data: {
          subscriptionId: subscription.id,
          type: AiCreditTransactionType.RESERVATION,
          amount: 1,
        },
      });

      return subscription.id;
    });
  }

  /** Generation succeeded — permanently spend the reservation made by reserveCredit. */
  async consumeCredit(subscriptionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // updateMany + a reserved>=1 guard, not a bare update: defends against ever driving the
      // reserved counter negative (e.g. a bug that double-calls consume/release for one
      // reservation) rather than trusting the caller's single-call discipline alone.
      const result = await tx.customerSubscription.updateMany({
        where: { id: subscriptionId, aiCreditsReserved: { gte: 1 } },
        data: {
          aiCreditsReserved: { decrement: 1 },
          aiCreditsConsumed: { increment: 1 },
        },
      });
      if (result.count === 0) {
        this.logger.warn(
          `consumeCredit called for subscription ${subscriptionId} with no outstanding reservation — ignored, not applied.`,
        );
        return;
      }
      await tx.aiCreditTransaction.create({
        data: {
          subscriptionId,
          type: AiCreditTransactionType.CONSUMPTION,
          amount: 1,
        },
      });
    });
  }

  /** Generation failed — return the reservation made by reserveCredit without spending it. */
  async releaseCredit(subscriptionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.customerSubscription.updateMany({
        where: { id: subscriptionId, aiCreditsReserved: { gte: 1 } },
        data: { aiCreditsReserved: { decrement: 1 } },
      });
      if (result.count === 0) {
        this.logger.warn(
          `releaseCredit called for subscription ${subscriptionId} with no outstanding reservation — ignored, not applied.`,
        );
        return;
      }
      await tx.aiCreditTransaction.create({
        data: {
          subscriptionId,
          type: AiCreditTransactionType.RELEASE,
          amount: 1,
        },
      });
    });
  }
}

import { Injectable } from '@nestjs/common';
import {
  AiCreditTransactionType,
  CustomerSubscriptionStatus,
} from '@barbercue/shared';
import type { PremiumEntitlementDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PremiumPlansService } from './premium-plans.service';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The single centralized place that answers "is this customer Premium right now" —
 * StyleAdvisorService (via AiCreditService) and every future Premium-gated feature depend on this
 * rather than each scattering its own `plan === 'basic' || plan === 'pro' || ...` check.
 *
 * Deliberately no background job flips an expired row's status to EXPIRED — "active" is always
 * computed as (status === ACTIVE && periodEnd > now), so an expired subscription is correctly
 * treated as non-Premium immediately with no cron/sweep needed. Keeps this first implementation
 * simple and auditable, per the explicit "no complicated rollover logic" instruction.
 */
@Injectable()
export class PremiumEntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PremiumPlansService,
  ) {}

  async getActiveSubscription(userId: string) {
    const subscription = await this.prisma.customerSubscription.findFirst({
      where: { userId, status: CustomerSubscriptionStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription || subscription.periodEnd <= new Date()) return null;
    return subscription;
  }

  async hasActivePremiumSubscription(userId: string): Promise<boolean> {
    return (await this.getActiveSubscription(userId)) !== null;
  }

  async getEntitlement(userId: string): Promise<PremiumEntitlementDto> {
    const subscription = await this.getActiveSubscription(userId);
    if (!subscription) {
      return {
        isPremium: false,
        planId: null,
        planName: null,
        periodEnd: null,
      };
    }
    return {
      isPremium: true,
      planId: subscription.planId,
      planName: subscription.plan.name,
      periodEnd: subscription.periodEnd.toISOString(),
    };
  }

  /**
   * Development/test-only: activates a real CustomerSubscription for `userId` without any
   * payment, so Premium can be exercised locally. PremiumController refuses to call this outside
   * a non-production environment — see that guard, not this method, as the actual safety
   * boundary; this method itself has no environment check so it stays trivially unit-testable.
   */
  async activateForDevelopment(
    userId: string,
    planId: string,
  ): Promise<PremiumEntitlementDto> {
    const plan = await this.plans.findByIdOrThrow(planId);
    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + ONE_YEAR_MS);

    await this.prisma.$transaction(async (tx) => {
      // A test account should only ever hold one ACTIVE subscription — supersede any existing one
      // rather than accumulating duplicates across repeated dev-activate calls.
      await tx.customerSubscription.updateMany({
        where: { userId, status: CustomerSubscriptionStatus.ACTIVE },
        data: { status: CustomerSubscriptionStatus.CANCELLED },
      });
      const subscription = await tx.customerSubscription.create({
        data: {
          userId,
          planId: plan.id,
          status: CustomerSubscriptionStatus.ACTIVE,
          periodStart,
          periodEnd,
          aiCreditsAllocated: plan.aiCreditsPerYear,
        },
      });
      await tx.aiCreditTransaction.create({
        data: {
          subscriptionId: subscription.id,
          type: AiCreditTransactionType.ALLOCATION,
          amount: plan.aiCreditsPerYear,
          note: 'dev/test activation — no real payment',
        },
      });
    });

    return this.getEntitlement(userId);
  }
}

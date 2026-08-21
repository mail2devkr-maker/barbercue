import { HttpStatus, Injectable } from '@nestjs/common';
import { PremiumErrorCode } from '@barbercue/shared';
import type { CustomerPremiumPlanDto } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single authoritative source for Premium plan price/credit values — reads the
 * CustomerPremiumPlan table (seeded by prisma/seed.ts) rather than any hard-coded constant, so
 * changing a price/credit allowance later is a data change, not a code change.
 */
@Injectable()
export class PremiumPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listActivePlans(): Promise<CustomerPremiumPlanDto[]> {
    const plans = await this.prisma.customerPremiumPlan.findMany({
      where: { isActive: true },
      orderBy: { priceInr: 'asc' },
    });
    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      priceInr: Number(plan.priceInr),
      aiCreditsPerYear: plan.aiCreditsPerYear,
      isPopular: plan.isPopular,
    }));
  }

  async findByIdOrThrow(planId: string) {
    const plan = await this.prisma.customerPremiumPlan.findUnique({
      where: { id: planId },
    });
    if (!plan || !plan.isActive) {
      throw new AppException(
        PremiumErrorCode.PLAN_NOT_FOUND,
        'That plan is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    return plan;
  }
}

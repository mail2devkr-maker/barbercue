import { PremiumPlansService } from './premium-plans.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

interface PrismaMock {
  customerPremiumPlan: { findMany: jest.Mock; findUnique: jest.Mock };
}

describe('PremiumPlansService', () => {
  let service: PremiumPlansService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = {
      customerPremiumPlan: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    service = new PremiumPlansService(prisma as never);
  });

  it('lists Basic (12 credits/year), Pro (48, popular), and Max (84)', async () => {
    prisma.customerPremiumPlan.findMany.mockResolvedValue([
      { id: 'basic', name: 'Basic', priceInr: decimal('99.00'), aiCreditsPerYear: 12, isPopular: false, isActive: true },
      { id: 'pro', name: 'Pro', priceInr: decimal('299.00'), aiCreditsPerYear: 48, isPopular: true, isActive: true },
      { id: 'max', name: 'Max', priceInr: decimal('499.00'), aiCreditsPerYear: 84, isPopular: false, isActive: true },
    ]);

    const plans = await service.listActivePlans();

    expect(plans).toEqual([
      { id: 'basic', name: 'Basic', priceInr: 99, aiCreditsPerYear: 12, isPopular: false },
      { id: 'pro', name: 'Pro', priceInr: 299, aiCreditsPerYear: 48, isPopular: true },
      { id: 'max', name: 'Max', priceInr: 499, aiCreditsPerYear: 84, isPopular: false },
    ]);
    expect(plans.find((p) => p.id === 'pro')?.isPopular).toBe(true);
    expect(plans.filter((p) => p.isPopular)).toHaveLength(1);
  });

  it('only queries active plans', async () => {
    prisma.customerPremiumPlan.findMany.mockResolvedValue([]);
    await service.listActivePlans();
    expect(prisma.customerPremiumPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('findByIdOrThrow throws PLAN_NOT_FOUND for an unknown or inactive plan', async () => {
    prisma.customerPremiumPlan.findUnique.mockResolvedValue(null);
    await expect(service.findByIdOrThrow('nonexistent')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });

    prisma.customerPremiumPlan.findUnique.mockResolvedValue({ id: 'basic', isActive: false });
    await expect(service.findByIdOrThrow('basic')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
  });

  it('findByIdOrThrow returns the plan row when active', async () => {
    const planRow = { id: 'pro', name: 'Pro', priceInr: decimal('299.00'), aiCreditsPerYear: 48, isPopular: true, isActive: true };
    prisma.customerPremiumPlan.findUnique.mockResolvedValue(planRow);
    await expect(service.findByIdOrThrow('pro')).resolves.toBe(planRow);
  });
});

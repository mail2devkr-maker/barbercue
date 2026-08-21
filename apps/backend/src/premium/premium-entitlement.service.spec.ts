import { PremiumEntitlementService } from './premium-entitlement.service';
import { PremiumPlansService } from './premium-plans.service';

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

interface PrismaMock {
  customerSubscription: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
  aiCreditTransaction: { create: jest.Mock };
  $transaction: jest.Mock;
}

describe('PremiumEntitlementService', () => {
  let service: PremiumEntitlementService;
  let prisma: PrismaMock;
  let plans: { findByIdOrThrow: jest.Mock };

  beforeEach(() => {
    prisma = {
      customerSubscription: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      aiCreditTransaction: { create: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    plans = { findByIdOrThrow: jest.fn() };
    service = new PremiumEntitlementService(prisma as never, plans as unknown as PremiumPlansService);
  });

  describe('hasActivePremiumSubscription / getEntitlement', () => {
    it('a free customer (no subscription row) is not Premium', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue(null);
      await expect(service.hasActivePremiumSubscription('u1')).resolves.toBe(false);
      await expect(service.getEntitlement('u1')).resolves.toEqual({
        isPremium: false,
        planId: null,
        planName: null,
        periodEnd: null,
      });
    });

    it.each(['basic', 'pro', 'max'])('an active %s subscription is Premium', async (planId) => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        planId,
        plan: { name: planId },
        status: 'ACTIVE',
        periodEnd: FUTURE,
      });
      await expect(service.hasActivePremiumSubscription('u1')).resolves.toBe(true);
      const entitlement = await service.getEntitlement('u1');
      expect(entitlement.isPremium).toBe(true);
      expect(entitlement.planId).toBe(planId);
    });

    it('an expired subscription is not Premium, even if status is still ACTIVE', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        planId: 'pro',
        plan: { name: 'Pro' },
        status: 'ACTIVE',
        periodEnd: PAST,
      });
      await expect(service.hasActivePremiumSubscription('u1')).resolves.toBe(false);
    });

    it('only ever looks up the calling user\'s own subscription', async () => {
      prisma.customerSubscription.findFirst.mockResolvedValue(null);
      await service.getEntitlement('u1');
      expect(prisma.customerSubscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
      );
    });
  });

  describe('activateForDevelopment', () => {
    it('creates an ACTIVE subscription snapshotting the plan\'s credit allowance', async () => {
      plans.findByIdOrThrow.mockResolvedValue({ id: 'pro', name: 'Pro', aiCreditsPerYear: 48 });
      prisma.customerSubscription.create.mockResolvedValue({ id: 'new-sub' });
      prisma.customerSubscription.findFirst.mockResolvedValue({
        id: 'new-sub',
        planId: 'pro',
        plan: { name: 'Pro' },
        status: 'ACTIVE',
        periodEnd: FUTURE,
      });

      const result = await service.activateForDevelopment('u1', 'pro');

      expect(prisma.customerSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', planId: 'pro', aiCreditsAllocated: 48, status: 'ACTIVE' }),
        }),
      );
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subscriptionId: 'new-sub', type: 'ALLOCATION', amount: 48 }) }),
      );
      expect(result.isPremium).toBe(true);
    });

    it('cancels any existing active subscription before creating the new one', async () => {
      plans.findByIdOrThrow.mockResolvedValue({ id: 'basic', name: 'Basic', aiCreditsPerYear: 12 });
      prisma.customerSubscription.create.mockResolvedValue({ id: 'new-sub' });
      prisma.customerSubscription.findFirst.mockResolvedValue(null);

      await service.activateForDevelopment('u1', 'basic');

      expect(prisma.customerSubscription.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
    });
  });
});

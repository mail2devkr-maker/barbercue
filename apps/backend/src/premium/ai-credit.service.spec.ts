import { AiCreditService } from './ai-credit.service';

interface SubscriptionRow {
  id: string;
  userId: string;
  status: string;
  periodEnd: Date;
  aiCreditsAllocated: number;
  aiCreditsReserved: number;
  aiCreditsConsumed: number;
}

interface PrismaMock {
  customerSubscription: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  aiCreditTransaction: { create: jest.Mock };
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
}

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

function makeSubscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-1',
    userId: 'u1',
    status: 'ACTIVE',
    periodEnd: FUTURE,
    aiCreditsAllocated: 2,
    aiCreditsReserved: 0,
    aiCreditsConsumed: 0,
    ...overrides,
  };
}

describe('AiCreditService', () => {
  let service: AiCreditService;
  let prisma: PrismaMock;
  let row: SubscriptionRow | null;

  beforeEach(() => {
    row = makeSubscription();

    prisma = {
      customerSubscription: {
        findFirst: jest.fn(() => Promise.resolve(row)),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          if (!row) return Promise.resolve(null);
          applyUpdateData(row, args.data);
          return Promise.resolve(row);
        }),
        updateMany: jest.fn((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (!row) return Promise.resolve({ count: 0 });
          const minReserved = (args.where.aiCreditsReserved as { gte?: number } | undefined)?.gte;
          if (minReserved !== undefined && row.aiCreditsReserved < minReserved) {
            return Promise.resolve({ count: 0 });
          }
          applyUpdateData(row, args.data);
          return Promise.resolve({ count: 1 });
        }),
      },
      aiCreditTransaction: { create: jest.fn(() => Promise.resolve({})) },
      $executeRaw: jest.fn(() => Promise.resolve(undefined)),
      // Same interactive-transaction mock pattern as bookings.service.spec.ts — run the callback
      // against `prisma` itself since every tx.* method it touches is mocked directly above.
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };

    service = new AiCreditService(prisma as never);
  });

  function applyUpdateData(target: SubscriptionRow, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      const inc = (value as { increment?: number } | undefined)?.increment;
      const dec = (value as { decrement?: number } | undefined)?.decrement;
      if (inc !== undefined) (target as unknown as Record<string, number>)[key] += inc;
      else if (dec !== undefined) (target as unknown as Record<string, number>)[key] -= dec;
      else (target as unknown as Record<string, unknown>)[key] = value;
    }
  }

  describe('getBalance', () => {
    it('returns all zeros for a customer with no active subscription', async () => {
      row = null;
      await expect(service.getBalance('u1')).resolves.toEqual({
        allocated: 0,
        reserved: 0,
        consumed: 0,
        available: 0,
      });
    });

    it('computes available as allocated - reserved - consumed', async () => {
      row = makeSubscription({ aiCreditsAllocated: 10, aiCreditsReserved: 2, aiCreditsConsumed: 3 });
      await expect(service.getBalance('u1')).resolves.toEqual({
        allocated: 10,
        reserved: 2,
        consumed: 3,
        available: 5,
      });
    });

    it('treats an expired subscription as no subscription', async () => {
      row = makeSubscription({ periodEnd: PAST });
      await expect(service.getBalance('u1')).resolves.toEqual({
        allocated: 0,
        reserved: 0,
        consumed: 0,
        available: 0,
      });
    });
  });

  describe('reserveCredit', () => {
    it('throws PREMIUM_REQUIRED when the customer has no active subscription', async () => {
      row = null;
      await expect(service.reserveCredit('u1')).rejects.toMatchObject({ code: 'PREMIUM_REQUIRED' });
    });

    it('throws PREMIUM_REQUIRED when the subscription has expired', async () => {
      row = makeSubscription({ periodEnd: PAST });
      await expect(service.reserveCredit('u1')).rejects.toMatchObject({ code: 'PREMIUM_REQUIRED' });
    });

    it('reserves a credit, incrementing aiCreditsReserved and logging a RESERVATION transaction', async () => {
      const subscriptionId = await service.reserveCredit('u1');
      expect(subscriptionId).toBe('sub-1');
      expect(row!.aiCreditsReserved).toBe(1);
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith({
        data: { subscriptionId: 'sub-1', type: 'RESERVATION', amount: 1 },
      });
    });

    it('acquires a per-user advisory lock before checking the balance', async () => {
      await service.reserveCredit('u1');
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('throws AI_CREDITS_EXHAUSTED once every credit is reserved, without over-reserving', async () => {
      row = makeSubscription({ aiCreditsAllocated: 2 });
      await service.reserveCredit('u1');
      await service.reserveCredit('u1');
      expect(row!.aiCreditsReserved).toBe(2);

      await expect(service.reserveCredit('u1')).rejects.toMatchObject({ code: 'AI_CREDITS_EXHAUSTED' });
      // The failed 3rd attempt must not have touched the counter — no over-reservation.
      expect(row!.aiCreditsReserved).toBe(2);
    });

    it('accounts consumed credits toward exhaustion, not just reserved', async () => {
      row = makeSubscription({ aiCreditsAllocated: 1, aiCreditsConsumed: 1 });
      await expect(service.reserveCredit('u1')).rejects.toMatchObject({ code: 'AI_CREDITS_EXHAUSTED' });
    });
  });

  describe('consumeCredit', () => {
    it('moves one credit from reserved to consumed and logs a CONSUMPTION transaction', async () => {
      row = makeSubscription({ aiCreditsReserved: 1 });
      await service.consumeCredit('sub-1');
      expect(row!.aiCreditsReserved).toBe(0);
      expect(row!.aiCreditsConsumed).toBe(1);
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith({
        data: { subscriptionId: 'sub-1', type: 'CONSUMPTION', amount: 1 },
      });
    });

    it('never drives the reserved counter negative if called with no outstanding reservation', async () => {
      row = makeSubscription({ aiCreditsReserved: 0 });
      await service.consumeCredit('sub-1');
      expect(row!.aiCreditsReserved).toBe(0);
      expect(row!.aiCreditsConsumed).toBe(0);
      expect(prisma.aiCreditTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('releaseCredit', () => {
    it('returns one reserved credit without marking it consumed, and logs a RELEASE transaction', async () => {
      row = makeSubscription({ aiCreditsReserved: 1 });
      await service.releaseCredit('sub-1');
      expect(row!.aiCreditsReserved).toBe(0);
      expect(row!.aiCreditsConsumed).toBe(0);
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith({
        data: { subscriptionId: 'sub-1', type: 'RELEASE', amount: 1 },
      });
    });

    it('never drives the reserved counter negative if called with no outstanding reservation', async () => {
      row = makeSubscription({ aiCreditsReserved: 0 });
      await service.releaseCredit('sub-1');
      expect(row!.aiCreditsReserved).toBe(0);
    });
  });

  describe('reserve -> consume / release round trips', () => {
    it('repeated successful reserve+consume cycles consume exactly one credit each time', async () => {
      row = makeSubscription({ aiCreditsAllocated: 3 });
      for (let i = 0; i < 3; i++) {
        const subscriptionId = await service.reserveCredit('u1');
        await service.consumeCredit(subscriptionId);
      }
      expect(row!.aiCreditsConsumed).toBe(3);
      expect(row!.aiCreditsReserved).toBe(0);
      await expect(service.reserveCredit('u1')).rejects.toMatchObject({ code: 'AI_CREDITS_EXHAUSTED' });
    });

    it('a released credit becomes available again for a later request', async () => {
      row = makeSubscription({ aiCreditsAllocated: 1 });
      const subscriptionId = await service.reserveCredit('u1');
      await service.releaseCredit(subscriptionId);
      await expect(service.reserveCredit('u1')).resolves.toBe('sub-1');
      expect(row!.aiCreditsReserved).toBe(1);
      expect(row!.aiCreditsConsumed).toBe(0);
    });
  });
});

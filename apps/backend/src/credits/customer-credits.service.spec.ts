import { CustomerCreditsService } from './customer-credits.service';

interface AccountRow {
  id: string;
  userId: string;
  balance: number;
}

interface TransactionRow {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  bookingId: string | null;
  note: string | null;
  createdAt: Date;
}

interface PrismaMock {
  customerCreditAccount: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  customerCreditTransaction: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
}

describe('CustomerCreditsService', () => {
  let service: CustomerCreditsService;
  let prisma: PrismaMock;
  let account: AccountRow | null;
  let transactions: TransactionRow[];
  let nextTxId: number;

  beforeEach(() => {
    account = null;
    transactions = [];
    nextTxId = 1;

    prisma = {
      customerCreditAccount: {
        findUnique: jest.fn((args: { where: { userId: string } }) =>
          Promise.resolve(
            account && account.userId === args.where.userId ? account : null,
          ),
        ),
        findUniqueOrThrow: jest.fn((args: { where: { userId: string } }) => {
          if (!account || account.userId !== args.where.userId) {
            throw new Error('not found');
          }
          return Promise.resolve(account);
        }),
        upsert: jest.fn(
          (args: {
            where: { userId: string };
            create: { userId: string; balance: number };
            update: { balance: { increment: number } };
          }) => {
            if (!account) {
              account = {
                id: 'acct-1',
                userId: args.where.userId,
                balance: Number(args.create.balance),
              };
            } else {
              account.balance += args.update.balance.increment;
            }
            return Promise.resolve(account);
          },
        ),
        updateMany: jest.fn(
          (args: {
            where: { userId: string; balance: { gte: number } };
            data: { balance: { decrement: number } };
          }) => {
            if (!account || account.userId !== args.where.userId) {
              return Promise.resolve({ count: 0 });
            }
            if (account.balance < args.where.balance.gte) {
              return Promise.resolve({ count: 0 });
            }
            account.balance -= args.data.balance.decrement;
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      customerCreditTransaction: {
        create: jest.fn(
          (args: {
            data: {
              accountId: string;
              type: string;
              amount: number;
              bookingId?: string;
              note?: string;
            };
          }) => {
            const row: TransactionRow = {
              id: `tx-${nextTxId++}`,
              accountId: args.data.accountId,
              type: args.data.type,
              amount: args.data.amount,
              bookingId: args.data.bookingId ?? null,
              note: args.data.note ?? null,
              createdAt: new Date(),
            };
            transactions.push(row);
            return Promise.resolve(row);
          },
        ),
        findMany: jest.fn(
          (args: {
            where: { accountId: string };
            take: number;
            cursor?: { id: string };
            skip?: number;
          }) => {
            let rows = transactions
              .filter((t) => t.accountId === args.where.accountId)
              .slice()
              .reverse(); // newest first, matches orderBy: { createdAt: 'desc' }
            if (args.cursor) {
              const idx = rows.findIndex((r) => r.id === args.cursor!.id);
              rows = idx >= 0 ? rows.slice(idx + (args.skip ?? 0)) : [];
            }
            return Promise.resolve(rows.slice(0, args.take));
          },
        ),
      },
      $executeRaw: jest.fn(() => Promise.resolve(undefined)),
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };

    service = new CustomerCreditsService(prisma as never);
  });

  describe('computeEarnedCredits', () => {
    it.each([
      [50, 10],
      [100, 20],
      [150, 30],
      [500, 100],
    ])('earns exactly 20%% for an exact ₹50-slab price: ₹%d -> ₹%d', (price, expected) => {
      expect(service.computeEarnedCredits(price)).toBe(expected);
    });

    it('earns strictly less than 20% for a price that is not an exact ₹50 multiple (₹75 -> ₹10, not ₹15)', () => {
      expect(service.computeEarnedCredits(75)).toBe(10);
    });

    it('earns nothing for a price under one full ₹50 slab', () => {
      expect(service.computeEarnedCredits(49)).toBe(0);
      expect(service.computeEarnedCredits(0)).toBe(0);
    });
  });

  describe('getBalance', () => {
    it('returns 0 for a customer with no credit account yet', async () => {
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 0 });
    });

    it("returns the account's real balance once one exists", async () => {
      account = { id: 'acct-1', userId: 'u1', balance: 42 };
      await expect(service.getBalance('u1')).resolves.toEqual({
        balance: 42,
      });
    });
  });

  describe('earnForCompletedSession', () => {
    it('creates a new account on first earn, seeded with exactly the earned amount', async () => {
      const earned = await service.earnForCompletedSession(
        prisma as never,
        'u1',
        'b1',
        100,
      );
      expect(earned).toBe(20);
      expect(account).toMatchObject({ userId: 'u1', balance: 20 });
      expect(transactions).toEqual([
        expect.objectContaining({
          type: 'EARNED',
          amount: 20,
          bookingId: 'b1',
        }),
      ]);
    });

    it('increments an existing balance rather than replacing it', async () => {
      account = { id: 'acct-1', userId: 'u1', balance: 15 };
      await service.earnForCompletedSession(prisma as never, 'u1', 'b2', 150);
      expect(account!.balance).toBe(45); // 15 + 30
    });

    it('does nothing and returns 0 when the price earns zero credits (under one slab)', async () => {
      const earned = await service.earnForCompletedSession(
        prisma as never,
        'u1',
        'b1',
        10,
      );
      expect(earned).toBe(0);
      expect(account).toBeNull();
      expect(transactions).toHaveLength(0);
    });

    it('records a null bookingId for a walk-in completion with no linked booking', async () => {
      await service.earnForCompletedSession(prisma as never, 'u1', null, 50);
      expect(transactions[0].bookingId).toBeNull();
    });
  });

  describe('redeemForBooking', () => {
    beforeEach(() => {
      account = { id: 'acct-1', userId: 'u1', balance: 50 };
    });

    it('does nothing for a zero or negative amount', async () => {
      await service.redeemForBooking(prisma as never, 'u1', 'b1', 0);
      expect(account!.balance).toBe(50);
      expect(transactions).toHaveLength(0);
    });

    it('decrements the balance and logs a REDEEMED transaction on success', async () => {
      await service.redeemForBooking(prisma as never, 'u1', 'b1', 30);
      expect(account!.balance).toBe(20);
      expect(transactions).toEqual([
        expect.objectContaining({
          type: 'REDEEMED',
          amount: 30,
          bookingId: 'b1',
        }),
      ]);
    });

    it('acquires a per-customer advisory lock before checking the balance', async () => {
      await service.redeemForBooking(prisma as never, 'u1', 'b1', 10);
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('throws INSUFFICIENT_CREDITS and leaves the balance untouched when the amount exceeds the live balance', async () => {
      await expect(
        service.redeemForBooking(prisma as never, 'u1', 'b1', 51),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
      expect(account!.balance).toBe(50);
      expect(transactions).toHaveLength(0);
    });

    it('never drives the balance negative under a simulated race (second concurrent redeem sees the post-first-redeem balance)', async () => {
      await service.redeemForBooking(prisma as never, 'u1', 'b1', 30);
      await expect(
        service.redeemForBooking(prisma as never, 'u1', 'b2', 30),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
      expect(account!.balance).toBe(20);
    });
  });

  describe('restoreForCancelledBooking', () => {
    it('does nothing for a zero amount', async () => {
      await service.restoreForCancelledBooking(prisma as never, 'u1', 'b1', 0);
      expect(account).toBeNull();
    });

    it('creates the account if none exists (a customer whose only credit event was a redemption later restored)', async () => {
      await service.restoreForCancelledBooking(
        prisma as never,
        'u1',
        'b1',
        30,
      );
      expect(account).toMatchObject({ userId: 'u1', balance: 30 });
      expect(transactions).toEqual([
        expect.objectContaining({
          type: 'RESTORED',
          amount: 30,
          bookingId: 'b1',
        }),
      ]);
    });

    it('increments an existing balance', async () => {
      account = { id: 'acct-1', userId: 'u1', balance: 20 };
      await service.restoreForCancelledBooking(
        prisma as never,
        'u1',
        'b1',
        30,
      );
      expect(account!.balance).toBe(50);
    });
  });

  describe('getHistory', () => {
    it('returns an empty page for a customer with no credit account', async () => {
      await expect(service.getHistory('u1')).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('returns transactions newest-first with amount coerced to a number', async () => {
      account = { id: 'acct-1', userId: 'u1', balance: 40 };
      await service.earnForCompletedSession(prisma as never, 'u1', 'b1', 100);
      await service.redeemForBooking(prisma as never, 'u1', 'b2', 20);
      const page = await service.getHistory('u1');
      expect(page.items.map((i) => i.type)).toEqual(['REDEEMED', 'EARNED']);
      expect(page.items[0].amount).toBe(20);
      expect(page.nextCursor).toBeNull();
    });

    it('paginates with a cursor when there are more rows than the page size', async () => {
      account = { id: 'acct-1', userId: 'u1', balance: 0 };
      for (let i = 0; i < 3; i++) {
        await service.earnForCompletedSession(
          prisma as never,
          'u1',
          `b${i}`,
          50,
        );
      }
      const page = await service.getHistory('u1', undefined, 2);
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
    });
  });
});

import { Prisma } from '@prisma/client';
import { CreditFundingSource } from '@barbercue/shared';
import { CustomerCreditsService } from './customer-credits.service';

interface AccountRow {
  id: string;
  userId: string;
}

interface TransactionRow {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  remainingAmount: number | null;
  bookingId: string | null;
  campaignRef: string | null;
  fundingSource: string | null;
  expiresAt: Date | null;
  idempotencyKey: string | null;
  reason: string | null;
  note: string | null;
  createdAt: Date;
}

describe('CustomerCreditsService', () => {
  let service: CustomerCreditsService;
  let accounts: AccountRow[];
  let transactions: TransactionRow[];
  let nextId: number;
  let prisma: {
    customerCreditAccount: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    customerCreditTransaction: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    auditLog: { create: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  function findOrCreateAccount(userId: string): AccountRow {
    let account = accounts.find((a) => a.userId === userId);
    if (!account) {
      account = { id: `acct-${nextId++}`, userId };
      accounts.push(account);
    }
    return account;
  }

  function isValid(t: TransactionRow, now: Date): boolean {
    return (
      (t.remainingAmount ?? 0) > 0 &&
      (t.expiresAt === null || t.expiresAt > now)
    );
  }

  beforeEach(() => {
    accounts = [];
    transactions = [];
    nextId = 1;

    prisma = {
      customerCreditAccount: {
        findUnique: jest.fn((args: { where: { userId?: string; id?: string } }) =>
          Promise.resolve(
            accounts.find((a) =>
              args.where.userId !== undefined
                ? a.userId === args.where.userId
                : a.id === args.where.id,
            ) ?? null,
          ),
        ),
        upsert: jest.fn((args: { where: { userId: string } }) =>
          Promise.resolve(findOrCreateAccount(args.where.userId)),
        ),
      },
      customerCreditTransaction: {
        findMany: jest.fn(
          (args: {
            where: { accountId: string };
          }) => {
            const now = new Date();
            const rows = transactions
              .filter((t) => t.accountId === args.where.accountId)
              .filter((t) => isValid(t, now))
              .slice()
              .sort((a, b) => {
                const aExp = a.expiresAt?.getTime() ?? Infinity;
                const bExp = b.expiresAt?.getTime() ?? Infinity;
                if (aExp !== bExp) return aExp - bExp;
                return a.createdAt.getTime() - b.createdAt.getTime();
              });
            return Promise.resolve(rows);
          },
        ),
        findUnique: jest.fn((args: { where: { idempotencyKey: string } }) =>
          Promise.resolve(
            transactions.find(
              (t) => t.idempotencyKey === args.where.idempotencyKey,
            ) ?? null,
          ),
        ),
        aggregate: jest.fn((args: { where: { accountId: string } }) => {
          const now = new Date();
          const sum = transactions
            .filter((t) => t.accountId === args.where.accountId)
            .filter((t) => isValid(t, now))
            .reduce((s, t) => s + (t.remainingAmount ?? 0), 0);
          return Promise.resolve({ _sum: { remainingAmount: sum } });
        }),
        create: jest.fn(
          (args: {
            data: Partial<TransactionRow> & {
              accountId: string;
              type: string;
              amount: number;
            };
          }) => {
            if (
              args.data.idempotencyKey &&
              transactions.some(
                (t) => t.idempotencyKey === args.data.idempotencyKey,
              )
            ) {
              throw new Prisma.PrismaClientKnownRequestError(
                'Unique constraint failed',
                { code: 'P2002', clientVersion: '5.22.0' },
              );
            }
            const row: TransactionRow = {
              id: `tx-${nextId++}`,
              accountId: args.data.accountId,
              type: args.data.type,
              amount: args.data.amount,
              remainingAmount: args.data.remainingAmount ?? null,
              bookingId: args.data.bookingId ?? null,
              campaignRef: args.data.campaignRef ?? null,
              fundingSource: args.data.fundingSource ?? null,
              expiresAt: args.data.expiresAt ?? null,
              idempotencyKey: args.data.idempotencyKey ?? null,
              reason: args.data.reason ?? null,
              note: args.data.note ?? null,
              createdAt: new Date(),
            };
            transactions.push(row);
            return Promise.resolve(row);
          },
        ),
        update: jest.fn(
          (args: {
            where: { id: string };
            data: { remainingAmount: { decrement: number } };
          }) => {
            const row = transactions.find((t) => t.id === args.where.id);
            if (!row) throw new Error('not found');
            row.remainingAmount =
              (row.remainingAmount ?? 0) - args.data.remainingAmount.decrement;
            return Promise.resolve(row);
          },
        ),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn(() => Promise.resolve(undefined)),
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };

    service = new CustomerCreditsService(prisma as never);
  });

  describe('computeMaxRedeemable (redemption cap, NOT an earn rate)', () => {
    it.each([
      [49, 0],
      [50, 10],
      [75, 10],
      [99, 10],
      [100, 20],
      [149, 20],
      [150, 30],
      [500, 100],
      [1000, 200],
    ])('price ₹%d -> max redeemable ₹%d', (price, expected) => {
      expect(service.computeMaxRedeemable(price)).toBe(expected);
    });
  });

  describe('getBalance', () => {
    it('returns 0 for a customer with no account', async () => {
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 0 });
    });

    it('sums remainingAmount across valid lots', async () => {
      const account = findOrCreateAccount('u1');
      transactions.push(
        {
          id: 't1',
          accountId: account.id,
          type: 'PROMO_GRANT',
          amount: 50,
          remainingAmount: 50,
          bookingId: null,
          campaignRef: null,
          fundingSource: 'FASTQUE_FUNDED',
          expiresAt: null,
          idempotencyKey: null,
          reason: 'welcome',
          note: null,
          createdAt: new Date(),
        },
        {
          id: 't2',
          accountId: account.id,
          type: 'PROMO_GRANT',
          amount: 20,
          remainingAmount: 20,
          bookingId: null,
          campaignRef: null,
          fundingSource: 'FASTQUE_FUNDED',
          expiresAt: null,
          idempotencyKey: null,
          reason: 'bonus',
          note: null,
          createdAt: new Date(),
        },
      );
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 70 });
    });

    it('excludes an expired lot from the balance', async () => {
      const account = findOrCreateAccount('u1');
      transactions.push({
        id: 't1',
        accountId: account.id,
        type: 'PROMO_GRANT',
        amount: 50,
        remainingAmount: 50,
        bookingId: null,
        campaignRef: null,
        fundingSource: 'FASTQUE_FUNDED',
        expiresAt: new Date(Date.now() - 1000),
        idempotencyKey: null,
        reason: null,
        note: null,
        createdAt: new Date(),
      });
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 0 });
    });

    it('excludes a fully-consumed lot (remainingAmount 0)', async () => {
      const account = findOrCreateAccount('u1');
      transactions.push({
        id: 't1',
        accountId: account.id,
        type: 'PROMO_GRANT',
        amount: 50,
        remainingAmount: 0,
        bookingId: null,
        campaignRef: null,
        fundingSource: 'FASTQUE_FUNDED',
        expiresAt: null,
        idempotencyKey: null,
        reason: null,
        note: null,
        createdAt: new Date(),
      });
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 0 });
    });
  });

  describe('redeemUpTo — actualCreditsUsed = min(requested, available, maxCreditsAllowed)', () => {
    function grantLot(
      userId: string,
      amount: number,
      overrides: Partial<TransactionRow> = {},
    ) {
      const account = findOrCreateAccount(userId);
      const row: TransactionRow = {
        id: `lot-${nextId++}`,
        accountId: account.id,
        type: 'PROMO_GRANT',
        amount,
        remainingAmount: amount,
        bookingId: null,
        campaignRef: null,
        fundingSource: 'FASTQUE_FUNDED',
        expiresAt: null,
        idempotencyKey: null,
        reason: null,
        note: null,
        createdAt: new Date(),
        ...overrides,
      };
      transactions.push(row);
      return row;
    }

    it('service ₹500, balance ₹30 -> redeems 30, not the full 100 cap', async () => {
      grantLot('u1', 30);
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        30,
        service.computeMaxRedeemable(500),
      );
      expect(result.actualUsed).toBe(30);
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 0 });
    });

    // Part 11 (FastQue Credits regression audit, test-matrix item L): balance already had a direct
    // expired-lot-exclusion test, but redemption itself — which shares the same validLots query —
    // did not have its own. An expired lot must never be consumed even when it's the only lot.
    it('an expired lot is unavailable for redemption even though it is the only lot on the account', async () => {
      grantLot('u1', 30, { expiresAt: new Date(Date.now() - 1000) });
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        30,
        service.computeMaxRedeemable(500),
      );
      expect(result.actualUsed).toBe(0);
      expect(result.fastQueFundedConsumed).toBe(0);
      // The expired lot's own remainingAmount must be untouched — no phantom partial consumption.
      expect(transactions.find((t) => t.type === 'PROMO_GRANT')?.remainingAmount).toBe(30);
    });

    it('service ₹500, balance ₹500 -> redeems only the 100 price-based cap, not the full balance', async () => {
      grantLot('u1', 500);
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        500,
        service.computeMaxRedeemable(500),
      );
      expect(result.actualUsed).toBe(100);
      await expect(service.getBalance('u1')).resolves.toEqual({
        balance: 400,
      });
    });

    it('service ₹100, balance ≥20 -> redeems exactly 20 (the price cap), pay 80 implied', async () => {
      grantLot('u1', 100);
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        100,
        service.computeMaxRedeemable(100),
      );
      expect(result.actualUsed).toBe(20);
    });

    it('service ₹75, wallet large -> redeems only 10, never 15 (20% of 75)', async () => {
      grantLot('u1', 1000);
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        1000,
        service.computeMaxRedeemable(75),
      );
      expect(result.actualUsed).toBe(10);
    });

    it('never rejects for exceeding balance — clamps to 0 when the customer has nothing', async () => {
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        50,
        service.computeMaxRedeemable(500),
      );
      expect(result.actualUsed).toBe(0);
    });

    it('draws from the soonest-expiring lot first', async () => {
      const soon = grantLot('u1', 10, {
        expiresAt: new Date(Date.now() + 60_000),
      });
      grantLot('u1', 10, { expiresAt: null });
      await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        10,
        service.computeMaxRedeemable(500),
      );
      const refreshedSoon = transactions.find((t) => t.id === soon.id)!;
      expect(refreshedSoon.remainingAmount).toBe(0);
    });

    it('splits a redemption across multiple lots when one alone is not enough', async () => {
      grantLot('u1', 5, { expiresAt: new Date(Date.now() + 60_000) });
      grantLot('u1', 20);
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        15,
        service.computeMaxRedeemable(500),
      );
      expect(result.actualUsed).toBe(15);
      await expect(service.getBalance('u1')).resolves.toEqual({
        balance: 10,
      });
    });

    it('reports fastQueFundedConsumed for FASTQUE_FUNDED lots, for subsidy accounting', async () => {
      grantLot('u1', 30, { fundingSource: CreditFundingSource.FASTQUE_FUNDED });
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        30,
        service.computeMaxRedeemable(500),
      );
      expect(result.fastQueFundedConsumed).toBe(30);
    });

    it('does NOT count a SHOP_FUNDED lot toward fastQueFundedConsumed (no subsidy liability for shop-funded credit)', async () => {
      grantLot('u1', 30, { fundingSource: CreditFundingSource.SHOP_FUNDED });
      const result = await service.redeemUpTo(
        prisma as never,
        'u1',
        'b1',
        30,
        service.computeMaxRedeemable(500),
      );
      expect(result.actualUsed).toBe(30);
      expect(result.fastQueFundedConsumed).toBe(0);
    });

    it('two concurrent redemptions against a shared balance never double-spend or go negative', async () => {
      grantLot('u1', 30);
      const cap = service.computeMaxRedeemable(500);
      const [a, b] = await Promise.all([
        service.redeemUpTo(prisma as never, 'u1', 'b1', 30, cap),
        service.redeemUpTo(prisma as never, 'u1', 'b2', 30, cap),
      ]);
      expect(a.actualUsed + b.actualUsed).toBe(30);
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 0 });
    });
  });

  describe('restoreForCancelledBooking', () => {
    it('mints a brand-new, never-expiring lot for exactly the restored amount', async () => {
      await service.restoreForCancelledBooking(prisma as never, 'u1', 'b1', 30);
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 30 });
      const restored = transactions.find((t) => t.type === 'RESTORED')!;
      expect(restored.expiresAt).toBeNull();
      expect(restored.remainingAmount).toBe(30);
    });

    it('does nothing for a zero amount', async () => {
      await service.restoreForCancelledBooking(prisma as never, 'u1', 'b1', 0);
      expect(transactions).toHaveLength(0);
    });

    it('a restored lot remains redeemable even if the original grant has since expired', async () => {
      // Simulates: redeem from an expiring grant, the grant later expires, the booking is
      // cancelled — the customer must still get their money back, spendable.
      const grantAccount = findOrCreateAccount('u1');
      transactions.push({
        id: 'expired-lot',
        accountId: grantAccount.id,
        type: 'PROMO_GRANT',
        amount: 30,
        remainingAmount: 0, // fully consumed by the (now-cancelled) redemption
        bookingId: null,
        campaignRef: null,
        fundingSource: 'FASTQUE_FUNDED',
        expiresAt: new Date(Date.now() - 1000), // expired since
        idempotencyKey: null,
        reason: null,
        note: null,
        createdAt: new Date(Date.now() - 100_000),
      });
      await service.restoreForCancelledBooking(prisma as never, 'u1', 'b1', 30);
      await expect(service.getBalance('u1')).resolves.toEqual({ balance: 30 });
    });
  });

  describe('grantPromotionalCredits — the only way new credit enters a wallet', () => {
    const input = {
      customerId: 'u1',
      amount: 100,
      reason: 'Launch promo',
      fundingSource: CreditFundingSource.FASTQUE_FUNDED,
    };

    it('creates a PROMO_GRANT lot with the full requested amount as remainingAmount', async () => {
      const result = await service.grantPromotionalCredits(
        'admin-1',
        'idem-1',
        input,
      );
      expect(result.type).toBe('PROMO_GRANT');
      expect(result.amount).toBe(100);
      expect(result.remainingAmount).toBe(100);
      await expect(service.getBalance('u1')).resolves.toEqual({
        balance: 100,
      });
    });

    it('throws CUSTOMER_NOT_FOUND for a nonexistent customerId, writing nothing', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.grantPromotionalCredits('admin-1', 'idem-1', input),
      ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
      expect(transactions).toHaveLength(0);
    });

    it('writes an AuditLog row for every grant', async () => {
      await service.grantPromotionalCredits('admin-1', 'idem-1', input);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: 'admin-1',
            action: 'CREDIT_GRANTED',
          }),
        }),
      );
    });

    it('replays the same result for a retried request with an identical idempotency key and identical params', async () => {
      const first = await service.grantPromotionalCredits(
        'admin-1',
        'idem-1',
        input,
      );
      const second = await service.grantPromotionalCredits(
        'admin-1',
        'idem-1',
        input,
      );
      expect(second.id).toBe(first.id);
      // Never a second grant — balance reflects only the one lot.
      await expect(service.getBalance('u1')).resolves.toEqual({
        balance: 100,
      });
    });

    it('rejects a reused idempotency key with different parameters as GRANT_IDEMPOTENCY_KEY_REUSED', async () => {
      await service.grantPromotionalCredits('admin-1', 'idem-1', input);
      await expect(
        service.grantPromotionalCredits('admin-1', 'idem-1', {
          ...input,
          amount: 999,
        }),
      ).rejects.toMatchObject({ code: 'GRANT_IDEMPOTENCY_KEY_REUSED' });
    });

    // Part 11 (FastQue Credits regression audit): the DB-level idempotency backstop (reached once
    // the generic @Idempotent() interceptor's own request-hash cache has expired/been bypassed —
    // see this method's own doc comment) used to compare only type/amount/reason, so a retried
    // request reusing the same key with the SAME amount/reason but a DIFFERENT campaignRef,
    // fundingSource, or expiresAt would have been silently treated as a valid replay of the
    // original grant instead of a genuine conflict. Each of these must independently reject.
    it.each([
      ['campaignRef', { campaignRef: 'DIFFERENT_CAMPAIGN' }],
      ['fundingSource', { fundingSource: CreditFundingSource.SHOP_FUNDED }],
      ['expiresAt', { expiresAt: new Date(Date.now() + 86_400_000).toISOString() }],
    ])(
      'rejects a reused idempotency key with the same amount/reason but a different %s as GRANT_IDEMPOTENCY_KEY_REUSED',
      async (_field, overrides) => {
        await service.grantPromotionalCredits('admin-1', 'idem-1', input);
        await expect(
          service.grantPromotionalCredits('admin-1', 'idem-1', {
            ...input,
            ...overrides,
          }),
        ).rejects.toMatchObject({ code: 'GRANT_IDEMPOTENCY_KEY_REUSED' });
        // Still exactly one lot — the mismatched retry must not have minted a second grant either.
        await expect(service.getBalance('u1')).resolves.toEqual({ balance: 100 });
      },
    );
  });
});

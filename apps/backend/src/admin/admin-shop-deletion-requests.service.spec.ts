import { Role, UserStatus } from '@barbercue/shared';
import { SalonStatus, ShopDeletionRequestStatus } from '@prisma/client';
import { AdminShopDeletionRequestsService } from './admin-shop-deletion-requests.service';

describe('recoverable shop deletion decisions', () => {
  const salonId = 'salon-1';
  const requester = 'cofounder-1';
  const approver = 'super-admin-1';

  function build() {
    const request = {
      id: 'request-1',
      salonId,
      shopName: 'Junk Shop',
      shopPublicId: 'BC-SHOP-000099',
      requestedByUserId: requester,
      reason: 'Duplicate test listing',
      status: ShopDeletionRequestStatus.PENDING,
      requestedAt: new Date('2026-10-01T00:00:00.000Z'),
      decidedAt: null,
      decidedByUserId: null,
      decisionNote: null,
    };
    const admin = {
      id: approver,
      status: UserStatus.ACTIVE,
      roles: [{ role: Role.PLATFORM_ADMIN, salonId: null }],
      twoFactorEnabled: true,
      totpSecret: 'encrypted',
    };
    const coFounder = {
      id: requester,
      status: UserStatus.ACTIVE,
      roles: [{ role: Role.CO_FOUNDER, salonId: null }],
      twoFactorEnabled: false,
      totpSecret: null,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: salonId }]),
      user: {
        findUnique: jest.fn(async (args: { where: { id: string } }) =>
          args.where.id === approver ? admin : coFounder,
        ),
      },
      salon: {
        findUnique: jest.fn().mockResolvedValue({
          name: request.shopName,
          publicId: request.shopPublicId,
          softDeletedAt: null,
        }),
        update: jest
          .fn()
          .mockResolvedValue({
            id: salonId,
            name: request.shopName,
            status: SalonStatus.PENDING,
          }),
      },
      shopDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(request),
        create: jest.fn().mockResolvedValue(request),
        update: jest
          .fn()
          .mockImplementation(({ data }) => ({ ...request, ...data })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      shopDeletionRequest: { findMany: jest.fn().mockResolvedValue([]) },
      salon: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };
    const shops = {
      quarantineSalonInTransaction: jest.fn().mockResolvedValue({
        quarantined: true,
        restoreEligibleUntil: new Date('2026-10-31T00:00:00.000Z'),
        previousStatus: SalonStatus.ACTIVE,
        shopName: request.shopName,
        shopPublicId: request.shopPublicId,
      }),
    };
    const crypto = { decrypt: jest.fn().mockReturnValue('secret') };
    const totp = { verifyToken: jest.fn().mockResolvedValue(true) };
    const activation = {
      assertReadyToOpen: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AdminShopDeletionRequestsService(
      prisma as never,
      shops as never,
      crypto as never,
      totp as never,
      activation as never,
    );
    return {
      service,
      tx,
      prisma,
      shops,
      crypto,
      totp,
      activation,
      request,
      admin,
    };
  }

  it('creates an attributed request and leaves the salon untouched', async () => {
    const { service, tx, shops } = build();
    const result = await service.request(
      requester,
      salonId,
      'Duplicate test listing',
    );
    expect(result.status).toBe(ShopDeletionRequestStatus.PENDING);
    expect(tx.shopDeletionRequest.create).toHaveBeenCalledWith({
      data: {
        salonId,
        shopName: 'Junk Shop',
        shopPublicId: 'BC-SHOP-000099',
        requestedByUserId: requester,
        reason: 'Duplicate test listing',
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: requester,
          action: 'SHOP_DELETE_REQUESTED',
        }),
      }),
    );
    expect(shops.quarantineSalonInTransaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate pending requests before creating or auditing another request', async () => {
    const { service, tx, request } = build();
    tx.shopDeletionRequest.findFirst.mockResolvedValue({ id: request.id });
    await expect(
      service.request(requester, salonId, 'Another deletion request'),
    ).rejects.toMatchObject({
      code: 'SHOP_DELETE_ALREADY_REQUESTED',
    });
    expect(tx.shopDeletionRequest.create).not.toHaveBeenCalled();
  });

  it('requires a current global Co-Founder grant before requesting', async () => {
    const { service, tx } = build();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.request(requester, salonId, 'Duplicate test listing'),
    ).rejects.toMatchObject({
      code: 'CO_FOUNDER_REQUIRED',
    });
    expect(tx.shopDeletionRequest.create).not.toHaveBeenCalled();
  });

  it('requires a fresh TOTP for approval and validates it after actor row locking', async () => {
    const { service, tx, totp, shops } = build();
    totp.verifyToken.mockResolvedValue(false);
    await expect(
      service.approve(approver, 'request-1', '000000'),
    ).rejects.toMatchObject({
      code: 'TOTP_INVALID',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(shops.quarantineSalonInTransaction).not.toHaveBeenCalled();
  });

  it('moves the shop to recoverable quarantine and audits without recording request text', async () => {
    const { service, tx, shops } = build();
    const result = await service.approve(
      approver,
      'request-1',
      '123456',
      'Reviewed duplicate',
    );
    expect(shops.quarantineSalonInTransaction).toHaveBeenCalledWith(
      tx,
      approver,
      salonId,
      'request-1',
    );
    expect(result).toMatchObject({
      shopName: 'Junk Shop',
      restoreEligibleUntil: '2026-10-31T00:00:00.000Z',
    });
    expect(tx.shopDeletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-1' },
        data: expect.objectContaining({
          status: ShopDeletionRequestStatus.APPROVED,
          decidedByUserId: approver,
        }),
      }),
    );
    const auditCalls = tx.auditLog.create.mock.calls.map(([call]) => call.data);
    expect(auditCalls.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['SHOP_DELETE_APPROVED']),
    );
    expect(JSON.stringify(auditCalls)).not.toContain('Duplicate test listing');
    expect(JSON.stringify(auditCalls)).not.toContain('Reviewed duplicate');
  });

  it('persists a denial audit while returning a safe conflict when obligations remain', async () => {
    const { service, tx, shops } = build();
    shops.quarantineSalonInTransaction.mockResolvedValue({
      quarantined: false,
      code: 'SHOP_HAS_OPEN_OBLIGATIONS',
      message: 'Resolve current bookings first.',
      blockers: ['PENDING_OR_CONFIRMED_BOOKING'],
    });
    await expect(
      service.approve(approver, 'request-1', '123456'),
    ).rejects.toMatchObject({
      code: 'SHOP_HAS_OPEN_OBLIGATIONS',
      details: { blockers: ['PENDING_OR_CONFIRMED_BOOKING'] },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'SHOP_DELETE_DENIED' }),
      }),
    );
    expect(tx.shopDeletionRequest.update).not.toHaveBeenCalled();
  });

  it('requires a fresh TOTP for rejection and uses the same actor → request → salon lock order', async () => {
    const { service, tx } = build();
    const result = await service.reject(
      approver,
      'request-1',
      '123456',
      'Request is not justified',
    );
    expect(result.status).toBe(ShopDeletionRequestStatus.REJECTED);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    const sql = tx.$queryRaw.mock.calls.map(([statement]) =>
      statement.join(' ').replace(/\s+/g, ' '),
    );
    expect(sql[0]).toContain('FOR UPDATE OF u, r');
    expect(sql[1]).toContain('shop_deletion_requests');
    expect(sql[2]).toContain('salons');
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SHOP_DELETE_REJECTED',
          actorUserId: approver,
        }),
      }),
    );
  });

  it('does not permit restore at the exact 30-day expiry and records the expired attempt', async () => {
    const { service, tx, prisma } = build();
    const expiredAt = new Date();
    tx.salon.findUnique.mockResolvedValueOnce({
      softDeletionRequestId: 'request-1',
    });
    tx.salon.findUnique.mockResolvedValueOnce({
      id: salonId,
      name: 'Junk Shop',
      publicId: 'BC-SHOP-000099',
      status: SalonStatus.SUSPENDED,
      softDeletedAt: new Date(expiredAt.getTime() - 30 * 86_400_000),
      restoreEligibleUntil: expiredAt,
      softDeletedByUserId: approver,
      softDeletionRequestId: 'request-1',
      statusBeforeSoftDelete: SalonStatus.ACTIVE,
      verification: { status: 'APPROVED' },
    });
    jest.useFakeTimers().setSystemTime(expiredAt);
    try {
      await expect(
        service.restore(approver, salonId, '123456'),
      ).rejects.toMatchObject({
        code: 'RESTORE_WINDOW_EXPIRED',
      });
    } finally {
      jest.useRealTimers();
    }
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SHOP_DELETE_RESTORE_EXPIRED',
        }),
      }),
    );
    expect(tx.salon.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('audits a restore attempt for a salon that is not in recovery trash', async () => {
    const { service, tx } = build();
    await expect(
      service.restore(approver, salonId, '123456'),
    ).rejects.toMatchObject({
      code: 'SHOP_NOT_IN_TRASH',
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: approver,
          action: 'SHOP_DELETE_RESTORE_DENIED',
          entityType: 'Salon',
          entityId: salonId,
          metadata: { reasonCode: 'SHOP_NOT_IN_TRASH' },
        }),
      }),
    );
  });

  it('restores only inside the window and leaves previously suspended shops suspended', async () => {
    const { service, tx, activation } = build();
    const until = new Date(Date.now() + 1000);
    tx.salon.findUnique.mockResolvedValueOnce({
      softDeletionRequestId: 'request-1',
    });
    tx.salon.findUnique.mockResolvedValueOnce({
      id: salonId,
      name: 'Junk Shop',
      publicId: 'BC-SHOP-000099',
      status: SalonStatus.SUSPENDED,
      softDeletedAt: new Date(),
      restoreEligibleUntil: until,
      softDeletedByUserId: approver,
      softDeletionRequestId: 'request-1',
      statusBeforeSoftDelete: SalonStatus.SUSPENDED,
      verification: { status: 'APPROVED' },
    });
    await service.restore(approver, salonId, '123456');
    expect(tx.salon.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: salonId },
        data: expect.objectContaining({
          softDeletedAt: null,
          softDeletionRequestId: null,
          status: SalonStatus.SUSPENDED,
        }),
      }),
    );
    expect(activation.assertReadyToOpen).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'SHOP_DELETE_RESTORED' }),
      }),
    );
  });

  it('restores a formerly active but unverified shop as PENDING, never ACTIVE', async () => {
    const { service, tx, activation } = build();
    tx.salon.findUnique.mockResolvedValueOnce({
      softDeletionRequestId: 'request-1',
    });
    tx.salon.findUnique.mockResolvedValueOnce({
      id: salonId,
      name: 'Junk Shop',
      publicId: 'BC-SHOP-000099',
      status: SalonStatus.SUSPENDED,
      softDeletedAt: new Date(),
      restoreEligibleUntil: new Date(Date.now() + 1000),
      softDeletedByUserId: approver,
      softDeletionRequestId: 'request-1',
      statusBeforeSoftDelete: SalonStatus.ACTIVE,
      verification: { status: 'SUBMITTED' },
    });
    await service.restore(approver, salonId, '123456');
    expect(tx.salon.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SalonStatus.PENDING }),
      }),
    );
    expect(activation.assertReadyToOpen).not.toHaveBeenCalled();
  });
});

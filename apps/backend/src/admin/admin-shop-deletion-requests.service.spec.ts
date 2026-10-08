import { Role, UserStatus } from '@barbercue/shared';
import { ShopDeletionRequestStatus } from '@prisma/client';
import { AdminShopDeletionRequestsService } from './admin-shop-deletion-requests.service';

describe('Shop deletion requests / Super Admin approval', () => {
  const salonId = 'salon-1';
  const requester = 'cofounder-1';
  const approver = 'super-admin-1';

  function build() {
    const requested = {
      id: 'request-1',
      salonId,
      shopName: 'Junk Shop',
      shopPublicId: 'BC-SHOP-000099',
      requestedByUserId: requester,
      reason: 'Duplicate test listing',
      status: ShopDeletionRequestStatus.PENDING,
      requestedAt: new Date(),
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
      roles: [{ role: Role.CO_FOUNDER, salonId: null }] as Array<{
        role: Role;
        salonId: string | null;
      }>,
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
          name: requested.shopName,
          publicId: requested.shopPublicId,
          _count: {
            staff: 0,
            bookings: 0,
            queueEntries: 0,
            reviews: 0,
            ledgerEntries: 0,
          },
        }),
      },
      shopDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(requested),
        create: jest.fn().mockResolvedValue(requested),
        update: jest.fn().mockResolvedValue({
          ...requested,
          status: ShopDeletionRequestStatus.APPROVED,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(admin) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const shops = {
      deleteSalonInTransaction: jest.fn().mockResolvedValue({ deleted: true }),
    };
    const crypto = { decrypt: jest.fn().mockReturnValue('secret') };
    const totp = { verifyToken: jest.fn().mockResolvedValue(true) };
    const service = new AdminShopDeletionRequestsService(
      prisma as never,
      shops as never,
      crypto as never,
      totp as never,
    );
    return { service, tx, prisma, shops, crypto, totp, requested, admin };
  }

  it('Co-Founder request does not delete or mutate the salon', async () => {
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
    expect(shops.deleteSalonInTransaction).not.toHaveBeenCalled();
  });

  it('denies duplicate pending requests without a second record', async () => {
    const { service, tx, requested } = build();
    tx.shopDeletionRequest.findFirst.mockResolvedValue(requested);
    await expect(
      service.request(requester, salonId, 'Another request'),
    ).rejects.toMatchObject({ code: 'SHOP_DELETE_ALREADY_REQUESTED' });
    expect(tx.shopDeletionRequest.create).not.toHaveBeenCalled();
  });

  it('accepts a review request for an active shop but does not delete it', async () => {
    const { service, tx, shops } = build();
    tx.salon.findUnique.mockResolvedValue({
      name: 'Active Shop',
      publicId: 'BC-SHOP-000099',
      _count: {
        staff: 1,
        bookings: 4,
        queueEntries: 2,
        reviews: 1,
        ledgerEntries: 1,
      },
    });
    await expect(
      service.request(requester, salonId, 'Please review this listing'),
    ).resolves.toMatchObject({ status: ShopDeletionRequestStatus.PENDING });
    expect(tx.shopDeletionRequest.create).toHaveBeenCalledTimes(1);
    expect(shops.deleteSalonInTransaction).not.toHaveBeenCalled();
  });

  it('approval failure on an active shop rolls back and leaves request pending', async () => {
    const { service, tx, shops } = build();
    shops.deleteSalonInTransaction.mockRejectedValue(
      Object.assign(new Error('Active shop'), { code: 'SALON_HAS_ACTIVITY' }),
    );
    await expect(
      service.approve(approver, 'request-1', '123456'),
    ).rejects.toMatchObject({ code: 'SALON_HAS_ACTIVITY' });
    expect(tx.shopDeletionRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects non-Co-Founder requesters, checking current DB scope', async () => {
    const { service, tx } = build();
    tx.user.findUnique.mockResolvedValue({
      id: requester,
      status: UserStatus.ACTIVE,
      roles: [{ role: Role.CO_FOUNDER, salonId: 'not-global' }],
    });
    await expect(
      service.request(requester, salonId, 'Duplicate test listing'),
    ).rejects.toMatchObject({ code: 'CO_FOUNDER_REQUIRED' });
    expect(tx.shopDeletionRequest.create).not.toHaveBeenCalled();
  });

  it('does not allow any approval without a fresh valid Super Admin TOTP', async () => {
    const { service, totp, prisma, shops } = build();
    totp.verifyToken.mockResolvedValue(false);
    await expect(
      service.approve(approver, 'request-1', '000000'),
    ).rejects.toMatchObject({ code: 'TOTP_INVALID' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(shops.deleteSalonInTransaction).not.toHaveBeenCalled();
  });

  it('approves only pending requests and executes deletion inside one audited transaction', async () => {
    const { service, tx, shops } = build();
    const result = await service.approve(
      approver,
      'request-1',
      '123456',
      'Confirmed duplicate',
    );
    expect(shops.deleteSalonInTransaction).toHaveBeenCalledWith(
      tx,
      approver,
      salonId,
    );
    const authorizationLock = tx.$queryRaw.mock.calls[0][0]
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(authorizationLock).toContain('FOR UPDATE OF u, r');
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(approver);
    expect(tx.shopDeletionRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: ShopDeletionRequestStatus.APPROVED,
        decidedByUserId: approver,
        decidedAt: expect.any(Date),
        decisionNote: 'Confirmed duplicate',
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SHOP_DELETE_APPROVED',
          actorUserId: approver,
          entityId: salonId,
        }),
      }),
    );
    expect(result.status).toBe(ShopDeletionRequestStatus.APPROVED);
  });

  it('denies approval if the global Super Admin grant is absent at transaction authorization', async () => {
    const { service, tx, shops } = build();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.approve(approver, 'request-1', '123456'),
    ).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' });
    expect(shops.deleteSalonInTransaction).not.toHaveBeenCalled();
    expect(tx.shopDeletionRequest.update).not.toHaveBeenCalled();
  });

  it('rejects replay/double approval without executing deletion', async () => {
    const { service, tx, requested, shops } = build();
    tx.shopDeletionRequest.findUnique.mockResolvedValue({
      ...requested,
      status: ShopDeletionRequestStatus.APPROVED,
    });
    await expect(
      service.approve(approver, 'request-1', '123456'),
    ).rejects.toMatchObject({ code: 'DELETE_REQUEST_CLOSED' });
    expect(shops.deleteSalonInTransaction).not.toHaveBeenCalled();
  });

  it('does not allow the requesting account to approve its own request', async () => {
    const { service, tx, requested, prisma, shops } = build();
    tx.shopDeletionRequest.findUnique.mockResolvedValue({
      ...requested,
      requestedByUserId: approver,
    });
    await expect(
      service.approve(approver, 'request-1', '123456'),
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(shops.deleteSalonInTransaction).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects without any deletion and records a reason', async () => {
    const { service, tx, shops } = build();
    tx.user.findUnique.mockResolvedValue({
      id: approver,
      status: UserStatus.ACTIVE,
      roles: [{ role: Role.PLATFORM_ADMIN, salonId: null }],
    });
    tx.shopDeletionRequest.update.mockResolvedValue({
      status: ShopDeletionRequestStatus.REJECTED,
    });
    const result = await service.reject(
      approver,
      'request-1',
      'This shop is legitimate',
    );
    expect(result.status).toBe(ShopDeletionRequestStatus.REJECTED);
    expect(shops.deleteSalonInTransaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SHOP_DELETE_REJECTED',
          actorUserId: approver,
        }),
      }),
    );
  });
});

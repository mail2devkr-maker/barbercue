import { Prisma, SalonStatus } from '@prisma/client';
import { AdminSalonManagementService } from './admin-salon-management.service';

describe('AdminSalonManagementService recoverable quarantine', () => {
  const salonId = 'salon-1';
  const requestId = 'request-1';

  function build() {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: salonId }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      salon: {
        findUnique: jest.fn().mockResolvedValue({
          id: salonId,
          name: 'Test Shop',
          publicId: 'BC-SHOP-000099',
          status: SalonStatus.ACTIVE,
          softDeletedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      booking: { findFirst: jest.fn().mockResolvedValue(null) },
      queueEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      serviceSession: { findFirst: jest.fn().mockResolvedValue(null) },
      manualChairOccupancy: { findFirst: jest.fn().mockResolvedValue(null) },
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
      refund: { findFirst: jest.fn().mockResolvedValue(null) },
      customerLedgerEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      platformShopSubsidyEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn() };
    return {
      service: new AdminSalonManagementService(prisma as never),
      tx,
      prisma,
    };
  }

  it('permanently disables the legacy direct delete route without opening a transaction', async () => {
    const { service, prisma } = build();
    await expect(service.deleteSalon('admin-1', salonId)).rejects.toMatchObject(
      {
        code: 'SHOP_DELETE_USE_RECOVERY_FLOW',
        status: 409,
      },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('quarantines an eligible shop in place and preserves the prior status and request link', async () => {
    const { service, tx } = build();
    const now = new Date('2026-10-08T00:00:00.000Z');
    const result = await service.quarantineSalonInTransaction(
      tx as unknown as Prisma.TransactionClient,
      'admin-1',
      salonId,
      requestId,
      now,
    );
    expect(result).toMatchObject({
      quarantined: true,
      previousStatus: SalonStatus.ACTIVE,
      restoreEligibleUntil: new Date('2026-11-07T00:00:00.000Z'),
    });
    expect(tx.salon.update).toHaveBeenCalledWith({
      where: { id: salonId },
      data: {
        softDeletedAt: now,
        restoreEligibleUntil: new Date('2026-11-07T00:00:00.000Z'),
        softDeletedByUserId: 'admin-1',
        softDeletionRequestId: requestId,
        statusBeforeSoftDelete: SalonStatus.ACTIVE,
        status: SalonStatus.SUSPENDED,
      },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0][0].join(' ')).toContain(
      'SET CONSTRAINTS salons_quarantine_obligations_guard IMMEDIATE',
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'SHOP_SOFT_DELETED',
          metadata: expect.objectContaining({
            previousStatus: SalonStatus.ACTIVE,
            newStatus: SalonStatus.SUSPENDED,
          }),
        }),
      }),
    );
  });

  it('surfaces a deferred database obligation rejection before recording approval success', async () => {
    const { service, tx } = build();
    tx.$executeRaw.mockRejectedValue(new Error('SHOP_HAS_OPEN_OBLIGATIONS'));

    await expect(
      service.quarantineSalonInTransaction(
        tx as unknown as Prisma.TransactionClient,
        'admin-1',
        salonId,
        requestId,
      ),
    ).rejects.toThrow('SHOP_HAS_OPEN_OBLIGATIONS');

    expect(tx.salon.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['pending or confirmed booking', 'booking', 'PENDING_OR_CONFIRMED_BOOKING'],
    ['active queue entry', 'queueEntry', 'ACTIVE_QUEUE_ENTRY'],
    ['active session', 'serviceSession', 'ACTIVE_SERVICE_SESSION'],
    [
      'manual occupancy',
      'manualChairOccupancy',
      'ACTIVE_MANUAL_CHAIR_OCCUPANCY',
    ],
    ['pending payment', 'payment', 'PENDING_PAYMENT'],
    ['pending refund', 'refund', 'PENDING_REFUND'],
    [
      'outstanding customer ledger',
      'customerLedgerEntry',
      'OUTSTANDING_CUSTOMER_LEDGER',
    ],
    [
      'outstanding platform subsidy',
      'platformShopSubsidyEntry',
      'OUTSTANDING_PLATFORM_SUBSIDY',
    ],
  ])(
    'does not quarantine a shop with a %s',
    async (_label, modelName, code) => {
      const { service, tx } = build();
      (
        tx[modelName as keyof typeof tx] as { findFirst: jest.Mock }
      ).findFirst.mockResolvedValue({ id: 'open-row' });
      const result = await service.quarantineSalonInTransaction(
        tx as unknown as Prisma.TransactionClient,
        'admin-1',
        salonId,
        requestId,
      );
      expect(result).toMatchObject({
        quarantined: false,
        code: 'SHOP_HAS_OPEN_OBLIGATIONS',
        blockers: [code],
      });
      expect(tx.salon.update).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('fails closed if another request already quarantined the shop', async () => {
    const { service, tx } = build();
    tx.salon.findUnique.mockResolvedValue({
      id: salonId,
      name: 'Test Shop',
      publicId: 'BC-SHOP-000099',
      status: SalonStatus.SUSPENDED,
      softDeletedAt: new Date(),
    });
    const result = await service.quarantineSalonInTransaction(
      tx as unknown as Prisma.TransactionClient,
      'admin-1',
      salonId,
      requestId,
    );
    expect(result).toMatchObject({
      quarantined: false,
      code: 'SHOP_ALREADY_QUARANTINED',
    });
    expect(tx.salon.update).not.toHaveBeenCalled();
  });
});

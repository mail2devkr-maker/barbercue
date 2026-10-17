import { Prisma } from '@prisma/client';
import { InventoryMovementKind } from '@barbercue/shared';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

describe('InventoryService movement safety', () => {
  const actorId = '11111111-1111-4111-8111-111111111111';
  const salonId = '22222222-2222-4222-8222-222222222222';
  const productId = '33333333-3333-4333-8333-333333333333';
  let service: InventoryService;
  let prisma: {
    $transaction: jest.Mock;
    inventoryMovement: { findUnique: jest.Mock };
  };
  let tx: {
    $queryRaw: jest.Mock;
    inventoryMovement: {
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let access: { assertOwnerOrAdminAccess: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { id: productId, stockOnHand: new Prisma.Decimal('5.000') },
        ]),
      inventoryMovement: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: '44444444-4444-4444-8444-444444444444',
          salonId,
          productId,
          supplierId: null,
          actorUserId: actorId,
          kind: 'CONSUMPTION',
          quantityDelta: new Prisma.Decimal('-2.000'),
          unitCost: null,
          stockAfter: new Prisma.Decimal('3.000'),
          averageUnitCostAfter: new Prisma.Decimal('10.00'),
          reason: null,
          reference: null,
          recordedAt: new Date('2026-10-17T10:00:00.000Z'),
          product: { id: productId, name: 'Shampoo', sku: 'SH-1' },
          supplier: null,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
      inventoryMovement: { findUnique: jest.fn() },
    };
    access = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
    service = new InventoryService(
      prisma as unknown as PrismaService,
      access as unknown as SalonAccessService,
    );
  });

  it('checks salon ownership before opening a stock transaction', async () => {
    access.assertOwnerOrAdminAccess.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(
      service.createMovement(actorId, salonId, productId, 'idempotency-1', {
        kind: InventoryMovementKind.CONSUMPTION,
        quantity: 2,
      }),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents an oversell before writing movement or audit records', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: productId, stockOnHand: new Prisma.Decimal('1.000') },
    ]);
    await expect(
      service.createMovement(actorId, salonId, productId, 'idempotency-2', {
        kind: InventoryMovementKind.CONSUMPTION,
        quantity: 2,
      }),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT_STOCK' });
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('records a signed, salon-scoped, idempotent movement and audits it in the same transaction', async () => {
    const result = await service.createMovement(
      actorId,
      salonId,
      productId,
      'idempotency-3',
      {
        kind: InventoryMovementKind.CONSUMPTION,
        quantity: 2,
      },
    );
    expect(result).toMatchObject({
      created: true,
      movement: { quantityDelta: '-2.000', stockAfter: '3.000' },
    });
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salonId,
          productId,
          actorUserId: actorId,
          quantityDelta: new Prisma.Decimal('-2.000'),
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: actorId,
          action: 'INVENTORY_MOVEMENT_RECORDED',
          entityId: result.movement.id,
        }),
      }),
    );
  });
});

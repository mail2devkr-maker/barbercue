import { Test } from '@nestjs/testing';
import { AdminSalonManagementService } from './admin-salon-management.service';
import { PrismaService } from '../prisma/prisma.service';

function salonRow(counts: Record<string, number> = {}) {
  return {
    id: 'salon-1', name: 'Empty Test Shop', publicId: 'BC-SHOP-000099',
    _count: {
      staff: 0, bookings: 0, queueEntries: 0,
      reviews: 0, ledgerEntries: 0, ...counts,
    },
  };
}

describe('AdminSalonManagementService hard deletion safeguards', () => {
  function build() {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'salon-1' }]),
      salon: {
        findUnique: jest.fn().mockResolvedValue(salonRow()),
        delete: jest.fn().mockResolvedValue({}),
      },
      shopDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      photo: { deleteMany: jest.fn() },
      operatingHours: { deleteMany: jest.fn() },
      chair: { deleteMany: jest.fn() },
      service: { deleteMany: jest.fn() },
      salonPaymentPolicy: { deleteMany: jest.fn() },
      cancellationPolicy: { deleteMany: jest.fn() },
      verificationRequest: { deleteMany: jest.fn() },
      userRole: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx)),
    };
    return { tx, prisma };
  }

  it('locks the parent shop and rejects missing shops without destructive writes', async () => {
    const { tx, prisma } = build();
    tx.$queryRaw.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminSalonManagementService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const service = moduleRef.get(AdminSalonManagementService);
    await expect(service.deleteSalon('admin-1', 'missing')).rejects.toMatchObject({
      code: 'SALON_NOT_FOUND',
    });
    expect(tx.salon.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['staff', { staff: 1 }],
    ['bookings', { bookings: 1 }],
    ['queue entries', { queueEntries: 1 }],
    ['reviews', { reviews: 1 }],
    ['ledger entries', { ledgerEntries: 1 }],
  ])('never deletes a shop with %s, checking inside the locked transaction', async (_kind, counts) => {
    const { tx, prisma } = build();
    tx.salon.findUnique.mockResolvedValue(salonRow(counts));
    const service = new AdminSalonManagementService(prisma as never);
    await expect(service.deleteSalon('admin-1', 'salon-1')).rejects.toMatchObject({
      code: 'SALON_HAS_ACTIVITY',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.salon.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('hard deletes only an empty shop, and audits exactly the performing actor', async () => {
    const { tx, prisma } = build();
    const service = new AdminSalonManagementService(prisma as never);
    await expect(service.deleteSalon('admin-1', 'salon-1')).resolves.toEqual({ deleted: true });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    for (const model of [
      tx.photo, tx.operatingHours, tx.chair, tx.service,
      tx.salonPaymentPolicy, tx.cancellationPolicy,
      tx.verificationRequest, tx.userRole,
    ]) {
      expect(model.deleteMany).toHaveBeenCalledWith({ where: { salonId: 'salon-1' } });
    }
    expect(tx.salon.delete).toHaveBeenCalledWith({ where: { id: 'salon-1' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-1',
        action: 'SALON_DELETED',
        entityType: 'Salon',
        entityId: 'salon-1',
        metadata: { name: 'Empty Test Shop', publicId: 'BC-SHOP-000099' },
      },
    });
  });

  it('fails closed when a deletion approval is pending, without any shop writes', async () => {
    const { tx, prisma } = build();
    tx.shopDeletionRequest.findFirst.mockResolvedValue({ id: 'pending-1' });
    const service = new AdminSalonManagementService(prisma as never);
    await expect(service.deleteSalon('admin-1', 'salon-1')).rejects
      .toMatchObject({ code: 'SHOP_DELETE_APPROVAL_PENDING' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.salon.delete).not.toHaveBeenCalled();
  });

  it('reuses a provided transaction and does not start another transaction', async () => {
    const { tx, prisma } = build();
    const service = new AdminSalonManagementService(prisma as never);
    await expect(service.deleteSalonInTransaction(tx as never, 'admin-1', 'salon-1'))
      .resolves.toEqual({ deleted: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

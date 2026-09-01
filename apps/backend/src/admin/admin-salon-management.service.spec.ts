import { Test } from '@nestjs/testing';
import { AdminSalonManagementService } from './admin-salon-management.service';
import { PrismaService } from '../prisma/prisma.service';

function makeSalonRow(counts: Record<string, number> = {}) {
  return {
    id: 'salon-1',
    name: 'Junk Test Shop',
    publicId: 'BC-SHOP-000099',
    _count: {
      staff: 0,
      bookings: 0,
      queueEntries: 0,
      reviews: 0,
      ledgerEntries: 0,
      ...counts,
    },
  };
}

describe('AdminSalonManagementService', () => {
  let service: AdminSalonManagementService;
  let tx: {
    photo: { deleteMany: jest.Mock };
    operatingHours: { deleteMany: jest.Mock };
    chair: { deleteMany: jest.Mock };
    service: { deleteMany: jest.Mock };
    salonPaymentPolicy: { deleteMany: jest.Mock };
    cancellationPolicy: { deleteMany: jest.Mock };
    verificationRequest: { deleteMany: jest.Mock };
    userRole: { deleteMany: jest.Mock };
    salon: { delete: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let prisma: {
    salon: { findUnique: jest.Mock; delete: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      photo: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      operatingHours: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      chair: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      service: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      salonPaymentPolicy: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cancellationPolicy: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      verificationRequest: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userRole: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      salon: { delete: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      salon: {
        findUnique: jest.fn(),
        delete: tx.salon.delete,
      },
      $transaction: jest.fn(
        (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminSalonManagementService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminSalonManagementService);
  });

  it('throws SALON_NOT_FOUND when the shop does not exist', async () => {
    prisma.salon.findUnique.mockResolvedValue(null);
    await expect(
      service.deleteSalon('admin-1', 'missing'),
    ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['staff', { staff: 1 }],
    ['bookings', { bookings: 1 }],
    ['live/queue entries', { queueEntries: 1 }],
    ['reviews', { reviews: 1 }],
    ['ledger entries', { ledgerEntries: 1 }],
  ])(
    'refuses to delete and never opens a transaction when the shop has %s',
    async (_label, counts) => {
      prisma.salon.findUnique.mockResolvedValue(makeSalonRow(counts));
      await expect(
        service.deleteSalon('admin-1', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_HAS_ACTIVITY' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.salon.delete).not.toHaveBeenCalled();
    },
  );

  it('deletes a genuinely empty shop: setup-only rows, the salon itself, and its owner role grant', async () => {
    prisma.salon.findUnique.mockResolvedValue(makeSalonRow());
    const result = await service.deleteSalon('admin-1', 'salon-1');
    expect(result).toEqual({ deleted: true });

    for (const model of [
      tx.photo,
      tx.operatingHours,
      tx.chair,
      tx.service,
      tx.salonPaymentPolicy,
      tx.cancellationPolicy,
      tx.verificationRequest,
      tx.userRole,
    ]) {
      expect(model.deleteMany).toHaveBeenCalledWith({
        where: { salonId: 'salon-1' },
      });
    }
    expect(tx.salon.delete).toHaveBeenCalledWith({
      where: { id: 'salon-1' },
    });
  });

  it('writes an AuditLog entry recording who deleted which shop', async () => {
    prisma.salon.findUnique.mockResolvedValue(makeSalonRow());
    await service.deleteSalon('admin-1', 'salon-1');
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-1',
        action: 'SALON_DELETED',
        entityType: 'Salon',
        entityId: 'salon-1',
        metadata: { name: 'Junk Test Shop', publicId: 'BC-SHOP-000099' },
      },
    });
  });

  it('never deletes anything before confirming zero activity (checked before the transaction opens)', async () => {
    prisma.salon.findUnique.mockResolvedValue(
      makeSalonRow({ staff: 2, bookings: 9 }),
    );
    await expect(
      service.deleteSalon('admin-1', 'salon-1'),
    ).rejects.toMatchObject({
      code: 'SALON_HAS_ACTIVITY',
      details: expect.objectContaining({ staff: 2, bookings: 9 }),
    });
  });
});

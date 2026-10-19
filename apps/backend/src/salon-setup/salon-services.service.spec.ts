import { SalonType } from '@barbercue/shared';
import { SalonServicesService } from './salon-services.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

describe('SalonServicesService', () => {
  let service: SalonServicesService;
  let prisma: {
    $transaction: jest.Mock;
    salon: { findUnique: jest.Mock; update: jest.Mock };
    service: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  // All catalog operations use the explicit owner-or-admin delegated access gate.
  let salonAccess: { assertOwnerAccess: jest.Mock; assertOwnerOrAdminAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      // toDto now reads the owning salon's currency so prices can be formatted per-country.
      salon: {
        findUnique: jest.fn().mockResolvedValue({ currency: 'INR', salonType: SalonType.UNISEX }),
        update: jest.fn(),
      },
      service: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    salonAccess = {
      assertOwnerAccess: jest.fn().mockResolvedValue(undefined),
      assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER'),
    };
    service = new SalonServicesService(prisma as never, salonAccess as never);
  });

  describe('salon type', () => {
    it('returns the persisted salon type after checking owner/admin access', async () => {
      prisma.salon.findUnique.mockResolvedValueOnce({ salonType: SalonType.GENTS });

      await expect(service.getSalonType('owner-1', 'salon-1')).resolves.toEqual({
        salonType: SalonType.GENTS,
      });
      expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
    });

    it('lets an owner switch salon type without touching existing service rows', async () => {
      prisma.salon.findUnique.mockResolvedValueOnce({ salonType: SalonType.UNISEX });
      prisma.salon.update.mockResolvedValueOnce({ salonType: SalonType.LADIES });

      await expect(
        service.updateSalonType('owner-1', 'salon-1', { salonType: SalonType.LADIES }),
      ).resolves.toEqual({ salonType: SalonType.LADIES });

      expect(prisma.salon.update).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        data: { salonType: SalonType.LADIES },
        select: { salonType: true },
      });
      expect(prisma.service.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('audits a delegated PLATFORM_ADMIN salon-type change', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValueOnce('PLATFORM_ADMIN');
      prisma.salon.findUnique.mockResolvedValueOnce({ salonType: SalonType.UNISEX });
      prisma.salon.update.mockResolvedValueOnce({ salonType: SalonType.GENTS });

      await service.updateSalonType('admin-1', 'salon-1', { salonType: SalonType.GENTS });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_SALON_TYPE_UPDATED',
          entityType: 'Salon',
          entityId: 'salon-1',
          metadata: {
            before: SalonType.UNISEX,
            after: SalonType.GENTS,
          },
        }),
      });
    });
  });

  describe('salon isolation', () => {
    it('checks salon access before listing', async () => {
      await service.list('owner-1', 'salon-1');
      expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
        'owner-1',
        'salon-1',
      );
    });

    it('propagates SALON_ACCESS_DENIED and never queries when access is refused', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.list('intruder', 'someone-elses-salon'),
      ).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(prisma.service.findMany).not.toHaveBeenCalled();
    });

    it("scopes update by BOTH id and salonId so another salon's service cannot be mutated", async () => {
      prisma.service.findFirst.mockResolvedValue(null);
      await expect(
        service.update('owner-1', 'salon-1', 'service-from-salon-2', {
          name: 'Hijack',
        }),
      ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
      expect(prisma.service.findFirst).toHaveBeenCalledWith({
        where: { id: 'service-from-salon-2', salonId: 'salon-1' },
      });
      expect(prisma.service.update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('rejects a normalized name/category duplicate and points inactive rows to Reactivate', async () => {
      prisma.service.findMany.mockResolvedValueOnce([
        {
          id: 'existing',
          name: ' Skin-Fade ',
          description: null,
          durationMinutes: 40,
          price: decimal('400'),
          category: "Men's Hair & Grooming",
          isActive: false,
        },
      ]);
      await expect(
        service.create('owner-1', 'salon-1', {
          name: 'skin fade',
          price: 500,
          durationMinutes: 45,
          category: "Men's Hair & Grooming",
        }),
      ).rejects.toMatchObject({ code: 'SERVICE_ALREADY_EXISTS' });
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('creates an active service scoped to the salon and maps Decimal price to a number', async () => {
      prisma.service.create.mockResolvedValue({
        id: 'svc-1',
        name: 'Haircut',
        description: 'Cut and finish',
        durationMinutes: 30,
        price: decimal('300.00'),
        category: 'Hair',
        subcategory: 'Haircut',
        isActive: true,
      });

      const result = await service.create('owner-1', 'salon-1', {
        name: 'Haircut',
        description: 'Cut and finish',
        price: 300,
        durationMinutes: 30,
        category: 'Hair',
        subcategory: 'Haircut',
      });

      expect(prisma.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          salonId: 'salon-1',
          name: 'Haircut',
          price: '300',
          durationMinutes: 30,
          subcategory: 'Haircut',
          isActive: true,
        }),
      });
      expect(result).toEqual({
        id: 'svc-1',
        name: 'Haircut',
        description: 'Cut and finish',
        durationMinutes: 30,
        price: 300,
        category: 'Hair',
        subcategory: 'Haircut',
        isActive: true,
        currency: 'INR',
      });
      expect(typeof result.price).toBe('number');
    });

    it('stores a null category when none is supplied', async () => {
      prisma.service.create.mockResolvedValue({
        id: 'svc-1',
        name: 'Trim',
        description: null,
        durationMinutes: 15,
        price: decimal('100'),
        category: null,
        isActive: true,
      });
      await service.create('owner-1', 'salon-1', {
        name: 'Trim',
        price: 100,
        durationMinutes: 15,
      });
      expect(prisma.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ category: null, subcategory: null }),
      });
    });
  });

  describe('update / soft delete', () => {
    beforeEach(() => {
      prisma.service.findFirst.mockResolvedValue({
        id: 'svc-1',
        salonId: 'salon-1',
      });
      prisma.service.update.mockResolvedValue({
        id: 'svc-1',
        name: 'Haircut',
        description: null,
        durationMinutes: 30,
        price: decimal('300'),
        category: null,
        isActive: false,
      });
    });

    it("deactivates rather than deleting (Service is FK'd from bookings/queue history)", async () => {
      const result = await service.update('owner-1', 'salon-1', 'svc-1', {
        isActive: false,
      });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
      // No delete method exists on the service at all.
      expect(
        (service as unknown as Record<string, unknown>).delete,
      ).toBeUndefined();
    });

    it('only sends the fields actually provided (partial update)', async () => {
      await service.update('owner-1', 'salon-1', 'svc-1', { name: 'Renamed' });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { name: 'Renamed' },
      });
    });

    it('can update or clear the optional subcategory independently', async () => {
      await service.update('owner-1', 'salon-1', 'svc-1', { subcategory: 'Coloring' });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' }, data: { subcategory: 'Coloring' },
      });
      prisma.service.update.mockClear();
      await service.update('owner-1', 'salon-1', 'svc-1', { subcategory: null });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' }, data: { subcategory: null },
      });
    });

    it('serializes an updated price through String() for the Decimal column', async () => {
      await service.update('owner-1', 'salon-1', 'svc-1', { price: 450.5 });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { price: '450.5' },
      });
    });

    it('creates and updates service details without changing booking references', async () => {
      prisma.service.create.mockResolvedValue({
        id: 'svc-2',
        name: 'Fade',
        description: 'Includes wash',
        durationMinutes: 45,
        price: decimal('500'),
        category: 'Hair',
        subcategory: 'Haircut',
        isActive: true,
      });
      const created = await service.create('owner-1', 'salon-1', {
        name: 'Fade',
        description: 'Includes wash',
        price: 500,
        durationMinutes: 45,
        category: 'Hair',
      });
      expect(created.description).toBe('Includes wash');

      prisma.service.update.mockResolvedValue({
        ...created,
        price: decimal('500'),
        description: 'Wash and finish',
      });
      const updated = await service.update('owner-1', 'salon-1', 'svc-1', {
        description: 'Wash and finish',
      });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { description: 'Wash and finish' },
      });
      expect(updated.description).toBe('Wash and finish');
    });
  });

  it('list returns both active and inactive services so an owner can manage them', async () => {
    prisma.service.findMany.mockResolvedValue([
      {
        id: 'a',
        name: 'Active',
        description: null,
        durationMinutes: 30,
        price: decimal('300'),
        category: null,
        isActive: true,
      },
      {
        id: 'b',
        name: 'Retired',
        description: null,
        durationMinutes: 30,
        price: decimal('200'),
        category: null,
        isActive: false,
      },
    ]);
    const result = await service.list('owner-1', 'salon-1');
    expect(result.map((s) => s.isActive)).toEqual([true, false]);
    expect(prisma.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salonId: 'salon-1' } }),
    );
  });

  // Part 2 — PLATFORM_ADMIN delegated shop management.
  describe('delegated admin update', () => {
    beforeEach(() => {
      prisma.service.findFirst.mockResolvedValue({
        id: 'svc-1',
        salonId: 'salon-1',
        name: 'Haircut',
        description: null,
        durationMinutes: 30,
        price: decimal('300'),
        category: null,
        isActive: true,
      });
      prisma.service.update.mockResolvedValue({
        id: 'svc-1',
        name: 'Haircut',
        description: null,
        durationMinutes: 30,
        price: decimal('350'),
        category: null,
        isActive: true,
      });
    });

    it('an owner update never writes an AuditLog row', async () => {
      await service.update('owner-1', 'salon-1', 'svc-1', { price: 350 });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('PLATFORM_ADMIN managing an ACTIVE salon can update a service price and it is recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      const result = await service.update('admin-1', 'salon-1', 'svc-1', { price: 350 });
      expect(result.price).toBe(350);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_SERVICE_UPDATED',
          entityType: 'Service',
          entityId: 'svc-1',
          metadata: expect.objectContaining({
            salonId: 'salon-1',
            before: expect.objectContaining({ price: '300' }),
            after: expect.objectContaining({ price: '350' }),
          }),
        }),
      });
    });

    it('a normal CUSTOMER (or any caller with no owner/admin access) is denied', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.update('customer-1', 'salon-1', 'svc-1', { price: 350 }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.service.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  it('allows a PLATFORM_ADMIN to create a service and audits the real admin actor', async () => {
    salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
    prisma.service.create.mockResolvedValue({
      id: 'svc-admin', name: 'Fade', description: null, durationMinutes: 30,
      price: decimal('400'), category: 'Hair', isActive: true,
    });
    const result = await service.create('admin-1', 'salon-1', {
      name: 'Fade', price: 400, durationMinutes: 30, category: 'Hair',
    });
    expect(result.id).toBe('svc-admin');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-1', action: 'ADMIN_SERVICE_CREATED', entityType: 'Service', entityId: 'svc-admin',
      }),
    });
  });
  describe('Remove All Services (non-destructive bulk turn-off)', () => {
    const intent = { confirmation: 'REMOVE ALL', expectedActiveCount: 3 };
    let tx: {
      $executeRawUnsafe: jest.Mock;
      service: { count: jest.Mock; updateMany: jest.Mock };
      auditLog: { create: jest.Mock };
    };

    beforeEach(() => {
      tx = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        service: {
          count: jest.fn().mockResolvedValue(3),
          updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
        auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
      };
      prisma.$transaction.mockImplementation((fn: (txn: typeof tx) => Promise<unknown>) => fn(tx));
    });

    it('refuses unauthorized owners, and never enters a write transaction', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(service.removeAll('intruder', 'another-salon', intent))
        .rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      null, {}, { confirmation: 'remove all', expectedActiveCount: 3 },
      { confirmation: 'REMOVE ALL', expectedActiveCount: 0 },
      { confirmation: 'REMOVE ALL', expectedActiveCount: -1 },
      { confirmation: 'REMOVE ALL', expectedActiveCount: '3' },
      { confirmation: 'REMOVE ALL', expectedActiveCount: 3.5 },
      { confirmation: 'REMOVE ALL', expectedActiveCount: Infinity },
    ])('rejects invalid destructive-operation intent %p', async (body) => {
      await expect(service.removeAll('owner-1', 'salon-1', body))
        .rejects.toMatchObject({ code: 'SERVICE_BULK_CONFIRMATION_REQUIRED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects stale counts with 409 and does not turn off any service', async () => {
      tx.service.count.mockResolvedValueOnce(2);
      await expect(service.removeAll('owner-1', 'salon-1', intent))
        .rejects.toMatchObject({ code: 'SERVICE_CATALOG_CHANGED' });
      expect(tx.service.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('turns off only this shop active services and audits the real owner', async () => {
      const result = await service.removeAll('owner-1', 'salon-1', intent);
      expect(result).toEqual({ removedCount: 3, remainingActive: 0 });
      expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))', 'salon-1',
      );
      expect(tx.service.count).toHaveBeenCalledWith({
        where: { salonId: 'salon-1', isActive: true },
      });
      expect(tx.service.updateMany).toHaveBeenCalledWith({
        where: { salonId: 'salon-1', isActive: true },
        data: { isActive: false },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 'owner-1', action: 'OWNER_SERVICES_BULK_DEACTIVATED',
          entityType: 'Salon', entityId: 'salon-1',
          metadata: { salonId: 'salon-1', removedCount: 3, method: 'SOFT_DEACTIVATE' },
        },
      });
      expect(prisma.service.update).not.toHaveBeenCalled();
    });

    it('audits a delegated admin separately', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValueOnce('PLATFORM_ADMIN');
      await service.removeAll('admin-1', 'salon-1', intent);
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1', action: 'ADMIN_SERVICES_BULK_DEACTIVATED',
        }),
      });
    });

    it('rejects a concurrent change and transaction rolls back rather than reporting success', async () => {
      tx.service.updateMany.mockResolvedValueOnce({ count: 2 });
      await expect(service.removeAll('owner-1', 'salon-1', intent))
        .rejects.toMatchObject({ code: 'SERVICE_CATALOG_CHANGED' });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('permanent catalog reset', () => {
    const intent = { confirmation: 'DELETE ALL', expectedTotalCount: 180 };
    let tx: {
      $executeRawUnsafe: jest.Mock;
      service: { findMany: jest.Mock; deleteMany: jest.Mock };
      staffService: { deleteMany: jest.Mock };
      booking: { count: jest.Mock };
      bookingService: { count: jest.Mock };
      queueEntry: { count: jest.Mock };
      serviceSession: { count: jest.Mock };
      auditLog: { create: jest.Mock };
    };
    beforeEach(() => {
      tx = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        service: {
          findMany: jest.fn().mockResolvedValue(
            Array.from({ length: 180 }, (_, i) => ({ id: 's-' + i })),
          ),
          deleteMany: jest.fn().mockResolvedValue({ count: 180 }),
        },
        staffService: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        booking: { count: jest.fn().mockResolvedValue(0) },
        bookingService: { count: jest.fn().mockResolvedValue(0) },
        queueEntry: { count: jest.fn().mockResolvedValue(0) },
        serviceSession: { count: jest.fn().mockResolvedValue(0) },
        auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
      };
      prisma.$transaction.mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    });

    it('requires salon owner or delegated platform admin before reading any rows', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(service.deleteAll('intruder', 'shop-other', intent))
        .rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      undefined, {}, { confirmation: 'REMOVE ALL', expectedTotalCount: 180 },
      { confirmation: 'DELETE ALL', expectedTotalCount: 0 },
      { confirmation: 'DELETE ALL', expectedTotalCount: '180' },
      { confirmation: 'DELETE ALL', expectedTotalCount: 10.5 },
    ])('never deletes without exact irreversible intent %p', async (raw) => {
      await expect(service.deleteAll('owner', 'shop', raw))
        .rejects.toMatchObject({ code: 'SERVICE_BULK_DELETE_CONFIRMATION_REQUIRED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses stale counts and leaves the entire catalog unchanged', async () => {
      tx.service.findMany.mockResolvedValueOnce([{ id: 's-1' }]);
      await expect(service.deleteAll('owner', 'shop', intent))
        .rejects.toMatchObject({ code: 'SERVICE_CATALOG_CHANGED' });
      expect(tx.staffService.deleteMany).not.toHaveBeenCalled();
      expect(tx.service.deleteMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it.each([
      ['booking', 'bookings'], ['bookingService', 'bookingServices'],
      ['queueEntry', 'queueEntries'], ['serviceSession', 'serviceSessions'],
    ] as const)('protects all historical foreign keys %s', async (model, label) => {
      tx[model].count.mockResolvedValueOnce(1);
      await expect(service.deleteAll('owner', 'shop', intent))
        .rejects.toMatchObject({
          code: 'SERVICE_HISTORY_PROTECTED',
          details: expect.objectContaining({
            references: expect.objectContaining({ [label]: 1 }),
          }),
        });
      expect(tx.staffService.deleteMany).not.toHaveBeenCalled();
      expect(tx.service.deleteMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('deletes all 180 inactive and active records only for the authorized shop', async () => {
      await expect(service.deleteAll('owner', 'glow-gaze-shop', intent))
        .resolves.toEqual({ deletedCount: 180, remainingCount: 0 });
      const ids = Array.from({ length: 180 }, (_, i) => 's-' + i);
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))', 'glow-gaze-shop',
      );
      expect(tx.service.findMany).toHaveBeenCalledWith({
        where: { salonId: 'glow-gaze-shop' }, select: { id: true },
      });
      expect(tx.staffService.deleteMany).toHaveBeenCalledWith({
        where: { serviceId: { in: ids } },
      });
      expect(tx.service.deleteMany).toHaveBeenCalledWith({
        where: { salonId: 'glow-gaze-shop', id: { in: ids } },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'owner',
          action: 'OWNER_SALON_SERVICES_PERMANENTLY_DELETED',
          metadata: expect.objectContaining({ deletedCount: 180, method: 'HARD_DELETE' }),
        }),
      });
    });

    it('audits a delegated platform administrator and rolls back on count mismatch', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValueOnce('PLATFORM_ADMIN');
      tx.service.deleteMany.mockResolvedValueOnce({ count: 179 });
      await expect(service.deleteAll('admin', 'shop', intent))
        .rejects.toMatchObject({ code: 'SERVICE_CATALOG_CHANGED' });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });

});

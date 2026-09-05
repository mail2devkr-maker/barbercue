import { SalonServicesService } from './salon-services.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

describe('SalonServicesService', () => {
  let service: SalonServicesService;
  let prisma: {
    salon: { findUnique: jest.Mock };
    service: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  // `create` still calls assertOwnerAccess (unconverted — Part 2 only wired list/update for
  // delegated admin management); `list`/`update` call the new assertOwnerOrAdminAccess. Both
  // mocks coexist here for exactly that reason.
  let salonAccess: { assertOwnerAccess: jest.Mock; assertOwnerOrAdminAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      // toDto now reads the owning salon's currency so prices can be formatted per-country.
      salon: { findUnique: jest.fn().mockResolvedValue({ currency: 'INR' }) },
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
        isActive: true,
      });

      const result = await service.create('owner-1', 'salon-1', {
        name: 'Haircut',
        description: 'Cut and finish',
        price: 300,
        durationMinutes: 30,
        category: 'Hair',
      });

      expect(prisma.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          salonId: 'salon-1',
          name: 'Haircut',
          price: '300',
          durationMinutes: 30,
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
        data: expect.objectContaining({ category: null }),
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
});

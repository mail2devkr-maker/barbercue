import { SalonChairsService } from './salon-chairs.service';

describe('SalonChairsService', () => {
  let service: SalonChairsService;
  let prisma: {
    chair: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let salonAccess: { assertOwnerOrAdminAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      chair: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    salonAccess = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
    service = new SalonChairsService(prisma as never, salonAccess as never);
  });

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
    await expect(service.list('intruder', 'other-salon')).rejects.toMatchObject(
      {
        code: 'SALON_ACCESS_DENIED',
      },
    );
    expect(prisma.chair.findMany).not.toHaveBeenCalled();
  });

  it('creates a chair as ACTIVE so it immediately counts toward bookable capacity', async () => {
    prisma.chair.create.mockResolvedValue({
      id: 'c1',
      label: 'Chair 1',
      status: 'ACTIVE',
    });
    const result = await service.create('owner-1', 'salon-1', {
      label: 'Chair 1',
    });
    expect(prisma.chair.create).toHaveBeenCalledWith({
      data: { salonId: 'salon-1', label: 'Chair 1', status: 'ACTIVE' },
    });
    expect(result).toEqual({ id: 'c1', label: 'Chair 1', status: 'ACTIVE' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("scopes update by BOTH id and salonId so another salon's chair cannot be mutated", async () => {
    prisma.chair.findFirst.mockResolvedValue(null);
    await expect(
      service.update('owner-1', 'salon-1', 'chair-from-salon-2', {
        label: 'Hijack',
      }),
    ).rejects.toMatchObject({ code: 'CHAIR_NOT_FOUND' });
    expect(prisma.chair.findFirst).toHaveBeenCalledWith({
      where: { id: 'chair-from-salon-2', salonId: 'salon-1' },
    });
    expect(prisma.chair.update).not.toHaveBeenCalled();
  });

  it("deactivates rather than deleting (Chair is FK'd from service sessions/queue entries)", async () => {
    prisma.chair.findFirst.mockResolvedValue({ id: 'c1', salonId: 'salon-1', label: 'Chair 1', status: 'ACTIVE' });
    prisma.chair.update.mockResolvedValue({
      id: 'c1',
      label: 'Chair 1',
      status: 'INACTIVE',
    });

    const result = await service.update('owner-1', 'salon-1', 'c1', {
      status: 'INACTIVE' as never,
    });

    expect(prisma.chair.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'INACTIVE' },
    });
    expect(result.status).toBe('INACTIVE');
    expect(
      (service as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('supports MAINTENANCE as a non-bookable state distinct from INACTIVE', async () => {
    prisma.chair.findFirst.mockResolvedValue({ id: 'c1', salonId: 'salon-1', label: 'Chair 1', status: 'ACTIVE' });
    prisma.chair.update.mockResolvedValue({
      id: 'c1',
      label: 'Chair 1',
      status: 'MAINTENANCE',
    });
    const result = await service.update('owner-1', 'salon-1', 'c1', {
      status: 'MAINTENANCE' as never,
    });
    expect(result.status).toBe('MAINTENANCE');
  });

  // Part 2 — PLATFORM_ADMIN delegated shop management.
  describe('delegated admin management', () => {
    it('PLATFORM_ADMIN can create a chair on an ACTIVE salon, recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      prisma.chair.create.mockResolvedValue({ id: 'c2', label: 'Chair 2', status: 'ACTIVE' });
      const result = await service.create('admin-1', 'salon-1', { label: 'Chair 2' });
      expect(result.label).toBe('Chair 2');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_CHAIR_CREATED',
          entityType: 'Chair',
          entityId: 'c2',
        }),
      });
    });

    it('PLATFORM_ADMIN can update (including deactivate) a chair, recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      prisma.chair.findFirst.mockResolvedValue({ id: 'c1', salonId: 'salon-1', label: 'Chair 1', status: 'ACTIVE' });
      prisma.chair.update.mockResolvedValue({ id: 'c1', label: 'Chair 1', status: 'INACTIVE' });
      const result = await service.update('admin-1', 'salon-1', 'c1', { status: 'INACTIVE' as never });
      expect(result.status).toBe('INACTIVE');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_CHAIR_UPDATED',
          entityType: 'Chair',
          entityId: 'c1',
          metadata: expect.objectContaining({
            before: { label: 'Chair 1', status: 'ACTIVE' },
            after: { label: 'Chair 1', status: 'INACTIVE' },
          }),
        }),
      });
    });

    it('a normal CUSTOMER is denied and nothing is written', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(service.create('customer-1', 'salon-1', { label: 'X' })).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(prisma.chair.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});

import { SalonChairsService } from './salon-chairs.service';

describe('SalonChairsService', () => {
  let service: SalonChairsService;
  let prisma: {
    chair: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    serviceSession: { findMany: jest.Mock };
    manualChairOccupancy: { findMany: jest.Mock };
    queueEntry: { findMany: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    chair: typeof prisma.chair;
    serviceSession: typeof prisma.serviceSession;
    manualChairOccupancy: typeof prisma.manualChairOccupancy;
    queueEntry: typeof prisma.queueEntry;
    auditLog: typeof prisma.auditLog;
  };
  let salonAccess: { assertOwnerOrAdminAccess: jest.Mock };
  let trigger: { trigger: jest.Mock };

  beforeEach(() => {
    prisma = {
      chair: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      serviceSession: { findMany: jest.fn().mockResolvedValue([]) },
      manualChairOccupancy: { findMany: jest.fn().mockResolvedValue([]) },
      queueEntry: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn(),
    };
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      chair: prisma.chair,
      serviceSession: prisma.serviceSession,
      manualChairOccupancy: prisma.manualChairOccupancy,
      queueEntry: prisma.queueEntry,
      auditLog: prisma.auditLog,
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    salonAccess = {
      assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER'),
    };
    trigger = { trigger: jest.fn() };
    service = new SalonChairsService(
      prisma as never,
      salonAccess as never,
      undefined,
      trigger as never,
    );
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
    expect(trigger.trigger).toHaveBeenCalledWith('salon-1');
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
    prisma.chair.findFirst.mockResolvedValue({
      id: 'c1',
      salonId: 'salon-1',
      label: 'Chair 1',
      status: 'ACTIVE',
    });
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

  it('rechecks arrived customers as soon as a chair becomes ACTIVE again', async () => {
    prisma.chair.findFirst.mockResolvedValue({
      id: 'c1',
      salonId: 'salon-1',
      label: 'Chair 1',
      status: 'MAINTENANCE',
    });
    prisma.chair.update.mockResolvedValue({
      id: 'c1',
      label: 'Chair 1',
      status: 'ACTIVE',
    });
    await service.update('owner-1', 'salon-1', 'c1', {
      status: 'ACTIVE' as never,
    });
    expect(trigger.trigger).toHaveBeenCalledTimes(1);
    expect(trigger.trigger).toHaveBeenCalledWith('salon-1');
  });

  it('does not wake auto-assign for a label edit or a chair taken out of use', async () => {
    prisma.chair.findFirst.mockResolvedValue({
      id: 'c1',
      salonId: 'salon-1',
      label: 'Chair 1',
      status: 'ACTIVE',
    });
    prisma.chair.update.mockResolvedValue({
      id: 'c1',
      label: 'Renamed',
      status: 'ACTIVE',
    });
    await service.update('owner-1', 'salon-1', 'c1', { label: 'Renamed' });
    prisma.chair.update.mockResolvedValue({
      id: 'c1',
      label: 'Renamed',
      status: 'INACTIVE',
    });
    await service.update('owner-1', 'salon-1', 'c1', {
      status: 'INACTIVE' as never,
    });
    expect(trigger.trigger).not.toHaveBeenCalled();
  });

  it('supports MAINTENANCE as a non-bookable state distinct from INACTIVE', async () => {
    prisma.chair.findFirst.mockResolvedValue({
      id: 'c1',
      salonId: 'salon-1',
      label: 'Chair 1',
      status: 'ACTIVE',
    });
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

  describe('bulk deactivation preview and apply', () => {
    const c1 = '11111111-1111-4111-8111-111111111111';
    const c2 = '22222222-2222-4222-8222-222222222222';
    const version = new Date('2026-10-17T10:00:00.000Z');
    const versionIso = version.toISOString();

    it('returns only salon-owned chairs and a conflict preview without writing', async () => {
      prisma.chair.findMany.mockResolvedValue([
        { id: c1, label: 'Chair 1', status: 'ACTIVE', updatedAt: version },
      ]);
      prisma.serviceSession.findMany.mockResolvedValue([{ chairId: c1 }]);

      const result = await service.previewBulkDeactivate('owner-1', 'salon-1', {
        chairIds: [c1, c2],
      });

      expect(result).toEqual({
        salonId: 'salon-1',
        items: [
          {
            chairId: c1,
            label: 'Chair 1',
            status: 'ACTIVE',
            expectedUpdatedAt: versionIso,
            disposition: 'CONFLICT',
            conflicts: ['ACTIVE_SERVICE_SESSION'],
          },
          {
            chairId: c2,
            label: null,
            status: null,
            expectedUpdatedAt: null,
            disposition: 'NOT_FOUND',
            conflicts: [],
          },
        ],
      });
      expect(prisma.chair.findMany).toHaveBeenCalledWith({
        where: { salonId: 'salon-1', id: { in: [c1, c2] } },
        select: { id: true, label: true, status: true, updatedAt: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.chair.updateMany).not.toHaveBeenCalled();
    });

    it('requires salon authorization before preview or apply queries', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );

      await expect(
        service.previewBulkDeactivate('intruder', 'salon-1', {
          chairIds: [c1],
        }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      await expect(
        service.bulkDeactivate('intruder', 'salon-1', {
          items: [{ chairId: c1, expectedUpdatedAt: versionIso }],
        }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });

      expect(prisma.chair.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechecks conflicts, applies eligible chairs atomically, and audits each change', async () => {
      prisma.chair.findMany.mockResolvedValue([
        { id: c1, label: 'Chair 1', status: 'ACTIVE', updatedAt: version },
        { id: c2, label: 'Chair 2', status: 'ACTIVE', updatedAt: version },
      ]);
      prisma.serviceSession.findMany.mockResolvedValue([{ chairId: c1 }]);

      const result = await service.bulkDeactivate('owner-1', 'salon-1', {
        items: [
          { chairId: c1, expectedUpdatedAt: versionIso },
          { chairId: c2, expectedUpdatedAt: versionIso },
        ],
      });

      expect(result).toEqual({
        salonId: 'salon-1',
        deactivatedCount: 1,
        items: [
          {
            chairId: c1,
            label: 'Chair 1',
            result: 'CONFLICT',
            conflicts: ['ACTIVE_SERVICE_SESSION'],
          },
          {
            chairId: c2,
            label: 'Chair 2',
            result: 'DEACTIVATED',
            conflicts: [],
          },
        ],
      });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(tx.chair.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.chair.updateMany).toHaveBeenCalledWith({
        where: {
          id: c2,
          salonId: 'salon-1',
          status: 'ACTIVE',
          updatedAt: version,
        },
        data: { status: 'INACTIVE', updatedAt: expect.any(Date) },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'owner-1',
          action: 'CHAIR_BULK_DEACTIVATED',
          entityType: 'Chair',
          entityId: c2,
        }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: expect.any(String),
      });
    });

    it('rejects stale preview versions without returning false success', async () => {
      prisma.chair.findMany.mockResolvedValue([
        {
          id: c1,
          label: 'Chair 1',
          status: 'ACTIVE',
          updatedAt: new Date(version.getTime() + 1),
        },
      ]);

      const result = await service.bulkDeactivate('owner-1', 'salon-1', {
        items: [{ chairId: c1, expectedUpdatedAt: versionIso }],
      });

      expect(result).toMatchObject({
        deactivatedCount: 0,
        items: [{ result: 'CONFLICT', conflicts: ['STALE_PREVIEW'] }],
      });
      expect(tx.chair.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  // Part 2 — PLATFORM_ADMIN delegated shop management.
  describe('delegated admin management', () => {
    it('PLATFORM_ADMIN can create a chair on an ACTIVE salon, recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      prisma.chair.create.mockResolvedValue({
        id: 'c2',
        label: 'Chair 2',
        status: 'ACTIVE',
      });
      const result = await service.create('admin-1', 'salon-1', {
        label: 'Chair 2',
      });
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
      prisma.chair.findFirst.mockResolvedValue({
        id: 'c1',
        salonId: 'salon-1',
        label: 'Chair 1',
        status: 'ACTIVE',
      });
      prisma.chair.update.mockResolvedValue({
        id: 'c1',
        label: 'Chair 1',
        status: 'INACTIVE',
      });
      const result = await service.update('admin-1', 'salon-1', 'c1', {
        status: 'INACTIVE' as never,
      });
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
      await expect(
        service.create('customer-1', 'salon-1', { label: 'X' }),
      ).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(prisma.chair.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});

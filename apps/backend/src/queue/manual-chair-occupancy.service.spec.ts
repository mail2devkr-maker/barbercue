import { ManualChairOccupancyService } from './manual-chair-occupancy.service';

function harness(overrides: Record<string, unknown> = {}) {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    chair: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', status: 'ACTIVE' }) },
    serviceSession: { findFirst: jest.fn().mockResolvedValue(null) },
    manualChairOccupancy: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'm1', chairId: 'c1', startedAt: new Date('2026-09-09T00:00:00Z') }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  const prisma: any = { $transaction: jest.fn((cb: any) => cb(tx)) };
  const access: any = { assertAccessOrAdminAccess: jest.fn().mockResolvedValue('STAFF_OR_OWNER') };
  const queue: any = { onChairOccupancyChanged: jest.fn().mockResolvedValue(undefined) };
  return { service: new ManualChairOccupancyService(prisma, access, queue), tx, prisma, access, queue };
}

describe('ManualChairOccupancyService', () => {
  it('occupies a free active chair and refreshes queue capacity', async () => {
    const h = harness();
    const result = await h.service.occupyLocal('u1', 's1', 'c1');
    expect(result.id).toBe('m1');
    expect(h.tx.manualChairOccupancy.create).toHaveBeenCalled();
    expect(h.queue.onChairOccupancyChanged).toHaveBeenCalledWith('s1');
  });

  it('rejects a chair with an active FastQue service', async () => {
    const h = harness();
    h.tx.serviceSession.findFirst.mockResolvedValue({ id: 'ss1' });
    await expect(h.service.occupyLocal('u1', 's1', 'c1')).rejects.toMatchObject({ response: expect.anything() });
    expect(h.tx.manualChairOccupancy.create).not.toHaveBeenCalled();
  });

  it('rejects a second active manual occupancy', async () => {
    const h = harness();
    h.tx.manualChairOccupancy.findFirst.mockResolvedValue({ id: 'm0' });
    await expect(h.service.occupyLocal('u1', 's1', 'c1')).rejects.toBeDefined();
    expect(h.tx.manualChairOccupancy.create).not.toHaveBeenCalled();
  });

  it('free is idempotent when no local occupancy exists', async () => {
    const h = harness();
    const result = await h.service.freeLocal('u1', 's1', 'c1');
    expect(result).toEqual({ cleared: false, occupancyId: null });
    expect(h.queue.onChairOccupancyChanged).not.toHaveBeenCalled();
  });

  it('bulk free touches manual occupancies only and audits the actor', async () => {
    const h = harness();
    h.tx.manualChairOccupancy.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    h.tx.manualChairOccupancy.updateMany.mockResolvedValue({ count: 2 });
    const result = await h.service.freeAllLocal('u1', 's1');
    expect(result).toEqual({ clearedCount: 2 });
    expect(h.tx.serviceSession.updateMany).toBeUndefined();
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: 'u1', action: 'LOCAL_CHAIRS_FREED_BULK' }) }));
  });
});

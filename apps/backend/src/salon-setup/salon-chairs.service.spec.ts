import { SalonChairsService } from './salon-chairs.service';

describe('SalonChairsService', () => {
  let service: SalonChairsService;
  let prisma: { chair: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock } };
  let salonAccess: { assertAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      chair: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    service = new SalonChairsService(prisma as never, salonAccess as never);
  });

  it('checks salon access before listing', async () => {
    await service.list('owner-1', 'salon-1');
    expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
  });

  it('propagates SALON_ACCESS_DENIED and never queries when access is refused', async () => {
    salonAccess.assertAccess.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(service.list('intruder', 'other-salon')).rejects.toMatchObject({
      code: 'SALON_ACCESS_DENIED',
    });
    expect(prisma.chair.findMany).not.toHaveBeenCalled();
  });

  it('creates a chair as ACTIVE so it immediately counts toward bookable capacity', async () => {
    prisma.chair.create.mockResolvedValue({ id: 'c1', label: 'Chair 1', status: 'ACTIVE' });
    const result = await service.create('owner-1', 'salon-1', { label: 'Chair 1' });
    expect(prisma.chair.create).toHaveBeenCalledWith({
      data: { salonId: 'salon-1', label: 'Chair 1', status: 'ACTIVE' },
    });
    expect(result).toEqual({ id: 'c1', label: 'Chair 1', status: 'ACTIVE' });
  });

  it('scopes update by BOTH id and salonId so another salon\'s chair cannot be mutated', async () => {
    prisma.chair.findFirst.mockResolvedValue(null);
    await expect(
      service.update('owner-1', 'salon-1', 'chair-from-salon-2', { label: 'Hijack' }),
    ).rejects.toMatchObject({ code: 'CHAIR_NOT_FOUND' });
    expect(prisma.chair.findFirst).toHaveBeenCalledWith({
      where: { id: 'chair-from-salon-2', salonId: 'salon-1' },
    });
    expect(prisma.chair.update).not.toHaveBeenCalled();
  });

  it('deactivates rather than deleting (Chair is FK\'d from service sessions/queue entries)', async () => {
    prisma.chair.findFirst.mockResolvedValue({ id: 'c1', salonId: 'salon-1' });
    prisma.chair.update.mockResolvedValue({ id: 'c1', label: 'Chair 1', status: 'INACTIVE' });

    const result = await service.update('owner-1', 'salon-1', 'c1', { status: 'INACTIVE' as never });

    expect(prisma.chair.update).toHaveBeenCalledWith({
      where: { id: 'c1' }, data: { status: 'INACTIVE' },
    });
    expect(result.status).toBe('INACTIVE');
    expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
  });

  it('supports MAINTENANCE as a non-bookable state distinct from INACTIVE', async () => {
    prisma.chair.findFirst.mockResolvedValue({ id: 'c1', salonId: 'salon-1' });
    prisma.chair.update.mockResolvedValue({ id: 'c1', label: 'Chair 1', status: 'MAINTENANCE' });
    const result = await service.update('owner-1', 'salon-1', 'c1', { status: 'MAINTENANCE' as never });
    expect(result.status).toBe('MAINTENANCE');
  });
});

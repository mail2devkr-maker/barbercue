import { SalonServicesService } from './salon-services.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

describe('SalonServicesService', () => {
  let service: SalonServicesService;
  let prisma: {
    salon: { findUnique: jest.Mock };
    service: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let salonAccess: { assertAccess: jest.Mock };

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
    };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    service = new SalonServicesService(prisma as never, salonAccess as never);
  });

  describe('salon isolation', () => {
    it('checks salon access before listing', async () => {
      await service.list('owner-1', 'salon-1');
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
    });

    it('propagates SALON_ACCESS_DENIED and never queries when access is refused', async () => {
      salonAccess.assertAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(service.list('intruder', 'someone-elses-salon')).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(prisma.service.findMany).not.toHaveBeenCalled();
    });

    it('scopes update by BOTH id and salonId so another salon\'s service cannot be mutated', async () => {
      prisma.service.findFirst.mockResolvedValue(null);
      await expect(
        service.update('owner-1', 'salon-1', 'service-from-salon-2', { name: 'Hijack' }),
      ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
      expect(prisma.service.findFirst).toHaveBeenCalledWith({
        where: { id: 'service-from-salon-2', salonId: 'salon-1' },
      });
      expect(prisma.service.update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates an active service scoped to the salon and maps Decimal price to a number', async () => {
      prisma.service.create.mockResolvedValue({
        id: 'svc-1', name: 'Haircut', durationMinutes: 30,
        price: decimal('300.00'), category: 'Hair', isActive: true,
      });

      const result = await service.create('owner-1', 'salon-1', {
        name: 'Haircut', price: 300, durationMinutes: 30, category: 'Hair',
      });

      expect(prisma.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ salonId: 'salon-1', name: 'Haircut', price: '300', durationMinutes: 30, isActive: true }),
      });
      expect(result).toEqual({
        id: 'svc-1', name: 'Haircut', durationMinutes: 30, price: 300, category: 'Hair', isActive: true, currency: 'INR',
      });
      expect(typeof result.price).toBe('number');
    });

    it('stores a null category when none is supplied', async () => {
      prisma.service.create.mockResolvedValue({
        id: 'svc-1', name: 'Trim', durationMinutes: 15, price: decimal('100'), category: null, isActive: true,
      });
      await service.create('owner-1', 'salon-1', { name: 'Trim', price: 100, durationMinutes: 15 });
      expect(prisma.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ category: null }),
      });
    });
  });

  describe('update / soft delete', () => {
    beforeEach(() => {
      prisma.service.findFirst.mockResolvedValue({ id: 'svc-1', salonId: 'salon-1' });
      prisma.service.update.mockResolvedValue({
        id: 'svc-1', name: 'Haircut', durationMinutes: 30, price: decimal('300'), category: null, isActive: false,
      });
    });

    it('deactivates rather than deleting (Service is FK\'d from bookings/queue history)', async () => {
      const result = await service.update('owner-1', 'salon-1', 'svc-1', { isActive: false });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' }, data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
      // No delete method exists on the service at all.
      expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
    });

    it('only sends the fields actually provided (partial update)', async () => {
      await service.update('owner-1', 'salon-1', 'svc-1', { name: 'Renamed' });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' }, data: { name: 'Renamed' },
      });
    });

    it('serializes an updated price through String() for the Decimal column', async () => {
      await service.update('owner-1', 'salon-1', 'svc-1', { price: 450.5 });
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' }, data: { price: '450.5' },
      });
    });
  });

  it('list returns both active and inactive services so an owner can manage them', async () => {
    prisma.service.findMany.mockResolvedValue([
      { id: 'a', name: 'Active', durationMinutes: 30, price: decimal('300'), category: null, isActive: true },
      { id: 'b', name: 'Retired', durationMinutes: 30, price: decimal('200'), category: null, isActive: false },
    ]);
    const result = await service.list('owner-1', 'salon-1');
    expect(result.map((s) => s.isActive)).toEqual([true, false]);
    expect(prisma.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salonId: 'salon-1' } }),
    );
  });
});

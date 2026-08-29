import { SalonActivationService } from './salon-activation.service';

describe('SalonActivationService', () => {
  let service: SalonActivationService;
  let prisma: {
    salon: { findUnique: jest.Mock; update: jest.Mock };
    service: { count: jest.Mock };
    chair: { count: jest.Mock };
    salonStaff: { count: jest.Mock };
  };
  let salonAccess: { assertOwnerAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      salon: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'salon-1', status: 'PENDING' }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'salon-1', status: 'ACTIVE' }),
      },
      // Default to a fully set-up shop, so each readiness test states only the one thing it
      // removes rather than restating the whole fixture.
      service: { count: jest.fn().mockResolvedValue(1) },
      chair: { count: jest.fn().mockResolvedValue(1) },
      salonStaff: { count: jest.fn().mockResolvedValue(1) },
    };
    salonAccess = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
    service = new SalonActivationService(prisma as never, salonAccess as never);
  });

  it('activates a PENDING salon — the fix that makes a self-registered shop usable', async () => {
    const result = await service.updateStatus('owner-1', 'salon-1', {
      status: 'ACTIVE' as never,
    });
    expect(prisma.salon.update).toHaveBeenCalledWith({
      where: { id: 'salon-1' },
      data: { status: 'ACTIVE' },
    });
    expect(result).toEqual({ id: 'salon-1', status: 'ACTIVE' });
  });

  it('lets an owner pause their own shop (SUSPENDED)', async () => {
    prisma.salon.update.mockResolvedValue({
      id: 'salon-1',
      status: 'SUSPENDED',
    });
    const result = await service.updateStatus('owner-1', 'salon-1', {
      status: 'SUSPENDED' as never,
    });
    expect(result.status).toBe('SUSPENDED');
  });

  it('checks salon access first', async () => {
    await service.updateStatus('owner-1', 'salon-1', {
      status: 'ACTIVE' as never,
    });
    expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
  });

  it('refuses to activate a salon the caller does not own, and writes nothing', async () => {
    salonAccess.assertOwnerAccess.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(
      service.updateStatus('intruder', 'someone-elses-salon', {
        status: 'ACTIVE' as never,
      }),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    expect(prisma.salon.update).not.toHaveBeenCalled();
  });

  it('404s for a salon that does not exist', async () => {
    prisma.salon.findUnique.mockResolvedValue(null);
    await expect(
      service.updateStatus('owner-1', 'missing', { status: 'ACTIVE' as never }),
    ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    expect(prisma.salon.update).not.toHaveBeenCalled();
  });

  // A PENDING shop that opens with nothing set up is a dead end for the customer who finds it:
  // the page loads, but there is no service to pick, no chair to sit in, or nobody to cut hair.
  describe('setup gate on the first opening (PENDING -> ACTIVE)', () => {
    it('rejects activation when there is no active service', async () => {
      prisma.service.count.mockResolvedValue(0);
      await expect(
        service.updateStatus('owner-1', 'salon-1', {
          status: 'ACTIVE' as never,
        }),
      ).rejects.toMatchObject({
        code: 'SALON_SETUP_INCOMPLETE',
        details: {
          hasActiveService: false,
          hasActiveChair: true,
          hasActiveStaff: true,
        },
      });
      expect(prisma.salon.update).not.toHaveBeenCalled();
    });

    it('rejects activation when there is no active chair', async () => {
      prisma.chair.count.mockResolvedValue(0);
      await expect(
        service.updateStatus('owner-1', 'salon-1', {
          status: 'ACTIVE' as never,
        }),
      ).rejects.toMatchObject({
        code: 'SALON_SETUP_INCOMPLETE',
        details: {
          hasActiveService: true,
          hasActiveChair: false,
          hasActiveStaff: true,
        },
      });
      expect(prisma.salon.update).not.toHaveBeenCalled();
    });

    it('rejects activation when there is no active barber', async () => {
      prisma.salonStaff.count.mockResolvedValue(0);
      await expect(
        service.updateStatus('owner-1', 'salon-1', {
          status: 'ACTIVE' as never,
        }),
      ).rejects.toMatchObject({
        code: 'SALON_SETUP_INCOMPLETE',
        details: {
          hasActiveService: true,
          hasActiveChair: true,
          hasActiveStaff: false,
        },
      });
      expect(prisma.salon.update).not.toHaveBeenCalled();
    });

    it('activates when all three are present', async () => {
      const result = await service.updateStatus('owner-1', 'salon-1', {
        status: 'ACTIVE' as never,
      });
      expect(result).toEqual({ id: 'salon-1', status: 'ACTIVE' });
      expect(prisma.salon.update).toHaveBeenCalled();
    });

    it('counts only usable rows — a deactivated service/chair/barber does not satisfy the gate', async () => {
      await service.updateStatus('owner-1', 'salon-1', {
        status: 'ACTIVE' as never,
      });
      expect(prisma.service.count).toHaveBeenCalledWith({
        where: { salonId: 'salon-1', isActive: true },
      });
      expect(prisma.chair.count).toHaveBeenCalledWith({
        where: { salonId: 'salon-1', status: 'ACTIVE' },
      });
      expect(prisma.salonStaff.count).toHaveBeenCalledWith({
        where: { salonId: 'salon-1', status: 'ACTIVE' },
      });
    });

    it('names every missing item in one message, not just the first', async () => {
      prisma.service.count.mockResolvedValue(0);
      prisma.chair.count.mockResolvedValue(0);
      prisma.salonStaff.count.mockResolvedValue(0);
      await expect(
        service.updateStatus('owner-1', 'salon-1', {
          status: 'ACTIVE' as never,
        }),
      ).rejects.toMatchObject({
        message:
          'Complete your shop setup before opening it: add at least one service, one chair and one barber.',
      });
    });

    it('still enforces ownership before running any readiness count', async () => {
      salonAccess.assertOwnerAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.updateStatus('intruder', 'someone-elses-salon', {
          status: 'ACTIVE' as never,
        }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.service.count).not.toHaveBeenCalled();
      expect(prisma.chair.count).not.toHaveBeenCalled();
      expect(prisma.salonStaff.count).not.toHaveBeenCalled();
    });
  });

  // The gate guards the FIRST opening only. Once a shop has traded, its owner keeps full control
  // of pausing and reopening, and losing the last chair never silently closes it.
  describe('the gate does not apply outside PENDING -> ACTIVE', () => {
    it('reopens a SUSPENDED salon even with nothing active — reopening after a pause is not first-time setup', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 'salon-1',
        status: 'SUSPENDED',
      });
      prisma.service.count.mockResolvedValue(0);
      prisma.chair.count.mockResolvedValue(0);
      prisma.salonStaff.count.mockResolvedValue(0);

      const result = await service.updateStatus('owner-1', 'salon-1', {
        status: 'ACTIVE' as never,
      });

      expect(result.status).toBe('ACTIVE');
      expect(prisma.service.count).not.toHaveBeenCalled();
    });

    it('leaves an already-ACTIVE salon unchanged and ungated', async () => {
      prisma.salon.findUnique.mockResolvedValue({
        id: 'salon-1',
        status: 'ACTIVE',
      });
      prisma.service.count.mockResolvedValue(0);
      prisma.chair.count.mockResolvedValue(0);
      prisma.salonStaff.count.mockResolvedValue(0);

      const result = await service.updateStatus('owner-1', 'salon-1', {
        status: 'ACTIVE' as never,
      });

      expect(result.status).toBe('ACTIVE');
      expect(prisma.service.count).not.toHaveBeenCalled();
      expect(prisma.salon.update).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('never gates a PENDING salon being suspended', async () => {
      prisma.service.count.mockResolvedValue(0);
      prisma.salon.update.mockResolvedValue({
        id: 'salon-1',
        status: 'SUSPENDED',
      });

      const result = await service.updateStatus('owner-1', 'salon-1', {
        status: 'SUSPENDED' as never,
      });

      expect(result.status).toBe('SUSPENDED');
      expect(prisma.service.count).not.toHaveBeenCalled();
    });
  });
});

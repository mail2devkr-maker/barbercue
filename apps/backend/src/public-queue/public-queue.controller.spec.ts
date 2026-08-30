import { PublicQueueController } from './public-queue.controller';
import type { AuthenticatedUser } from '@barbercue/shared';

describe('PublicQueueController', () => {
  let controller: PublicQueueController;
  let tokenService: {
    resolveToken: jest.Mock;
    resolveQueueAvailability: jest.Mock;
    getOrCreateToken: jest.Mock;
    buildPublicQueueUrl: jest.Mock;
  };
  let queueService: { joinWalkIn: jest.Mock };
  let salonAccess: { assertAccess: jest.Mock };
  let prisma: {
    service: { findMany: jest.Mock };
    queueEntry: { count: jest.Mock };
    chair: { count: jest.Mock };
    salonStaff: { count: jest.Mock };
  };

  beforeEach(() => {
    tokenService = {
      resolveToken: jest.fn(),
      resolveQueueAvailability: jest.fn(),
      getOrCreateToken: jest.fn(),
      buildPublicQueueUrl: jest.fn(),
    };
    queueService = { joinWalkIn: jest.fn() };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      service: { findMany: jest.fn().mockResolvedValue([]) },
      queueEntry: { count: jest.fn().mockResolvedValue(0) },
      chair: { count: jest.fn().mockResolvedValue(1) },
      salonStaff: { count: jest.fn().mockResolvedValue(1) },
    };
    controller = new PublicQueueController(
      tokenService as never,
      queueService as never,
      salonAccess as never,
      prisma as never,
    );
  });

  function user(id: string): AuthenticatedUser {
    return { id, roles: ['CUSTOMER'] as never };
  }

  describe('getInfo — token resolution & privacy', () => {
    it('throws a generic SALON_NOT_FOUND for an unknown token, with no distinguishing detail', async () => {
      tokenService.resolveToken.mockResolvedValue(null);
      await expect(controller.getInfo('unknown-token')).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });

    it('never includes Salon.id/ownerUserId in the response for a resolved token', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 'internal-uuid', name: 'Fresh Cuts', status: 'ACTIVE', ownerUserId: 'owner-1' });
      tokenService.resolveQueueAvailability.mockReturnValue({ queueAvailable: true, unavailableReason: null });

      const result = await controller.getInfo('valid-token');

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('internal-uuid');
      expect(serialized).not.toContain('owner-1');
      expect(result).toEqual({
        salonName: 'Fresh Cuts',
        queueAvailable: true,
        unavailableReason: null,
        services: [],
        waitingCount: 0,
        estimatedWaitMinutes: null,
      });
    });

    it('reports queueAvailable: false with a distinct reason for a non-ACTIVE salon rather than 404ing', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 's1', name: 'Fresh Cuts', status: 'SUSPENDED' });
      tokenService.resolveQueueAvailability.mockReturnValue({ queueAvailable: false, unavailableReason: 'PAUSED' });

      const result = await controller.getInfo('valid-token');

      expect(result.queueAvailable).toBe(false);
      expect(result.unavailableReason).toBe('PAUSED');
      expect(result.salonName).toBe('Fresh Cuts');
    });

    it('only queries active services for the resolved salon', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 's1', name: 'Fresh Cuts', status: 'ACTIVE' });
      tokenService.resolveQueueAvailability.mockReturnValue({ queueAvailable: true, unavailableReason: null });

      await controller.getInfo('valid-token');

      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { salonId: 's1', isActive: true } }),
      );
    });

    it('derives availability from active staff/chair/service counts, not just salon status', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 's1', name: 'Fresh Cuts', status: 'ACTIVE' });
      prisma.salonStaff.count.mockResolvedValue(0);
      prisma.chair.count.mockResolvedValue(2);
      prisma.service.findMany.mockResolvedValue([{ id: 'sv1', name: 'Haircut', durationMinutes: 30 }]);
      tokenService.resolveQueueAvailability.mockReturnValue({ queueAvailable: false, unavailableReason: 'NO_ACTIVE_STAFF' });

      const result = await controller.getInfo('valid-token');

      expect(tokenService.resolveQueueAvailability).toHaveBeenCalledWith({
        status: 'ACTIVE',
        activeStaffCount: 0,
        activeChairCount: 2,
        activeServiceCount: 1,
      });
      expect(result.unavailableReason).toBe('NO_ACTIVE_STAFF');
    });
  });

  describe('join — salon isolation & queue delegation', () => {
    it('throws SALON_NOT_FOUND for an unknown token and never calls joinWalkIn', async () => {
      tokenService.resolveToken.mockResolvedValue(null);
      await expect(controller.join(user('u1'), 'unknown-token', {})).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
      expect(queueService.joinWalkIn).not.toHaveBeenCalled();
    });

    it('derives the salon ONLY from the token — the request body has no salonId field to manipulate', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 'salon-from-token', name: 'Fresh Cuts', status: 'ACTIVE' });
      queueService.joinWalkIn.mockResolvedValue({ id: 'entry-1' });

      await controller.join(user('u1'), 'tok-for-salon-a', { serviceId: 'svc-1' });

      expect(queueService.joinWalkIn).toHaveBeenCalledWith('u1', 'salon-from-token', 'svc-1', undefined);
    });

    it('passes the authenticated caller\'s own id, never a client-supplied one', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 's1', name: 'Fresh Cuts', status: 'ACTIVE' });
      queueService.joinWalkIn.mockResolvedValue({ id: 'entry-1' });

      await controller.join(user('the-real-caller'), 'tok', {});

      expect(queueService.joinWalkIn).toHaveBeenCalledWith('the-real-caller', 's1', undefined, undefined);
    });

    it('passes preferredStaffId through to joinWalkIn for the individual-waitlist join path (Issue 6)', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 's1', name: 'Fresh Cuts', status: 'ACTIVE' });
      queueService.joinWalkIn.mockResolvedValue({ id: 'entry-1' });

      await controller.join(user('u1'), 'tok', { serviceId: 'svc-1', preferredStaffId: 'st1' });

      expect(queueService.joinWalkIn).toHaveBeenCalledWith('u1', 's1', 'svc-1', 'st1');
    });

    it('delegates to the existing QueueService.joinWalkIn and returns its result unmodified', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 's1', name: 'Fresh Cuts', status: 'ACTIVE' });
      const queueEntry = { id: 'entry-1', tokenNumber: 4 };
      queueService.joinWalkIn.mockResolvedValue(queueEntry);

      await expect(controller.join(user('u1'), 'tok', {})).resolves.toBe(queueEntry);
    });

    it('propagates existing duplicate-active-entry / capacity errors from joinWalkIn unchanged', async () => {
      tokenService.resolveToken.mockResolvedValue({ id: 's1', name: 'Fresh Cuts', status: 'ACTIVE' });
      queueService.joinWalkIn.mockRejectedValue(Object.assign(new Error('already in queue'), { code: 'ALREADY_IN_QUEUE' }));

      await expect(controller.join(user('u1'), 'tok', {})).rejects.toMatchObject({ code: 'ALREADY_IN_QUEUE' });
    });
  });

  describe('getQueueQr — owner authorization', () => {
    it('checks salon access for the calling user before returning anything', async () => {
      tokenService.getOrCreateToken.mockResolvedValue('tok-abc');
      tokenService.buildPublicQueueUrl.mockReturnValue('https://barbercue.example.com/q/tok-abc');

      await controller.getQueueQr(user('owner-1'), 'salon-1');

      expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
    });

    it('propagates SALON_ACCESS_DENIED for an unauthorized caller, never generating/returning a token', async () => {
      salonAccess.assertAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );

      await expect(controller.getQueueQr(user('not-the-owner'), 'someone-elses-salon')).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(tokenService.getOrCreateToken).not.toHaveBeenCalled();
    });

    it('returns the token and a fully-built public URL for an authorized owner', async () => {
      tokenService.getOrCreateToken.mockResolvedValue('tok-abc');
      tokenService.buildPublicQueueUrl.mockReturnValue('https://barbercue.example.com/q/tok-abc');

      const result = await controller.getQueueQr(user('owner-1'), 'salon-1');

      expect(result).toEqual({ publicQueueToken: 'tok-abc', publicQueueUrl: 'https://barbercue.example.com/q/tok-abc' });
    });
  });
});

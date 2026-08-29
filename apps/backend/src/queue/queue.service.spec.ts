import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { QueueEntryStatus, QueueEntrySource } from '@barbercue/shared';
import { QueueService } from './queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { AvailabilityService } from '../bookings/availability.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

function lastCallData(
  mock: jest.Mock<Promise<unknown>, [unknown]>,
): Record<string, unknown> {
  const calls = mock.mock.calls;
  const [call] = calls.slice(-1);
  return (call[0] as { data: Record<string, unknown> }).data;
}

function makeRawEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    salonId: 's1',
    bookingId: null,
    customerId: 'c1',
    serviceId: 'sv1',
    source: QueueEntrySource.WALK_IN,
    tokenNumber: 1,
    status: QueueEntryStatus.WAITING,
    assignedStaffId: null,
    assignedChairId: null,
    joinedAt: new Date(),
    calledAt: null,
    ...overrides,
  };
}

function makeDetailEntry(overrides: Record<string, unknown> = {}) {
  return {
    ...makeRawEntry(),
    service: { name: 'Haircut' },
    customer: { phone: '+919999999999' },
    assignedStaff: null,
    assignedChair: null,
    serviceSessions: [],
    ...overrides,
  };
}

interface PrismaMock {
  queueEntry: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    findUniqueOrThrow: jest.Mock<Promise<unknown>, [unknown]>;
    count: jest.Mock<Promise<number>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  serviceSession: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  chair: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    count: jest.Mock<Promise<number>, [unknown]>;
  };
  salonStaff: {
    count: jest.Mock<Promise<number>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
  };
  service: { aggregate: jest.Mock<Promise<unknown>, [unknown]> };
  booking: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    count: jest.Mock<Promise<number>, [unknown]>;
  };
  $executeRaw: jest.Mock<Promise<unknown>, [unknown]>;
  $transaction: jest.Mock;
}

describe('QueueService', () => {
  let service: QueueService;
  let prisma: PrismaMock;
  let availability: {
    getSalonOrThrow: jest.Mock<Promise<unknown>, [string]>;
    getServiceOrThrow: jest.Mock<Promise<unknown>, [string, string]>;
    assertStaffQualified: jest.Mock<Promise<void>, [string, string, string]>;
    getSlotCapacity: jest.Mock<Promise<number>, [unknown, string, string]>;
  };
  let salonAccess: { assertAccess: jest.Mock<Promise<void>, [string, string]> };
  let realtime: {
    emitQueueUpdated: jest.Mock;
    emitEntryCalled: jest.Mock;
    emitStaffStatusChanged: jest.Mock;
    emitQueueEntryReassigned: jest.Mock;
    emitQueueEntryWaitAlert: jest.Mock;
  };
  let notifications: { notify: jest.Mock<Promise<void>, [string, string, unknown?, string?]> };

  beforeEach(async () => {
    prisma = {
      queueEntry: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        findMany: jest
          .fn<Promise<unknown[]>, [unknown]>()
          .mockResolvedValue([]),
        findUnique: jest.fn<Promise<unknown>, [unknown]>(),
        findUniqueOrThrow: jest.fn<Promise<unknown>, [unknown]>(),
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
        create: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [unknown]>(),
        updateMany: jest
          .fn<Promise<{ count: number }>, [unknown]>()
          .mockResolvedValue({ count: 1 }),
      },
      serviceSession: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        findUnique: jest.fn<Promise<unknown>, [unknown]>(),
        findMany: jest
          .fn<Promise<unknown[]>, [unknown]>()
          .mockResolvedValue([]),
        create: jest.fn<Promise<unknown>, [unknown]>(),
        updateMany: jest
          .fn<Promise<{ count: number }>, [unknown]>()
          .mockResolvedValue({ count: 1 }),
      },
      chair: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        findMany: jest
          .fn<Promise<unknown[]>, [unknown]>()
          .mockResolvedValue([]),
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(4),
      },
      salonStaff: {
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(3),
        findMany: jest
          .fn<Promise<unknown[]>, [unknown]>()
          .mockResolvedValue([]),
        findUnique: jest
          .fn<Promise<unknown>, [unknown]>()
          .mockResolvedValue({ userId: 'staff-user-1' }),
      },
      service: {
        aggregate: jest
          .fn<Promise<unknown>, [unknown]>()
          .mockResolvedValue({ _avg: { durationMinutes: 30 } }),
      },
      booking: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [unknown]>(),
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
      },
      $executeRaw: jest
        .fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue(undefined),
      $transaction: jest.fn(),
    };
    // Same interactive-transaction mock pattern as bookings.service.spec.ts — run the callback
    // against `prisma` itself since every tx.* method the callback touches is mocked directly above.
    prisma.$transaction.mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    );

    availability = {
      getSalonOrThrow: jest
        .fn<Promise<unknown>, [string]>()
        .mockResolvedValue({ id: 's1', status: 'ACTIVE', ownerUserId: 'owner1' }),
      getServiceOrThrow: jest
        .fn<Promise<unknown>, [string, string]>()
        .mockResolvedValue({ id: 'sv1', salonId: 's1' }),
      assertStaffQualified: jest
        .fn<Promise<void>, [string, string, string]>()
        .mockResolvedValue(undefined),
      getSlotCapacity: jest
        .fn<Promise<number>, [unknown, string, string]>()
        .mockResolvedValue(3),
    };
    salonAccess = {
      assertAccess: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
    };
    realtime = {
      emitQueueUpdated: jest.fn(),
      emitEntryCalled: jest.fn(),
      emitStaffStatusChanged: jest.fn(),
      emitQueueEntryReassigned: jest.fn(),
      emitQueueEntryWaitAlert: jest.fn(),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: PrismaService, useValue: prisma },
        { provide: AvailabilityService, useValue: availability },
        { provide: SalonAccessService, useValue: salonAccess },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(QueueService);

    // getDetailOrThrow is called at the end of nearly every mutating method — give it a default
    // resolved entry so each test only needs to override what it specifically cares about.
    prisma.queueEntry.findUnique.mockResolvedValue(makeDetailEntry());
  });

  describe('joinWalkIn', () => {
    it('rejects with ALREADY_IN_QUEUE when the customer already has an active entry', async () => {
      prisma.queueEntry.findFirst.mockResolvedValueOnce(makeRawEntry());
      await expect(service.joinWalkIn('c1', 's1')).rejects.toMatchObject({
        code: 'ALREADY_IN_QUEUE',
      });
      expect(prisma.queueEntry.create).not.toHaveBeenCalled();
    });

    it('assigns the next token number per salon, advisory-locked, from the last entry of the IST day', async () => {
      prisma.queueEntry.findFirst
        .mockResolvedValueOnce(null) // assertNotAlreadyInQueue
        .mockResolvedValueOnce({ tokenNumber: 5 }); // nextTokenNumber's last-entry lookup
      prisma.queueEntry.create.mockResolvedValue({ id: 'q2' });

      await service.joinWalkIn('c1', 's1', 'sv1');

      expect(prisma.$executeRaw).toHaveBeenCalled();
      const data = lastCallData(prisma.queueEntry.create);
      expect(data.tokenNumber).toBe(6);
      expect(data.source).toBe(QueueEntrySource.WALK_IN);
      expect(realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
    });

    it('starts numbering at 1 when no entries exist yet for the salon today', async () => {
      prisma.queueEntry.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.queueEntry.create.mockResolvedValue({ id: 'q3' });

      await service.joinWalkIn('c1', 's1');

      const data = lastCallData(prisma.queueEntry.create);
      expect(data.tokenNumber).toBe(1);
    });
  });

  describe('call', () => {
    it('throws INVALID_QUEUE_TRANSITION when the entry is no longer WAITING (lost race)', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      prisma.queueEntry.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.call('staff1', 'q1')).rejects.toMatchObject({
        code: 'INVALID_QUEUE_TRANSITION',
      });
    });

    it('enforces salon access before calling an entry', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      salonAccess.assertAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(service.call('staff1', 'q1')).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(prisma.queueEntry.updateMany).not.toHaveBeenCalled();
    });

    it('calls a WAITING entry and emits both queue.updated and queue.entry.called', async () => {
      prisma.queueEntry.findUnique
        .mockResolvedValueOnce(makeRawEntry())
        .mockResolvedValueOnce(
          makeDetailEntry({ status: QueueEntryStatus.CALLED }),
        );

      await service.call('staff1', 'q1');

      expect(salonAccess.assertAccess).toHaveBeenCalledWith('staff1', 's1');
      expect(realtime.emitEntryCalled).toHaveBeenCalledWith('s1', 'q1', 'c1');
      expect(realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
    });
  });

  describe('assign', () => {
    const input = { staffId: 'st1', chairId: 'ch1' };

    beforeEach(() => {
      prisma.chair.findFirst.mockResolvedValue({
        id: 'ch1',
        salonId: 's1',
        status: 'ACTIVE',
      });
    });

    it('throws SERVICE_REQUIRED when neither the entry nor the request specifies a service', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(
        makeRawEntry({ serviceId: null }),
      );
      await expect(service.assign('staff1', 'q1', input)).rejects.toMatchObject(
        {
          code: 'SERVICE_REQUIRED',
        },
      );
      expect(availability.assertStaffQualified).not.toHaveBeenCalled();
    });

    it('reuses AvailabilityService.assertStaffQualified for the qualification check', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      await service.assign('staff1', 'q1', input);
      expect(availability.assertStaffQualified).toHaveBeenCalledWith(
        's1',
        'sv1',
        'st1',
      );
    });

    it('throws CHAIR_NOT_FOUND when the chair does not belong to the salon', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      prisma.chair.findFirst.mockResolvedValueOnce(null);
      await expect(service.assign('staff1', 'q1', input)).rejects.toMatchObject(
        {
          code: 'CHAIR_NOT_FOUND',
        },
      );
    });

    it('throws CHAIR_INACTIVE when the chair is not ACTIVE', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      prisma.chair.findFirst.mockResolvedValueOnce({
        id: 'ch1',
        salonId: 's1',
        status: 'INACTIVE',
      });
      await expect(service.assign('staff1', 'q1', input)).rejects.toMatchObject(
        {
          code: 'CHAIR_INACTIVE',
        },
      );
    });

    it('throws INVALID_QUEUE_TRANSITION when the entry is no longer WAITING/CALLED (lost race)', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      prisma.queueEntry.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.assign('staff1', 'q1', input)).rejects.toMatchObject(
        {
          code: 'INVALID_QUEUE_TRANSITION',
        },
      );
      expect(prisma.serviceSession.create).not.toHaveBeenCalled();
    });

    it('maps a P2002 on the staff partial-unique-index to 409 STAFF_ALREADY_OCCUPIED', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      prisma.serviceSession.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['service_session_staff_active_uq'] },
        }),
      );
      await expect(service.assign('staff1', 'q1', input)).rejects.toMatchObject(
        {
          code: 'STAFF_ALREADY_OCCUPIED',
        },
      );
    });

    it('maps a P2002 on the chair partial-unique-index to 409 CHAIR_ALREADY_OCCUPIED', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      prisma.serviceSession.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['service_session_chair_active_uq'] },
        }),
      );
      await expect(service.assign('staff1', 'q1', input)).rejects.toMatchObject(
        {
          code: 'CHAIR_ALREADY_OCCUPIED',
        },
      );
    });

    it('rethrows an unrelated database error unchanged', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      const boom = new Error('connection lost');
      prisma.serviceSession.create.mockRejectedValueOnce(boom);
      await expect(service.assign('staff1', 'q1', input)).rejects.toThrow(
        'connection lost',
      );
    });

    it('creates the ServiceSession and moves the entry to IN_SERVICE on success', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(makeRawEntry());
      await service.assign('staff1', 'q1', input);
      const sessionData = lastCallData(prisma.serviceSession.create);
      expect(sessionData).toMatchObject({
        queueEntryId: 'q1',
        staffId: 'st1',
        chairId: 'ch1',
        serviceId: 'sv1',
        status: 'ACTIVE',
      });
      expect(realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
    });
  });

  describe('reassign', () => {
    const activeEntry = makeRawEntry({
      status: QueueEntryStatus.IN_SERVICE,
      assignedStaffId: 'st1',
      assignedChairId: 'ch1',
      tokenNumber: 42,
      joinedAt: new Date('2026-08-28T05:00:00.000Z'),
    });
    const activeSession = {
      id: 'sess1',
      queueEntryId: 'q1',
      staffId: 'st1',
      chairId: 'ch1',
      serviceId: 'sv1',
      status: 'ACTIVE',
      startedAt: new Date('2026-08-28T05:15:00.000Z'),
    };

    beforeEach(() => {
      prisma.queueEntry.findUnique
        .mockResolvedValueOnce(activeEntry)
        .mockResolvedValue(
          makeDetailEntry({
            ...activeEntry,
            assignedStaffId: 'st2',
            assignedChairId: 'ch2',
          }),
        );
      prisma.serviceSession.findFirst.mockResolvedValue(activeSession);
      prisma.chair.findFirst.mockResolvedValue({
        id: 'ch2',
        salonId: 's1',
        status: 'ACTIVE',
      });
    });

    it('moves barber and chair atomically while preserving token, join time and priority fields', async () => {
      await service.reassign('owner1', 'q1', {
        staffId: 'st2',
        chairId: 'ch2',
      });

      expect(availability.assertStaffQualified).toHaveBeenCalledWith(
        's1',
        'sv1',
        'st2',
      );
      const sessionData = lastCallData(prisma.serviceSession.updateMany);
      expect(sessionData).toEqual({ staffId: 'st2', chairId: 'ch2' });
      const queueData = lastCallData(prisma.queueEntry.updateMany);
      expect(queueData).toEqual({
        assignedStaffId: 'st2',
        assignedChairId: 'ch2',
      });
      expect(queueData).not.toHaveProperty('tokenNumber');
      expect(queueData).not.toHaveProperty('joinedAt');
      expect(queueData).not.toHaveProperty('status');
      expect(queueData).not.toHaveProperty('estimatedWaitMinutes');
      expect(realtime.emitQueueEntryReassigned).toHaveBeenCalledWith(
        's1',
        'q1',
      );
      expect(realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
    });

    it('supports barber-only and chair-only changes without replacing the service session', async () => {
      await service.reassign('owner1', 'q1', { staffId: 'st2' });
      expect(lastCallData(prisma.serviceSession.updateMany)).toEqual({
        staffId: 'st2',
        chairId: 'ch1',
      });
      expect(prisma.serviceSession.create).not.toHaveBeenCalled();

      jest.clearAllMocks();
      prisma.queueEntry.findUnique
        .mockResolvedValueOnce(activeEntry)
        .mockResolvedValue(makeDetailEntry(activeEntry));
      prisma.serviceSession.findFirst.mockResolvedValue(activeSession);
      prisma.chair.findFirst.mockResolvedValue({
        id: 'ch2',
        salonId: 's1',
        status: 'ACTIVE',
      });
      prisma.serviceSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );
      availability.assertStaffQualified.mockResolvedValue(undefined);

      await service.reassign('owner1', 'q1', { chairId: 'ch2' });
      expect(lastCallData(prisma.serviceSession.updateMany)).toEqual({
        staffId: 'st1',
        chairId: 'ch2',
      });
    });

    it('constrains reassignment to active in-service visits with an active session', async () => {
      prisma.queueEntry.findUnique
        .mockReset()
        .mockResolvedValue(makeRawEntry({ status: QueueEntryStatus.CALLED }));
      await expect(
        service.reassign('owner1', 'q1', { staffId: 'st2' }),
      ).rejects.toMatchObject({ code: 'INVALID_QUEUE_TRANSITION' });

      prisma.queueEntry.findUnique.mockReset().mockResolvedValue(activeEntry);
      prisma.serviceSession.findFirst.mockResolvedValue(null);
      await expect(
        service.reassign('owner1', 'q1', { staffId: 'st2' }),
      ).rejects.toMatchObject({ code: 'SERVICE_SESSION_NOT_FOUND' });
    });

    it('maps concurrent staff occupancy to a clear conflict and rolls back the entry update', async () => {
      prisma.serviceSession.updateMany.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: 'service_session_staff_active_uq' },
        }),
      );
      await expect(
        service.reassign('owner1', 'q1', { staffId: 'st2' }),
      ).rejects.toMatchObject({ code: 'STAFF_ALREADY_OCCUPIED' });
      expect(realtime.emitQueueEntryReassigned).not.toHaveBeenCalled();
    });
  });

  describe('completeSession', () => {
    it('throws SERVICE_SESSION_NOT_FOUND when the session does not exist', async () => {
      prisma.serviceSession.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.completeSession('staff1', 'sess1'),
      ).rejects.toMatchObject({ code: 'SERVICE_SESSION_NOT_FOUND' });
    });

    it('marks the Booking COMPLETED when the session traces back to an appointment-sourced entry', async () => {
      prisma.serviceSession.findUnique.mockResolvedValueOnce({
        id: 'sess1',
        queueEntryId: 'q1',
        queueEntry: makeRawEntry({ bookingId: 'b1' }),
      });
      await service.completeSession('staff1', 'sess1');
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('does not touch Booking for a walk-in-sourced entry (no bookingId)', async () => {
      prisma.serviceSession.findUnique.mockResolvedValueOnce({
        id: 'sess1',
        queueEntryId: 'q1',
        queueEntry: makeRawEntry({ bookingId: null }),
      });
      await service.completeSession('staff1', 'sess1');
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('throws INVALID_QUEUE_TRANSITION when the session is no longer ACTIVE (lost race)', async () => {
      prisma.serviceSession.findUnique.mockResolvedValueOnce({
        id: 'sess1',
        queueEntryId: 'q1',
        queueEntry: makeRawEntry(),
      });
      prisma.serviceSession.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.completeSession('staff1', 'sess1'),
      ).rejects.toMatchObject({ code: 'INVALID_QUEUE_TRANSITION' });
      expect(prisma.queueEntry.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelByStaff', () => {
    it("cascades to cancel an IN_SERVICE entry's ACTIVE ServiceSession", async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(
        makeRawEntry({ status: QueueEntryStatus.IN_SERVICE }),
      );
      await service.cancelByStaff('staff1', 'q1');
      expect(prisma.serviceSession.updateMany.mock.calls[0][0]).toMatchObject({
        where: { queueEntryId: 'q1', status: 'ACTIVE' },
      });
      expect(lastCallData(prisma.serviceSession.updateMany).status).toBe(
        'CANCELLED',
      );
    });

    it('throws INVALID_QUEUE_TRANSITION for an entry already in a terminal state', async () => {
      prisma.queueEntry.findUnique.mockResolvedValueOnce(
        makeRawEntry({ status: QueueEntryStatus.COMPLETED }),
      );
      prisma.queueEntry.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.cancelByStaff('staff1', 'q1')).rejects.toMatchObject(
        {
          code: 'INVALID_QUEUE_TRANSITION',
        },
      );
    });
  });

  describe('getDashboardQueue', () => {
    it('enforces salon access (UserRole-based, not SalonStaff-based)', async () => {
      salonAccess.assertAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.getDashboardQueue('outsider', 's1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.queueEntry.findMany).not.toHaveBeenCalled();
    });

    it('assigns 1-based positions only to WAITING entries, in join order', async () => {
      // getDashboardQueue now recomputes ETAs (Phase 5, "don't show a stale estimate") before
      // reading — that's a separate queryEntry.findMany call (WAITING-only, for recomputeEtas)
      // ahead of the actual display fetch below; an empty result makes recomputeEtas a no-op.
      prisma.queueEntry.findMany.mockResolvedValueOnce([]);
      prisma.queueEntry.findMany.mockResolvedValueOnce([
        makeDetailEntry({ id: 'q1', status: QueueEntryStatus.WAITING }),
        makeDetailEntry({ id: 'q2', status: QueueEntryStatus.CALLED }),
        makeDetailEntry({ id: 'q3', status: QueueEntryStatus.WAITING }),
      ]);
      const result = await service.getDashboardQueue('owner1', 's1');
      const positions = Object.fromEntries(
        result.entries.map((e) => [e.id, e.position]),
      );
      expect(positions).toEqual({ q1: 1, q2: null, q3: 2 });
    });
  });

  describe('getQueueStatus (public)', () => {
    it('returns null estimatedWaitMinutes when there are no active staff/chairs', async () => {
      prisma.salonStaff.count.mockResolvedValueOnce(0);
      prisma.chair.count.mockResolvedValueOnce(0);
      const result = await service.getQueueStatus('s1');
      expect(result.estimatedWaitMinutes).toBeNull();
      expect(result.estimatedWaitRangeMinutes).toBeNull();
    });

    it('includes a matching estimatedWaitRangeMinutes whenever a point estimate exists', async () => {
      prisma.salonStaff.count.mockResolvedValueOnce(3);
      prisma.chair.count.mockResolvedValueOnce(4);
      const result = await service.getQueueStatus('s1');
      expect(result.estimatedWaitMinutes).not.toBeNull();
      expect(result.estimatedWaitRangeMinutes).not.toBeNull();
      expect(result.estimatedWaitRangeMinutes!.min).toBeLessThanOrEqual(result.estimatedWaitMinutes!);
      expect(result.estimatedWaitRangeMinutes!.max).toBeGreaterThanOrEqual(result.estimatedWaitMinutes!);
    });
  });

  describe('getActiveForCustomer (Phase 5 — recompute on read)', () => {
    it('returns null when the customer has no active entry', async () => {
      prisma.queueEntry.findFirst.mockResolvedValueOnce(null);
      expect(await service.getActiveForCustomer('c1')).toBeNull();
    });

    it('recomputes ETAs before returning a WAITING entry, not just a stale stored value', async () => {
      prisma.queueEntry.findFirst.mockResolvedValueOnce(
        makeRawEntry({ id: 'q1', salonId: 's1', status: QueueEntryStatus.WAITING }),
      );
      // First findMany call is recomputeEtas' own WAITING-only fetch.
      prisma.queueEntry.findMany.mockResolvedValueOnce([
        makeRawEntry({ id: 'q1', customerId: 'c1', serviceId: null }),
      ]);
      prisma.queueEntry.findUniqueOrThrow.mockResolvedValueOnce(
        makeDetailEntry({ id: 'q1', status: QueueEntryStatus.WAITING }),
      );
      await service.getActiveForCustomer('c1');
      expect(prisma.queueEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q1' } }),
      );
      expect(prisma.queueEntry.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q1' } }),
      );
    });

    it('skips the recompute for a CALLED/IN_SERVICE entry (recomputeEtas only ever touches WAITING rows)', async () => {
      prisma.queueEntry.findFirst.mockResolvedValueOnce(
        makeRawEntry({ id: 'q1', salonId: 's1', status: QueueEntryStatus.IN_SERVICE }),
      );
      prisma.queueEntry.findUniqueOrThrow.mockResolvedValueOnce(
        makeDetailEntry({ id: 'q1', status: QueueEntryStatus.IN_SERVICE }),
      );
      await service.getActiveForCustomer('c1');
      expect(prisma.queueEntry.update).not.toHaveBeenCalled();
    });

    it('includes estimatedWaitRangeMinutes and turnApproaching on the returned entry', async () => {
      prisma.queueEntry.findFirst.mockResolvedValueOnce(
        makeRawEntry({ id: 'q1', salonId: 's1', status: QueueEntryStatus.WAITING }),
      );
      prisma.queueEntry.findMany.mockResolvedValueOnce([]); // recomputeEtas no-op
      prisma.queueEntry.findUniqueOrThrow.mockResolvedValueOnce(
        makeDetailEntry({ id: 'q1', status: QueueEntryStatus.WAITING, estimatedWaitMinutes: 3 }),
      );
      const result = await service.getActiveForCustomer('c1');
      expect(result?.turnApproaching).toBe(true);
      expect(result?.estimatedWaitRangeMinutes).toEqual({ min: 0, max: 8 });
    });
  });

  describe('recomputeEtas — Smart Queue wait alerts (Phase 5)', () => {
    it('emits a wait alert when a customer-linked entry crosses into the turn-approaching window', async () => {
      prisma.queueEntry.findMany.mockResolvedValueOnce([
        makeRawEntry({ id: 'q1', customerId: 'c1', serviceId: null, estimatedWaitMinutes: 20 }),
      ]);
      // Default staffCount(3)/chairCount(4)/activeRemaining(0) with a single WAITING entry (0
      // people ahead) computes eta 0 — well inside the approaching window, down from 20.
      await service.recomputeEtas('s1');
      expect(realtime.emitQueueEntryWaitAlert).toHaveBeenCalledWith('s1', 'c1', 'q1');
    });

    it('does not emit for a walk-in entry with no linked customer account', async () => {
      prisma.queueEntry.findMany.mockResolvedValueOnce([
        makeRawEntry({ id: 'q1', customerId: null, serviceId: null, estimatedWaitMinutes: 20 }),
      ]);
      await service.recomputeEtas('s1');
      expect(realtime.emitQueueEntryWaitAlert).not.toHaveBeenCalled();
    });

    it('does not emit when the estimate is already near its previous value (no new information)', async () => {
      prisma.queueEntry.findMany.mockResolvedValueOnce([
        // Old estimate (3) is already within the approaching window and close to the new one (0).
        makeRawEntry({ id: 'q1', customerId: 'c1', serviceId: null, estimatedWaitMinutes: 3 }),
      ]);
      await service.recomputeEtas('s1');
      expect(realtime.emitQueueEntryWaitAlert).not.toHaveBeenCalled();
    });

    it('emits for a large swing even when the new estimate is outside the approaching window', async () => {
      prisma.queueEntry.findMany.mockResolvedValueOnce([
        makeRawEntry({ id: 'q1', customerId: 'c1', serviceId: null, estimatedWaitMinutes: 5 }),
      ]);
      // A session that just started with a long nominal duration pushes the computed estimate up
      // well past the approaching window and far from the old value (5) — a genuine large swing.
      prisma.serviceSession.findMany.mockResolvedValueOnce([
        { startedAt: new Date(Date.now() - 60_000), service: { durationMinutes: 60 } },
      ]);
      await service.recomputeEtas('s1');
      expect(realtime.emitQueueEntryWaitAlert).toHaveBeenCalledWith('s1', 'c1', 'q1');
    });
  });

  describe('getCapacitySummary (Phase 6 — Owner Capacity Dashboard)', () => {
    it('checks salon access before returning anything', async () => {
      salonAccess.assertAccess.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.getCapacitySummary('outsider', 's1'),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.chair.findMany).not.toHaveBeenCalled();
    });

    it('splits chairs into active/busy/available/maintenance/inactive using ACTIVE service sessions', async () => {
      prisma.chair.findMany.mockResolvedValueOnce([
        { id: 'ch1', status: 'ACTIVE' },
        { id: 'ch2', status: 'ACTIVE' },
        { id: 'ch3', status: 'MAINTENANCE' },
        { id: 'ch4', status: 'INACTIVE' },
      ]);
      prisma.salonStaff.findMany.mockResolvedValueOnce([]);
      prisma.serviceSession.findMany.mockResolvedValueOnce([
        { chairId: 'ch1', staffId: 'st1' },
      ]);

      const result = await service.getCapacitySummary('owner1', 's1');

      expect(result.chairs).toEqual({
        active: 2,
        busy: 1,
        available: 1,
        maintenance: 1,
        inactive: 1,
      });
    });

    it('splits staff into active/busy/available/offDuty using ACTIVE service sessions', async () => {
      prisma.chair.findMany.mockResolvedValueOnce([]);
      prisma.salonStaff.findMany.mockResolvedValueOnce([
        { id: 'st1', status: 'ACTIVE' },
        { id: 'st2', status: 'ACTIVE' },
        { id: 'st3', status: 'INACTIVE' },
      ]);
      prisma.serviceSession.findMany.mockResolvedValueOnce([
        { chairId: 'ch1', staffId: 'st1' },
      ]);

      const result = await service.getCapacitySummary('owner1', 's1');

      expect(result.staff).toEqual({ active: 2, busy: 1, available: 1, offDuty: 1 });
    });

    it('averages only the WAITING entries that already have an estimate', async () => {
      prisma.chair.findMany.mockResolvedValueOnce([]);
      prisma.salonStaff.findMany.mockResolvedValueOnce([]);
      prisma.serviceSession.findMany.mockResolvedValueOnce([]);
      prisma.queueEntry.findMany.mockResolvedValueOnce([
        { estimatedWaitMinutes: 10 },
        { estimatedWaitMinutes: 20 },
        { estimatedWaitMinutes: null },
      ]);

      const result = await service.getCapacitySummary('owner1', 's1');

      expect(result.averageEstimatedWaitMinutes).toBe(15);
    });

    it('reports a null average when no WAITING entry has an estimate yet', async () => {
      prisma.chair.findMany.mockResolvedValueOnce([]);
      prisma.salonStaff.findMany.mockResolvedValueOnce([]);
      prisma.serviceSession.findMany.mockResolvedValueOnce([]);
      prisma.queueEntry.findMany.mockResolvedValueOnce([]);

      const result = await service.getCapacitySummary('owner1', 's1');

      expect(result.averageEstimatedWaitMinutes).toBeNull();
    });

    it('reports currentServices as the count of ACTIVE service sessions', async () => {
      prisma.chair.findMany.mockResolvedValueOnce([]);
      prisma.salonStaff.findMany.mockResolvedValueOnce([]);
      prisma.serviceSession.findMany.mockResolvedValueOnce([
        { chairId: 'ch1', staffId: 'st1' },
        { chairId: 'ch2', staffId: 'st2' },
      ]);

      const result = await service.getCapacitySummary('owner1', 's1');

      expect(result.currentServices).toBe(2);
    });
  });
});

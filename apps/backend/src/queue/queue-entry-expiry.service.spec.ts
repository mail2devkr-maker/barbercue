import { Test } from '@nestjs/testing';
import { QueueEntryExpiryService } from './queue-entry-expiry.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CancellationPolicyService } from '../bookings/cancellation-policy.service';
import { AvailabilityService } from '../bookings/availability.service';
import { QueueService } from './queue.service';
import {
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
} from '../common/timezone/timezone';

// HH:MM in Asia/Kolkata for a given instant — used to build OperatingHours rows whose close time
// is deterministically before/after "now" regardless of when this suite actually runs.
function kolkataTimeStr(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function kolkataDayOfWeek(date: Date): number {
  return zonedDateToDayOfWeek(utcToZonedDateStr(date, 'Asia/Kolkata'));
}

const POLICY = {
  salonId: 's1',
  freeCancellationWindowMinutes: 60,
  lateCancellationChargeType: 'FLAT' as const,
  lateCancellationChargeValue: 0,
  noShowChargeType: 'FLAT' as const,
  noShowChargeValue: 0,
  appointmentArrivalGraceMinutes: 10,
  queueCallResponseGraceMinutes: 3,
};

describe('QueueEntryExpiryService', () => {
  let service: QueueEntryExpiryService;
  let tx: {
    queueEntry: { updateMany: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let prisma: {
    queueEntry: { findMany: jest.Mock };
    operatingHours: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let cancellationPolicy: { getEffectivePolicy: jest.Mock };
  let availability: { getSalonTimeZone: jest.Mock };
  let realtime: {
    emitQueueEntryNoShow: jest.Mock;
    emitQueueEntryExpired: jest.Mock;
    emitQueueUpdated: jest.Mock;
  };
  let queueService: { recomputeEtas: jest.Mock };

  function candidate(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'q1',
      salonId: 's1',
      calledAt: new Date(Date.now() - 5 * 60_000), // called 5 minutes ago
      ...overrides,
    };
  }

  function waitingCandidate(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'q1',
      salonId: 's1',
      joinedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = {
      queueEntry: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      queueEntry: { findMany: jest.fn().mockResolvedValue([]) },
      operatingHours: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    cancellationPolicy = {
      getEffectivePolicy: jest.fn().mockResolvedValue(POLICY),
    };
    availability = {
      getSalonTimeZone: jest.fn().mockResolvedValue('Asia/Kolkata'),
    };
    realtime = {
      emitQueueEntryNoShow: jest.fn(),
      emitQueueEntryExpired: jest.fn(),
      emitQueueUpdated: jest.fn(),
    };
    queueService = { recomputeEtas: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueEntryExpiryService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancellationPolicyService, useValue: cancellationPolicy },
        { provide: AvailabilityService, useValue: availability },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();
    service = moduleRef.get(QueueEntryExpiryService);
  });

  it('queries only CALLED entries', async () => {
    await service.markOverdueNoShows();
    const call = prisma.queueEntry.findMany.mock.calls[0][0] as {
      where: { status: string };
    };
    expect(call.where.status).toBe('CALLED');
  });

  it('skips a candidate whose salon-specific call-response grace period has not yet elapsed', async () => {
    prisma.queueEntry.findMany.mockResolvedValue([
      candidate({ calledAt: new Date(Date.now() - 60_000) }), // only 1 min ago
    ]);
    cancellationPolicy.getEffectivePolicy.mockResolvedValue({
      ...POLICY,
      queueCallResponseGraceMinutes: 3, // needs 3 min — not yet due
    });
    const count = await service.markOverdueNoShows();
    expect(count).toBe(0);
    expect(tx.queueEntry.updateMany).not.toHaveBeenCalled();
  });

  it('marks an overdue entry NO_SHOW via a conditional claim, writes an AuditLog entry, emits the specific event, then recomputes ETAs and emits a general queue-updated refresh once per affected salon', async () => {
    prisma.queueEntry.findMany.mockResolvedValue([candidate()]);
    const count = await service.markOverdueNoShows();
    expect(count).toBe(1);
    expect(tx.queueEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'q1', status: 'CALLED' },
      data: { status: 'NO_SHOW' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        action: 'QUEUE_ENTRY_NO_SHOW',
        entityType: 'QueueEntry',
        entityId: 'q1',
        metadata: { queueCallResponseGraceMinutes: 3 },
      },
    });
    expect(realtime.emitQueueEntryNoShow).toHaveBeenCalledWith('s1', 'q1');
    expect(queueService.recomputeEtas).toHaveBeenCalledWith('s1');
    expect(realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
  });

  it('recomputes ETAs and emits queue-updated once per salon even when multiple entries in that salon expire', async () => {
    prisma.queueEntry.findMany.mockResolvedValue([
      candidate({ id: 'q1' }),
      candidate({ id: 'q2' }),
    ]);
    await service.markOverdueNoShows();
    expect(queueService.recomputeEtas).toHaveBeenCalledTimes(1);
    expect(realtime.emitQueueUpdated).toHaveBeenCalledTimes(1);
  });

  it('re-checks status inside the claim, so a staff member manually resolving it between read and write is silently skipped, not overwritten', async () => {
    prisma.queueEntry.findMany.mockResolvedValue([
      candidate({ id: 'q1' }),
      candidate({ id: 'q2' }),
    ]);
    tx.queueEntry.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const count = await service.markOverdueNoShows();
    expect(count).toBe(1);
    expect(realtime.emitQueueEntryNoShow).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no CALLED entries', async () => {
    prisma.queueEntry.findMany.mockResolvedValue([]);
    const count = await service.markOverdueNoShows();
    expect(count).toBe(0);
    expect(tx.queueEntry.updateMany).not.toHaveBeenCalled();
    expect(queueService.recomputeEtas).not.toHaveBeenCalled();
  });

  describe('markStaleWaitingExpired', () => {
    it('queries only WAITING entries', async () => {
      await service.markStaleWaitingExpired();
      const call = prisma.queueEntry.findMany.mock.calls[0][0] as {
        where: { status: string };
      };
      expect(call.where.status).toBe('WAITING');
    });

    it('skips a WAITING entry that joined earlier today (still within its salon-local join day)', async () => {
      prisma.queueEntry.findMany.mockResolvedValue([
        waitingCandidate({ joinedAt: new Date() }),
      ]);
      const count = await service.markStaleWaitingExpired();
      expect(count).toBe(0);
      expect(tx.queueEntry.updateMany).not.toHaveBeenCalled();
    });

    it('skips a candidate whose salon has no resolvable timezone rather than guessing', async () => {
      availability.getSalonTimeZone.mockResolvedValue(null);
      prisma.queueEntry.findMany.mockResolvedValue([
        waitingCandidate({ joinedAt: new Date(Date.now() - 48 * 60 * 60_000) }),
      ]);
      const count = await service.markStaleWaitingExpired();
      expect(count).toBe(0);
      expect(tx.queueEntry.updateMany).not.toHaveBeenCalled();
    });

    it('marks a WAITING entry whose salon-local join day has ended EXPIRED via a conditional claim, writes an AuditLog entry, emits the specific event, then recomputes ETAs and emits a general queue-updated refresh', async () => {
      prisma.queueEntry.findMany.mockResolvedValue([
        waitingCandidate({ joinedAt: new Date(Date.now() - 48 * 60 * 60_000) }),
      ]);
      const count = await service.markStaleWaitingExpired();
      expect(count).toBe(1);
      expect(tx.queueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'q1', status: 'WAITING' },
        data: { status: 'EXPIRED' },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: null,
          action: 'QUEUE_ENTRY_EXPIRED',
          entityType: 'QueueEntry',
          entityId: 'q1',
        }),
      });
      expect(realtime.emitQueueEntryExpired).toHaveBeenCalledWith('s1', 'q1');
      expect(queueService.recomputeEtas).toHaveBeenCalledWith('s1');
      expect(realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
    });

    it('looks up the salon timezone once per salon, not once per entry', async () => {
      prisma.queueEntry.findMany.mockResolvedValue([
        waitingCandidate({
          id: 'q1',
          joinedAt: new Date(Date.now() - 48 * 60 * 60_000),
        }),
        waitingCandidate({
          id: 'q2',
          joinedAt: new Date(Date.now() - 48 * 60 * 60_000),
        }),
      ]);
      await service.markStaleWaitingExpired();
      expect(availability.getSalonTimeZone).toHaveBeenCalledTimes(1);
    });

    it('re-checks status inside the claim, so a staff member manually resolving it between read and write is silently skipped, not overwritten', async () => {
      prisma.queueEntry.findMany.mockResolvedValue([
        waitingCandidate({
          id: 'q1',
          joinedAt: new Date(Date.now() - 48 * 60 * 60_000),
        }),
        waitingCandidate({
          id: 'q2',
          joinedAt: new Date(Date.now() - 48 * 60 * 60_000),
        }),
      ]);
      tx.queueEntry.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const count = await service.markStaleWaitingExpired();
      expect(count).toBe(1);
      expect(realtime.emitQueueEntryExpired).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there are no WAITING entries', async () => {
      prisma.queueEntry.findMany.mockResolvedValue([]);
      const count = await service.markStaleWaitingExpired();
      expect(count).toBe(0);
      expect(tx.queueEntry.updateMany).not.toHaveBeenCalled();
      expect(queueService.recomputeEtas).not.toHaveBeenCalled();
    });

    // Issue #13 Mission J: a real 06:16 IST walk-in at a 09:00-21:00 shop stayed WAITING and
    // fully actionable all the way to midnight under the old calendar-day-end-only boundary. These
    // pin the shop's own posted close time as the real, earlier boundary when one is configured.
    describe('salon close-time boundary (Mission J)', () => {
      it("does NOT expire a WAITING entry that joined earlier today when today's posted close time has not passed yet", async () => {
        const now = new Date();
        const joinedAt = new Date(now.getTime() - 60_000); // joined 1 minute ago
        const futureClose = kolkataTimeStr(
          new Date(now.getTime() + 60 * 60_000),
        ); // closes in 1h
        prisma.operatingHours.findMany.mockResolvedValue([
          {
            dayOfWeek: kolkataDayOfWeek(now),
            openTime: '09:00',
            closeTime: futureClose,
            isClosed: false,
          },
        ]);
        prisma.queueEntry.findMany.mockResolvedValue([
          waitingCandidate({ joinedAt }),
        ]);
        const count = await service.markStaleWaitingExpired();
        expect(count).toBe(0);
        expect(tx.queueEntry.updateMany).not.toHaveBeenCalled();
      });

      it("expires a WAITING entry that joined earlier today once today's posted close time has passed, even though the calendar day has not ended", async () => {
        const now = new Date();
        const joinedAt = new Date(now.getTime() - 60 * 60_000); // joined 1 hour ago
        const pastClose = kolkataTimeStr(new Date(now.getTime() - 5 * 60_000)); // closed 5 min ago
        prisma.operatingHours.findMany.mockResolvedValue([
          {
            dayOfWeek: kolkataDayOfWeek(now),
            openTime: '09:00',
            closeTime: pastClose,
            isClosed: false,
          },
        ]);
        prisma.queueEntry.findMany.mockResolvedValue([
          waitingCandidate({ joinedAt }),
        ]);
        const count = await service.markStaleWaitingExpired();
        expect(count).toBe(1);
        expect(tx.queueEntry.updateMany).toHaveBeenCalledWith({
          where: { id: 'q1', status: 'WAITING' },
          data: { status: 'EXPIRED' },
        });
      });

      it('falls back to the calendar-day-end boundary when no OperatingHours row exists for the join day', async () => {
        const now = new Date();
        prisma.operatingHours.findMany.mockResolvedValue([]);
        prisma.queueEntry.findMany.mockResolvedValue([
          waitingCandidate({ joinedAt: new Date(now.getTime() - 60_000) }),
        ]);
        const count = await service.markStaleWaitingExpired();
        // Same-day join, no configured hours: falls back to day-end, which hasn't passed yet.
        expect(count).toBe(0);
      });

      it('falls back to the calendar-day-end boundary when the join day is marked isClosed', async () => {
        const now = new Date();
        prisma.operatingHours.findMany.mockResolvedValue([
          {
            dayOfWeek: kolkataDayOfWeek(now),
            openTime: '09:00',
            closeTime: '21:00',
            isClosed: true,
          },
        ]);
        prisma.queueEntry.findMany.mockResolvedValue([
          waitingCandidate({
            joinedAt: new Date(now.getTime() - 48 * 60 * 60_000),
          }),
        ]);
        const count = await service.markStaleWaitingExpired();
        // 48h-old join: even the isClosed row's day has long since ended, so day-end fallback
        // still expires it (proves isClosed doesn't short-circuit to "always active").
        expect(count).toBe(1);
      });

      it('looks up operating hours once per salon, not once per entry', async () => {
        prisma.queueEntry.findMany.mockResolvedValue([
          waitingCandidate({
            id: 'q1',
            joinedAt: new Date(Date.now() - 48 * 60 * 60_000),
          }),
          waitingCandidate({
            id: 'q2',
            joinedAt: new Date(Date.now() - 48 * 60 * 60_000),
          }),
        ]);
        await service.markStaleWaitingExpired();
        expect(prisma.operatingHours.findMany).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('sweep', () => {
    it('runs both the no-show and stale-waiting sweeps', async () => {
      prisma.queueEntry.findMany
        .mockResolvedValueOnce([candidate()])
        .mockResolvedValueOnce([
          waitingCandidate({
            joinedAt: new Date(Date.now() - 48 * 60 * 60_000),
          }),
        ]);
      await service.sweep();
      expect(realtime.emitQueueEntryNoShow).toHaveBeenCalledWith('s1', 'q1');
      expect(realtime.emitQueueEntryExpired).toHaveBeenCalledWith('s1', 'q1');
    });
  });
});

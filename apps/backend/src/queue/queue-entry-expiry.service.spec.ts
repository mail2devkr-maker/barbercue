import { Test } from '@nestjs/testing';
import { QueueEntryExpiryService } from './queue-entry-expiry.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CancellationPolicyService } from '../bookings/cancellation-policy.service';
import { QueueService } from './queue.service';

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
    $transaction: jest.Mock;
  };
  let cancellationPolicy: { getEffectivePolicy: jest.Mock };
  let realtime: { emitQueueEntryNoShow: jest.Mock; emitQueueUpdated: jest.Mock };
  let queueService: { recomputeEtas: jest.Mock };

  function candidate(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'q1',
      salonId: 's1',
      calledAt: new Date(Date.now() - 5 * 60_000), // called 5 minutes ago
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
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    cancellationPolicy = { getEffectivePolicy: jest.fn().mockResolvedValue(POLICY) };
    realtime = { emitQueueEntryNoShow: jest.fn(), emitQueueUpdated: jest.fn() };
    queueService = { recomputeEtas: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueEntryExpiryService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancellationPolicyService, useValue: cancellationPolicy },
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
});

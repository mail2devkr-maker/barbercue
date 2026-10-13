import { QueueAssignmentReleaseService } from './queue-assignment-release.service';

function harness(rows: Array<{ id: string; assignedStaffId: string | null; assignedChairId: string | null }>, claimCounts: number[] = []) {
  const tx = {
    queueEntry: {
      updateMany: jest.fn().mockImplementation(() => Promise.resolve({ count: claimCounts.length ? (claimCounts.shift() as number) : 1 })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    queueEntry: { findMany: jest.fn().mockResolvedValue(rows) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const realtime: any = { emitQueueUpdated: jest.fn() };
  const trigger: any = { trigger: jest.fn() };
  return { service: new QueueAssignmentReleaseService(prisma, realtime, trigger), prisma, tx, realtime, trigger };
}

describe('QueueAssignmentReleaseService', () => {
  it('hands an assigned customer back to WAITING when their barber goes off duty, keeping their place in line', async () => {
    const h = harness([{ id: 'q1', assignedStaffId: 'st1', assignedChairId: 'ch1' }]);
    const released = await h.service.releaseForStaff('s1', 'st1', 'STAFF_OFF_DUTY', 'u1');
    expect(released).toBe(1);
    expect(h.prisma.queueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salonId: 's1', status: 'CALLED', assignedStaffId: 'st1' } }),
    );
    expect(h.tx.queueEntry.updateMany).toHaveBeenCalledWith({
      // a conditional claim: it can never overwrite a service the barber started a moment ago
      where: { id: 'q1', status: 'CALLED', assignedStaffId: 'st1' },
      data: { status: 'WAITING', assignedStaffId: null, assignedChairId: null, assignedAt: null, calledAt: null },
    });
    // joinedAt (queue priority) is never written
    const data = h.tx.queueEntry.updateMany.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('joinedAt');
    expect(h.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'u1',
        action: 'QUEUE_ASSIGNMENT_RELEASED',
        entityId: 'q1',
        metadata: { salonId: 's1', reason: 'STAFF_OFF_DUTY', staffId: 'st1', chairId: 'ch1' },
      }),
    });
    expect(h.realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
    // so the allocator can offer them someone else
    expect(h.trigger.trigger).toHaveBeenCalledWith('s1');
  });

  it('releases by chair when a chair is taken out of use', async () => {
    const h = harness([{ id: 'q2', assignedStaffId: 'st9', assignedChairId: 'ch3' }]);
    expect(await h.service.releaseForChair('s1', 'ch3', 'CHAIR_UNAVAILABLE')).toBe(1);
    expect(h.prisma.queueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salonId: 's1', status: 'CALLED', assignedStaffId: { not: null }, assignedChairId: 'ch3' } }),
    );
  });

  it('does nothing (no events, no allocator run) when nobody was assigned to that barber', async () => {
    const h = harness([]);
    expect(await h.service.releaseForStaff('s1', 'st1', 'STAFF_ACCESS_REVOKED')).toBe(0);
    expect(h.realtime.emitQueueUpdated).not.toHaveBeenCalled();
    expect(h.trigger.trigger).not.toHaveBeenCalled();
  });

  it('skips a customer whose barber started them between the read and the claim', async () => {
    const h = harness([{ id: 'q1', assignedStaffId: 'st1', assignedChairId: 'ch1' }], [0]);
    expect(await h.service.releaseForStaff('s1', 'st1', 'STAFF_OFF_DUTY')).toBe(0);
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
    expect(h.trigger.trigger).not.toHaveBeenCalled();
  });
});

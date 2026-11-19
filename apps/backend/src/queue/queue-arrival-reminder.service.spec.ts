import { QueueArrivalReminderService } from './queue-arrival-reminder.service';

describe('Live Queue T-10 arrival reminders', () => {
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const recomputeEtas = jest.fn().mockResolvedValue(undefined);
  const deliverToUser = jest.fn();
  const emitQueueUpdated = jest.fn();
  const send = jest.fn();
  const service = new QueueArrivalReminderService(
    { queueEntry: { findMany, updateMany } } as never,
    { recomputeEtas } as never,
    { deliverToUser } as never,
    { emitQueueUpdated } as never,
    { send } as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    recomputeEtas.mockResolvedValue(undefined);
    updateMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValueOnce([{ salonId: 'salon-1' }]);
    deliverToUser.mockResolvedValue({ inApp: 'SENT', push: 'SENT' });
  });

  it('claims one eligible queue token and dispatches to owner AND signed-in customer', async () => {
    findMany.mockResolvedValueOnce([{
      id: 'queue-1', salonId: 'salon-1', customerId: 'customer-1',
      guestExpoPushToken: null, tokenNumber: 12, salon: { ownerUserId: 'owner-1' },
    }]);
    await expect(service.sendDueReminders()).resolves.toBe(1);
    expect(recomputeEtas).toHaveBeenCalledWith('salon-1');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'queue-1', arrivalPromptSentAt: null,
        estimatedWaitMinutes: { gte: 0, lte: 10 },
      }),
    }));
    expect(deliverToUser).toHaveBeenCalledTimes(2);
    expect(deliverToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-1' }));
    expect(deliverToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'customer-1' }));
    expect(emitQueueUpdated).toHaveBeenCalledWith('salon-1');
  });

  it('losing a concurrent reminder claim never sends a duplicate', async () => {
    findMany.mockResolvedValueOnce([{
      id: 'queue-1', salonId: 'salon-1', customerId: 'customer-1',
      guestExpoPushToken: null, tokenNumber: 1, salon: { ownerUserId: 'owner-1' },
    }]);
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.sendDueReminders()).resolves.toBe(0);
    expect(deliverToUser).not.toHaveBeenCalled();
  });

  it('sends native guest push only if a token was actually registered', async () => {
    findMany.mockResolvedValueOnce([{
      id: 'guest-1', salonId: 'salon-1', customerId: null,
      guestExpoPushToken: 'ExpoPushToken[DEMO1234567890]',
      tokenNumber: 7, salon: { ownerUserId: 'owner-1' },
    }]);
    send.mockResolvedValue([{ status: 'ok' }]);
    await expect(service.sendDueReminders()).resolves.toBe(1);
    expect(deliverToUser).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([expect.objectContaining({
      data: {
        type: 'queue.arrival_check',
        salonId: 'salon-1',
        queueEntryId: 'guest-1',
        expiresAt: expect.any(String),
      },
      // Live-visit add-on mission: APNs/FCM drop it if the phone is unreachable for 30 minutes.
      expiration: expect.any(Number),
    })]);
    const message = send.mock.calls[0][0][0] as { expiration: number; data: { expiresAt: string } };
    expect(message.expiration * 1000).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(message.expiration * 1000).toBeLessThanOrEqual(Date.now() + 31 * 60_000);
    expect(deliverToUser).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: expect.any(Date) }));
  });
});

describe('Live Queue arrival sweep lets the database sleep (Neon CU, 15 Nov)', () => {
  function build() {
    const findMany = jest.fn();
    let listener: ((reason: string) => void) | null = null;
    const scheduler = { onSignal: jest.fn((fn: (reason: string) => void) => { listener = fn; return () => { listener = null; }; }) };
    const service = new QueueArrivalReminderService(
      { queueEntry: { findMany, updateMany: jest.fn() } } as never,
      { recomputeEtas: jest.fn() } as never,
      { deliverToUser: jest.fn() } as never,
      { emitQueueUpdated: jest.fn() } as never,
      { send: jest.fn() } as never,
      scheduler as never,
    );
    service.onModuleInit();
    return { service, findMany, fire: (reason: string) => listener?.(reason) };
  }

  it('stops querying once nobody is waiting, until a queue change re-arms it', async () => {
    const { service, findMany, fire } = build();
    findMany.mockResolvedValueOnce([]);
    await service.sweep();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(service.isArmed()).toBe(false);

    await service.sweep();
    await service.sweep();
    expect(findMany).toHaveBeenCalledTimes(1);

    fire('queue');
    expect(service.isArmed()).toBe(true);
    findMany.mockResolvedValueOnce([]);
    await service.sweep();
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('re-arms on booking changes and on the reconcile safety tick, not on inventory', () => {
    const { service, fire } = build();
    (service as unknown as { armed: boolean }).armed = false;
    fire('inventory');
    expect(service.isArmed()).toBe(false);
    fire('booking');
    expect(service.isArmed()).toBe(true);
    (service as unknown as { armed: boolean }).armed = false;
    fire('reconcile');
    expect(service.isArmed()).toBe(true);
  });

  it('a join that lands while an empty sweep is in flight is never lost', async () => {
    const { service, findMany, fire } = build();
    findMany.mockImplementationOnce(async () => {
      fire('queue');
      return [];
    });
    await service.sweep();
    expect(service.isArmed()).toBe(true);
  });

  it('keeps sweeping while someone is waiting', async () => {
    const { service, findMany } = build();
    findMany.mockResolvedValueOnce([{ salonId: 'salon-1' }]).mockResolvedValueOnce([]);
    await service.sweep();
    expect(service.isArmed()).toBe(true);
  });
});

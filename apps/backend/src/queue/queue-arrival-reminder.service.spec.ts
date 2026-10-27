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
      data: { type: 'queue.arrival_check', salonId: 'salon-1', queueEntryId: 'guest-1' },
    })]);
  });
});

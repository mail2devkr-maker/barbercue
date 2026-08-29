import { Test } from '@nestjs/testing';
import { RemindersService, REMINDER_WINDOW_MINUTES } from './reminders.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

function makeDueBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    customerId: 'c1',
    salonId: 's1',
    slotStart: new Date(Date.now() + 30 * 60_000),
    salon: { name: 'Demo Salon' },
    service: { name: 'Haircut' },
    ...overrides,
  };
}

describe('RemindersService', () => {
  let service: RemindersService;
  let tx: {
    booking: { updateMany: jest.Mock };
  };
  let prisma: {
    booking: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let notifications: {
    notifyInTransaction: jest.Mock<
      Promise<boolean>,
      [typeof tx, string, string, unknown?, string?]
    >;
  };

  beforeEach(async () => {
    tx = {
      booking: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      booking: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    notifications = {
      notifyInTransaction: jest.fn().mockResolvedValue(true),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(RemindersService);
  });

  it('queries only CONFIRMED/PENDING_PAYMENT bookings with no reminder sent yet', async () => {
    await service.sendDueReminders();
    const call = prisma.booking.findMany.mock.calls[0][0] as {
      where: { status: { in: string[] }; reminderSentAt: null };
    };
    expect(call.where.status.in.sort()).toEqual([
      'CONFIRMED',
      'PENDING_PAYMENT',
    ]);
    expect(call.where.reminderSentAt).toBeNull();
  });

  it('windows the query to slots between the min lead time and the reminder window', async () => {
    await service.sendDueReminders();
    const call = prisma.booking.findMany.mock.calls[0][0] as {
      where: { slotStart: { gte: Date; lt: Date } };
    };
    const spanMinutes =
      (call.where.slotStart.lt.getTime() - call.where.slotStart.gte.getTime()) /
      60_000;
    // Window end is REMINDER_WINDOW_MINUTES from now; window start is a few minutes from now
    // (the minimum lead) — so the span is strictly less than the full window.
    expect(spanMinutes).toBeLessThan(REMINDER_WINDOW_MINUTES);
    expect(spanMinutes).toBeGreaterThan(0);
  });

  it('claims and creates the notification in the same transaction', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([makeDueBooking()]);

    const count = await service.sendDueReminders();

    expect(count).toBe(1);
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'b1',
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
        reminderSentAt: null,
        slotStart: { gte: expect.any(Date), lt: expect.any(Date) },
      },
      data: { reminderSentAt: expect.any(Date) },
    });
    expect(notifications.notifyInTransaction).toHaveBeenCalledWith(
      tx,
      'c1',
      'booking.reminder',
      expect.objectContaining({
        salonName: 'Demo Salon',
        serviceName: 'Haircut',
      }),
      'account/bookings',
    );
  });

  it('does nothing when no booking is due', async () => {
    const count = await service.sendDueReminders();
    expect(count).toBe(0);
    expect(notifications.notifyInTransaction).not.toHaveBeenCalled();
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it('processes multiple due bookings independently', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([
      makeDueBooking({ id: 'b1', customerId: 'c1' }),
      makeDueBooking({ id: 'b2', customerId: 'c2' }),
    ]);
    const count = await service.sendDueReminders();
    expect(count).toBe(2);
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(2);
    expect(tx.booking.updateMany).toHaveBeenCalledTimes(2);
  });

  it('deduplicates overlapping sweeps with a durable conditional claim', async () => {
    prisma.booking.findMany.mockResolvedValue([makeDueBooking()]);
    tx.booking.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const counts = await Promise.all([
      service.sendDueReminders(),
      service.sendDueReminders(),
    ]);

    expect(counts.sort()).toEqual([0, 1]);
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(1);
  });

  it('propagates notification insertion failures so the transactional claim rolls back', async () => {
    prisma.booking.findMany.mockResolvedValue([makeDueBooking()]);
    notifications.notifyInTransaction
      .mockRejectedValueOnce(new Error('notification insert failed'))
      .mockResolvedValueOnce(true);

    await expect(service.sendDueReminders()).rejects.toThrow(
      'notification insert failed',
    );
    await expect(service.sendDueReminders()).resolves.toBe(1);
    expect(tx.booking.updateMany).toHaveBeenCalledTimes(2);
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(2);
  });

  it('respects disabled communication preferences without reporting a sent reminder', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([makeDueBooking()]);
    notifications.notifyInTransaction.mockResolvedValueOnce(false);

    await expect(service.sendDueReminders()).resolves.toBe(0);
    expect(tx.booking.updateMany).toHaveBeenCalledTimes(1);
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(1);
  });
});

import { Test } from '@nestjs/testing';
import {
  RemindersService,
  REMINDER_WINDOW_MINUTES,
} from './reminders.service';
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
  let prisma: {
    booking: { findMany: jest.Mock; update: jest.Mock };
  };
  let notifications: { notify: jest.Mock<Promise<void>, [string, string, unknown?, string?]> };

  beforeEach(async () => {
    prisma = {
      booking: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
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
    expect(call.where.status.in.sort()).toEqual(['CONFIRMED', 'PENDING_PAYMENT']);
    expect(call.where.reminderSentAt).toBeNull();
  });

  it('windows the query to slots between the min lead time and the reminder window', async () => {
    await service.sendDueReminders();
    const call = prisma.booking.findMany.mock.calls[0][0] as {
      where: { slotStart: { gte: Date; lt: Date } };
    };
    const spanMinutes =
      (call.where.slotStart.lt.getTime() - call.where.slotStart.gte.getTime()) / 60_000;
    // Window end is REMINDER_WINDOW_MINUTES from now; window start is a few minutes from now
    // (the minimum lead) — so the span is strictly less than the full window.
    expect(spanMinutes).toBeLessThan(REMINDER_WINDOW_MINUTES);
    expect(spanMinutes).toBeGreaterThan(0);
  });

  it('notifies the customer and marks reminderSentAt for each due booking', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([makeDueBooking()]);

    const count = await service.sendDueReminders();

    expect(count).toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      'c1',
      'booking.reminder',
      expect.objectContaining({ salonName: 'Demo Salon', serviceName: 'Haircut' }),
      'account/bookings',
    );
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { reminderSentAt: expect.any(Date) },
    });
  });

  it('does nothing when no booking is due', async () => {
    const count = await service.sendDueReminders();
    expect(count).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it('processes multiple due bookings independently', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([
      makeDueBooking({ id: 'b1', customerId: 'c1' }),
      makeDueBooking({ id: 'b2', customerId: 'c2' }),
    ]);
    const count = await service.sendDueReminders();
    expect(count).toBe(2);
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(prisma.booking.update).toHaveBeenCalledTimes(2);
  });
});

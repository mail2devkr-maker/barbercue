import { Test } from '@nestjs/testing';
import { RemindersService, REMINDER_WINDOW_MINUTES } from './reminders.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';

function makeDueBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1', customerId: 'c1', salonId: 's1', slotStart: new Date(Date.now() + 10 * 60_000),
    salon: { name: 'Demo Salon' }, serviceId: 'sv1', service: { name: 'Haircut', durationMinutes: 30, price: 300 },
    services: [{ serviceId: 'sv1', serviceName: 'Haircut', durationMinutes: 30, price: 300 }], ...overrides,
  };
}

describe('RemindersService', () => {
  let service: RemindersService;
  let tx: { booking: { updateMany: jest.Mock } };
  let prisma: { booking: { findMany: jest.Mock }; $transaction: jest.Mock };
  let notifications: { notifyInTransaction: jest.Mock };
  let pushDispatch: { dispatchLocalizedToUser: jest.Mock };

  beforeEach(async () => {
    tx = { booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    prisma = { booking: { findMany: jest.fn().mockResolvedValue([]) }, $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) };
    notifications = { notifyInTransaction: jest.fn().mockResolvedValue(true) };
    pushDispatch = { dispatchLocalizedToUser: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({ providers: [
      RemindersService,
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationsService, useValue: notifications },
      { provide: PushDispatchService, useValue: pushDispatch },
    ] }).compile();
    service = moduleRef.get(RemindersService);
  });

  it('queries only future eligible bookings with no reminder sent yet', async () => {
    await service.sendDueReminders();
    const call = prisma.booking.findMany.mock.calls[0][0] as { where: { status: { in: string[] }; reminderSentAt: null; slotStart: { gt: Date; lte: Date } } };
    expect(call.where.status.in.sort()).toEqual(['CONFIRMED', 'PENDING_PAYMENT']);
    expect(call.where.reminderSentAt).toBeNull();
    expect(call.where.slotStart.gt).toBeInstanceOf(Date);
    expect(call.where.slotStart.lte).toBeInstanceOf(Date);
    expect(call.where.slotStart.lte.getTime() - call.where.slotStart.gt.getTime()).toBe(REMINDER_WINDOW_MINUTES * 60_000);
  });

  it('claims, creates the in-app notification, then dispatches one customer push', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([makeDueBooking()]);
    await expect(service.sendDueReminders()).resolves.toBe(1);
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ reminderSentAt: null, slotStart: { gt: expect.any(Date), lte: expect.any(Date) } }), data: { reminderSentAt: expect.any(Date) } }));
    expect(notifications.notifyInTransaction).toHaveBeenCalledWith(tx, 'c1', 'booking.reminder', expect.objectContaining({ salonName: 'Demo Salon', serviceName: 'Haircut' }), 'account/bookings');
    expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledWith('c1', 'bookingReminder', 'Haircut', { type: 'booking.reminder', bookingId: 'b1', salonId: 's1' });
  });

  it('summarizes every selected service and falls back to the primary service snapshot', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([makeDueBooking({ services: [
      { serviceId: 'sv1', serviceName: 'Haircut', durationMinutes: 30, price: 300 },
      { serviceId: 'sv2', serviceName: 'Beard Trim', durationMinutes: 20, price: 150 },
    ] })]);
    await service.sendDueReminders();
    expect(notifications.notifyInTransaction).toHaveBeenCalledWith(expect.anything(), 'c1', 'booking.reminder', expect.objectContaining({ serviceName: 'Haircut + Beard Trim' }), 'account/bookings');
    prisma.booking.findMany.mockResolvedValueOnce([makeDueBooking({ services: [] })]);
    await service.sendDueReminders();
    expect(notifications.notifyInTransaction).toHaveBeenLastCalledWith(expect.anything(), 'c1', 'booking.reminder', expect.objectContaining({ serviceName: 'Haircut' }), 'account/bookings');
  });

  it('excludes cancelled, completed, and no-show bookings through the eligible status query', async () => {
    await expect(service.sendDueReminders()).resolves.toBe(0);
    const where = prisma.booking.findMany.mock.calls[0][0].where;
    expect(where.status.in).not.toEqual(expect.arrayContaining(['CANCELLED', 'COMPLETED', 'NO_SHOW']));
    expect(notifications.notifyInTransaction).not.toHaveBeenCalled();
    expect(pushDispatch.dispatchLocalizedToUser).not.toHaveBeenCalled();
  });

  it('deduplicates overlapping sweeps with the durable conditional claim', async () => {
    prisma.booking.findMany.mockResolvedValue([makeDueBooking()]);
    tx.booking.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const counts = await Promise.all([service.sendDueReminders(), service.sendDueReminders()]);
    expect(counts.sort()).toEqual([0, 1]);
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(1);
    expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(1);
  });

  it('processes multiple due bookings independently', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([
      makeDueBooking({ id: 'b1', customerId: 'c1' }),
      makeDueBooking({ id: 'b2', customerId: 'c2' }),
    ]);
    await expect(service.sendDueReminders()).resolves.toBe(2);
    expect(notifications.notifyInTransaction).toHaveBeenCalledTimes(2);
    expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(2);
  });

  it('uses the exact T-15 boundary and excludes T-16 and already-started slots in the DB predicate', async () => {
    await service.sendDueReminders();
    const { slotStart } = prisma.booking.findMany.mock.calls[0][0].where;
    expect(slotStart.lte.getTime() - slotStart.gt.getTime()).toBe(15 * 60_000);
    expect(slotStart.gt).toBeInstanceOf(Date);
    // Prisma evaluates T-16 (outside lte) and T+0/past (not greater than gt) out of this query.
    expect(slotStart.lte.getTime()).toBeGreaterThan(slotStart.gt.getTime());
  });

  it('keeps the durable claim and dispatches PUSH when IN_APP preference declines the row', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([makeDueBooking()]);
    notifications.notifyInTransaction.mockResolvedValueOnce(false);
    await expect(service.sendDueReminders()).resolves.toBe(1);
    expect(tx.booking.updateMany).toHaveBeenCalledTimes(1);
    expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(1);
  });

  it('rolls the claim back on notification failure so a later sweep can retry', async () => {
    prisma.booking.findMany.mockResolvedValue([makeDueBooking()]);
    notifications.notifyInTransaction.mockRejectedValueOnce(new Error('notification insert failed')).mockResolvedValueOnce(true);
    await expect(service.sendDueReminders()).rejects.toThrow('notification insert failed');
    await expect(service.sendDueReminders()).resolves.toBe(1);
    expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(1);
  });
});

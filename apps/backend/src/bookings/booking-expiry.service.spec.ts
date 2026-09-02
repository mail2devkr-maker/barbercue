import { Test } from '@nestjs/testing';
import {
  BookingExpiryService,
  PAYMENT_HOLD_TIMEOUT_MINUTES,
} from './booking-expiry.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

describe('BookingExpiryService', () => {
  let service: BookingExpiryService;
  let tx: {
    booking: { updateMany: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let prisma: {
    booking: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let realtime: { emitBookingExpired: jest.Mock };
  let notifications: { notifyInTransaction: jest.Mock };

  const candidateBooking = {
    id: 'b1',
    customerId: 'cust-1',
    salonId: 's1',
    salon: { name: 'Salon One', ownerUserId: 'owner-1' },
  };

  beforeEach(async () => {
    tx = {
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    realtime = { emitBookingExpired: jest.fn() };
    notifications = { notifyInTransaction: jest.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingExpiryService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(BookingExpiryService);
  });

  it('queries only PENDING_PAYMENT bookings whose createdAt is past the 10-minute payment-hold timeout', async () => {
    await service.expireOverdueBookings();
    const call = prisma.booking.findMany.mock.calls[0][0] as {
      where: { status: string; createdAt: { lt: Date } };
    };
    expect(call.where.status).toBe('PENDING_PAYMENT');
    const expectedCutoff = Date.now() - PAYMENT_HOLD_TIMEOUT_MINUTES * 60_000;
    expect(call.where.createdAt.lt.getTime()).toBeCloseTo(expectedCutoff, -3);
  });

  it('never touches a CONFIRMED booking — that transition belongs to BookingNoShowService', async () => {
    await service.expireOverdueBookings();
    const call = prisma.booking.findMany.mock.calls[0][0] as {
      where: { status: string };
    };
    expect(call.where.status).not.toBe('CONFIRMED');
  });

  it('transitions each overdue booking to EXPIRED via a conditional updateMany claim, writes an AuditLog entry, notifies customer and owner, and emits realtime', async () => {
    prisma.booking.findMany.mockResolvedValue([candidateBooking]);
    const count = await service.expireOverdueBookings();
    expect(count).toBe(1);
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'b1', status: 'PENDING_PAYMENT' }),
        data: { status: 'EXPIRED' },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        action: 'BOOKING_EXPIRED',
        entityType: 'Booking',
        entityId: 'b1',
        metadata: { paymentHoldTimeoutMinutes: PAYMENT_HOLD_TIMEOUT_MINUTES },
      },
    });
    expect(notifications.notifyInTransaction).toHaveBeenCalledWith(
      tx,
      'cust-1',
      'booking.expired',
      { salonId: 's1' },
      'account/bookings',
    );
    expect(notifications.notifyInTransaction).toHaveBeenCalledWith(
      tx,
      'owner-1',
      'owner.booking.expired',
      { salonId: 's1', bookingId: 'b1' },
      'dashboard/salons/s1/bookings',
    );
    expect(realtime.emitBookingExpired).toHaveBeenCalledWith('s1', 'b1');
  });

  it('re-checks status/createdAt inside the claim, so a booking that was paid/cancelled between read and write is silently skipped, not overwritten', async () => {
    prisma.booking.findMany.mockResolvedValue([
      candidateBooking,
      { ...candidateBooking, id: 'b2' },
    ]);
    tx.booking.updateMany
      .mockResolvedValueOnce({ count: 1 }) // b1: claim succeeds
      .mockResolvedValueOnce({ count: 0 }); // b2: someone else already changed it — claim fails
    const count = await service.expireOverdueBookings();
    expect(count).toBe(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(realtime.emitBookingExpired).toHaveBeenCalledTimes(1);
    expect(realtime.emitBookingExpired).toHaveBeenCalledWith('s1', 'b1');
  });

  it('does nothing when no bookings are overdue', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    const count = await service.expireOverdueBookings();
    expect(count).toBe(0);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(realtime.emitBookingExpired).not.toHaveBeenCalled();
  });
});

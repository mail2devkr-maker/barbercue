import { Test } from '@nestjs/testing';
import {
  BookingExpiryService,
  EXPIRY_GRACE_MINUTES,
} from './booking-expiry.service';
import { PrismaService } from '../prisma/prisma.service';

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
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingExpiryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(BookingExpiryService);
  });

  it('queries only CONFIRMED/PENDING_PAYMENT bookings whose slotEnd is past the grace cutoff', async () => {
    await service.expireOverdueBookings();
    const call = prisma.booking.findMany.mock.calls[0][0] as {
      where: { status: { in: string[] }; slotEnd: { lt: Date } };
    };
    expect(call.where.status.in.sort()).toEqual([
      'CONFIRMED',
      'PENDING_PAYMENT',
    ]);
    const expectedCutoff = Date.now() - EXPIRY_GRACE_MINUTES * 60_000;
    expect(call.where.slotEnd.lt.getTime()).toBeCloseTo(expectedCutoff, -3);
  });

  it('transitions each overdue booking to EXPIRED via a conditional updateMany claim, and writes an AuditLog entry', async () => {
    prisma.booking.findMany.mockResolvedValue([{ id: 'b1' }]);
    const count = await service.expireOverdueBookings();
    expect(count).toBe(1);
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'b1' }),
        data: { status: 'EXPIRED' },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        action: 'BOOKING_EXPIRED',
        entityType: 'Booking',
        entityId: 'b1',
        metadata: { graceMinutes: EXPIRY_GRACE_MINUTES },
      },
    });
  });

  it('re-checks status/slotEnd inside the claim, so a booking cancelled/rescheduled/completed between read and write is silently skipped, not overwritten', async () => {
    prisma.booking.findMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
    tx.booking.updateMany
      .mockResolvedValueOnce({ count: 1 }) // b1: claim succeeds
      .mockResolvedValueOnce({ count: 0 }); // b2: someone else already changed it — claim fails
    const count = await service.expireOverdueBookings();
    expect(count).toBe(1);
    // The failed claim must not still write an audit entry for b2.
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityId: 'b1' }) }),
    );
  });

  it('does nothing when no bookings are overdue', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    const count = await service.expireOverdueBookings();
    expect(count).toBe(0);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

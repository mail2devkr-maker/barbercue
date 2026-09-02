import { Test } from '@nestjs/testing';
import { BookingNoShowService } from './booking-no-show.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CancellationPolicyService } from './cancellation-policy.service';

const FLAT_ZERO_POLICY = {
  salonId: 's1',
  freeCancellationWindowMinutes: 60,
  lateCancellationChargeType: 'FLAT' as const,
  lateCancellationChargeValue: 0,
  noShowChargeType: 'FLAT' as const,
  noShowChargeValue: 0,
  appointmentArrivalGraceMinutes: 10,
  queueCallResponseGraceMinutes: 3,
};

describe('BookingNoShowService', () => {
  let service: BookingNoShowService;
  let tx: {
    booking: { updateMany: jest.Mock };
    customerLedgerEntry: { create: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let prisma: {
    booking: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let cancellationPolicy: { getEffectivePolicy: jest.Mock };
  let realtime: { emitBookingNoShow: jest.Mock };
  let notifications: { notifyInTransaction: jest.Mock };

  function candidate(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'b1',
      salonId: 's1',
      customerId: 'cust-1',
      slotStart: new Date(Date.now() - 20 * 60_000), // 20 minutes ago
      service: { price: 500 },
      salon: { ownerUserId: 'owner-1' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = {
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      customerLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    cancellationPolicy = {
      getEffectivePolicy: jest.fn().mockResolvedValue(FLAT_ZERO_POLICY),
    };
    realtime = { emitBookingNoShow: jest.fn() };
    notifications = { notifyInTransaction: jest.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingNoShowService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancellationPolicyService, useValue: cancellationPolicy },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(BookingNoShowService);
  });

  it('queries only CONFIRMED bookings with no linked queue entry (never checked in) whose slot has already started', async () => {
    await service.markOverdueNoShows();
    const call = prisma.booking.findMany.mock.calls[0][0] as {
      where: {
        status: string;
        slotStart: { lt: Date };
        queueEntries: { none: Record<string, never> };
      };
    };
    expect(call.where.status).toBe('CONFIRMED');
    expect(call.where.queueEntries).toEqual({ none: {} });
    expect(call.where.slotStart.lt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('skips a candidate whose salon-specific grace period has not yet elapsed', async () => {
    prisma.booking.findMany.mockResolvedValue([
      candidate({ slotStart: new Date(Date.now() - 2 * 60_000) }), // only 2 min ago
    ]);
    cancellationPolicy.getEffectivePolicy.mockResolvedValue({
      ...FLAT_ZERO_POLICY,
      appointmentArrivalGraceMinutes: 10, // needs 10 min — not yet due
    });
    const count = await service.markOverdueNoShows();
    expect(count).toBe(0);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it('marks an overdue booking NO_SHOW, writes an AuditLog entry, notifies customer and owner, and emits realtime — no ledger entry when the charge is zero', async () => {
    prisma.booking.findMany.mockResolvedValue([candidate()]);
    const count = await service.markOverdueNoShows();
    expect(count).toBe(1);
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1', status: 'CONFIRMED', queueEntries: { none: {} } },
        data: { status: 'NO_SHOW', cancellationChargeAmount: 0 },
      }),
    );
    expect(tx.customerLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        action: 'BOOKING_NO_SHOW',
        entityType: 'Booking',
        entityId: 'b1',
        metadata: { chargeAmount: 0, appointmentArrivalGraceMinutes: 10 },
      },
    });
    expect(notifications.notifyInTransaction).toHaveBeenCalledWith(
      tx,
      'cust-1',
      'booking.no_show',
      { salonId: 's1' },
      'account/bookings',
    );
    expect(notifications.notifyInTransaction).toHaveBeenCalledWith(
      tx,
      'owner-1',
      'owner.booking.no_show',
      { salonId: 's1', bookingId: 'b1' },
      'dashboard/salons/s1/bookings',
    );
    expect(realtime.emitBookingNoShow).toHaveBeenCalledWith('s1', 'b1');
  });

  it('creates a CustomerLedgerEntry(OUTSTANDING, NO_SHOW_CHARGE) when the policy charges for no-shows', async () => {
    prisma.booking.findMany.mockResolvedValue([candidate()]);
    cancellationPolicy.getEffectivePolicy.mockResolvedValue({
      ...FLAT_ZERO_POLICY,
      noShowChargeType: 'FLAT',
      noShowChargeValue: 200,
    });
    await service.markOverdueNoShows();
    expect(tx.customerLedgerEntry.create).toHaveBeenCalledWith({
      data: {
        customerId: 'cust-1',
        salonId: 's1',
        bookingId: 'b1',
        amount: 200,
        reason: 'NO_SHOW_CHARGE',
        status: 'OUTSTANDING',
      },
    });
  });

  it('looks up the policy once per salon, not once per booking', async () => {
    prisma.booking.findMany.mockResolvedValue([
      candidate({ id: 'b1' }),
      candidate({ id: 'b2' }),
    ]);
    await service.markOverdueNoShows();
    expect(cancellationPolicy.getEffectivePolicy).toHaveBeenCalledTimes(1);
  });

  it('re-checks status/queueEntries inside the claim, so a late check-in between read and write is silently skipped, not overwritten', async () => {
    prisma.booking.findMany.mockResolvedValue([
      candidate({ id: 'b1' }),
      candidate({ id: 'b2' }),
    ]);
    tx.booking.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const count = await service.markOverdueNoShows();
    expect(count).toBe(1);
    expect(realtime.emitBookingNoShow).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no overdue candidates', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    const count = await service.markOverdueNoShows();
    expect(count).toBe(0);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });
});

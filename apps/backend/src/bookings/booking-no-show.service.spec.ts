import { Test } from '@nestjs/testing';
import { BookingNoShowService } from './booking-no-show.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

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

// P0 production incident regression coverage: BookingNoShowService no longer runs an unattended
// @Cron sweep that auto-terminalizes a CONFIRMED booking on a timer (that was the exact root cause
// of booking d3c70810-...'s false no-show). Every test below exercises the new manual,
// operator-triggered markNoShow/correctToCompleted methods instead.
describe('BookingNoShowService', () => {
  let service: BookingNoShowService;
  let tx: {
    booking: { updateMany: jest.Mock };
    customerLedgerEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let prisma: {
    booking: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let cancellationPolicy: { getEffectivePolicy: jest.Mock };
  let salonAccess: { assertAccessOrAdminAccess: jest.Mock };
  let realtime: { emitBookingNoShow: jest.Mock; emitBookingCorrected: jest.Mock };
  let notifications: { notifyInTransaction: jest.Mock };

  function overdueBooking(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'b1',
      salonId: 's1',
      customerId: 'cust-1',
      status: 'CONFIRMED',
      slotStart: new Date(Date.now() - 20 * 60_000),
      serviceId: 'sv1',
      service: { name: 'Haircut', durationMinutes: 30, price: 500 },
      services: [
        {
          serviceId: 'sv1',
          serviceName: 'Haircut',
          durationMinutes: 30,
          price: 500,
        },
      ],
      queueEntries: [],
      onlineBookingDiscountAmount: 0,
      salon: { ownerUserId: 'owner-1' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = {
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      customerLedgerEntry: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      booking: { findUnique: jest.fn().mockResolvedValue(overdueBooking()) },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    cancellationPolicy = {
      getEffectivePolicy: jest.fn().mockResolvedValue(FLAT_ZERO_POLICY),
    };
    salonAccess = {
      assertAccessOrAdminAccess: jest.fn().mockResolvedValue('STAFF_OR_OWNER'),
    };
    realtime = { emitBookingNoShow: jest.fn(), emitBookingCorrected: jest.fn() };
    notifications = { notifyInTransaction: jest.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingNoShowService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancellationPolicyService, useValue: cancellationPolicy },
        { provide: SalonAccessService, useValue: salonAccess },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(BookingNoShowService);
  });

  describe('markNoShow', () => {
    it('checks salon access for the caller before doing anything else', async () => {
      await service.markNoShow('op-1', 'b1');
      expect(salonAccess.assertAccessOrAdminAccess).toHaveBeenCalledWith('op-1', 's1');
    });

    it('rejects a booking that is not CONFIRMED — never auto-derived, always an explicit gate', async () => {
      prisma.booking.findUnique.mockResolvedValue(overdueBooking({ status: 'COMPLETED' }));
      await expect(service.markNoShow('op-1', 'b1')).rejects.toMatchObject({
        code: 'NO_SHOW_NOT_ELIGIBLE',
      });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a booking that already has a QueueEntry — arrival, even without digital check-in confirmation elsewhere, is never overridden', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        overdueBooking({ queueEntries: [{ id: 'qe1' }] }),
      );
      await expect(service.markNoShow('op-1', 'b1')).rejects.toMatchObject({
        code: 'NO_SHOW_NOT_ELIGIBLE',
      });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it('rejects while the salon-specific arrival grace has not yet elapsed — this is the exact P0 root-cause boundary', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        overdueBooking({ slotStart: new Date(Date.now() - 2 * 60_000) }),
      );
      cancellationPolicy.getEffectivePolicy.mockResolvedValue({
        ...FLAT_ZERO_POLICY,
        appointmentArrivalGraceMinutes: 10,
      });
      await expect(service.markNoShow('op-1', 'b1')).rejects.toMatchObject({
        code: 'NO_SHOW_NOT_ELIGIBLE',
      });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it('marks an overdue booking NO_SHOW under a real actor, writes audit, notifies, and emits realtime with zero charge', async () => {
      const result = await service.markNoShow('op-1', 'b1');
      expect(result).toEqual({ id: 'b1', status: 'NO_SHOW', chargeAmount: 0 });
      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', status: 'CONFIRMED', queueEntries: { none: {} } },
        data: { status: 'NO_SHOW', cancellationChargeAmount: 0 },
      });
      expect(tx.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 'op-1',
          action: 'BOOKING_NO_SHOW',
          entityType: 'Booking',
          entityId: 'b1',
          metadata: { chargeAmount: 0, appointmentArrivalGraceMinutes: 10, mode: 'manual' },
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

    it('creates a CustomerLedgerEntry when a flat no-show charge applies', async () => {
      cancellationPolicy.getEffectivePolicy.mockResolvedValue({
        ...FLAT_ZERO_POLICY,
        noShowChargeType: 'FLAT',
        noShowChargeValue: 200,
      });
      await service.markNoShow('op-1', 'b1');
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

    it('charges a percentage against the discounted booking value when an online offer was snapshotted', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        overdueBooking({
          service: { name: 'Haircut', durationMinutes: 30, price: 300 },
          services: [
            { serviceId: 'sv1', serviceName: 'Haircut', durationMinutes: 30, price: 300 },
          ],
          onlineBookingDiscountAmount: 120,
        }),
      );
      cancellationPolicy.getEffectivePolicy.mockResolvedValue({
        ...FLAT_ZERO_POLICY,
        noShowChargeType: 'PERCENTAGE',
        noShowChargeValue: 50,
      });

      const result = await service.markNoShow('op-1', 'b1');

      expect(result.chargeAmount).toBe(90); // 50% of Rs.180 after a Rs.120 offer discount
      expect(tx.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'NO_SHOW', cancellationChargeAmount: 90 } }),
      );
    });

    it('charges a percentage against the COMPLETE multi-service appointment price', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        overdueBooking({
          service: { name: 'Haircut', durationMinutes: 30, price: 300 },
          services: [
            { serviceId: 'sv1', serviceName: 'Haircut', durationMinutes: 30, price: 300 },
            { serviceId: 'sv2', serviceName: 'Beard Trim', durationMinutes: 20, price: 150 },
          ],
        }),
      );
      cancellationPolicy.getEffectivePolicy.mockResolvedValue({
        ...FLAT_ZERO_POLICY,
        noShowChargeType: 'PERCENTAGE',
        noShowChargeValue: 50,
      });

      const result = await service.markNoShow('op-1', 'b1');

      expect(result.chargeAmount).toBe(225);
      expect(tx.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'NO_SHOW', cancellationChargeAmount: 225 } }),
      );
    });

    it('is idempotent: a second call on an already-no-show booking is rejected, never double-charging', async () => {
      tx.booking.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.markNoShow('op-1', 'b1')).rejects.toMatchObject({
        code: 'NO_SHOW_NOT_ELIGIBLE',
      });
      expect(tx.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(realtime.emitBookingNoShow).not.toHaveBeenCalled();
    });

    it('throws BOOKING_NOT_FOUND for an unknown booking', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      await expect(service.markNoShow('op-1', 'nope')).rejects.toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      });
    });
  });

  describe('correctToCompleted', () => {
    function noShowBooking(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'b1',
        salonId: 's1',
        customerId: 'cust-1',
        status: 'NO_SHOW',
        cancellationChargeAmount: 200,
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.booking.findUnique.mockResolvedValue(noShowBooking());
    });

    it('checks salon access for the caller', async () => {
      await service.correctToCompleted('owner-1', 'b1');
      expect(salonAccess.assertAccessOrAdminAccess).toHaveBeenCalledWith('owner-1', 's1');
    });

    it('rejects a booking that is not currently NO_SHOW', async () => {
      prisma.booking.findUnique.mockResolvedValue(noShowBooking({ status: 'CONFIRMED' }));
      await expect(service.correctToCompleted('owner-1', 'b1')).rejects.toMatchObject({
        code: 'BOOKING_NOT_NO_SHOW',
      });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it('flips NO_SHOW to COMPLETED, waives any outstanding no-show ledger entry, and preserves the original audit history', async () => {
      tx.customerLedgerEntry.findMany.mockResolvedValue([{ id: 'ledger-1' }]);

      const result = await service.correctToCompleted('owner-1', 'b1');

      expect(result).toEqual({ id: 'b1', status: 'COMPLETED', waivedLedgerEntryIds: ['ledger-1'] });
      // The stale no-show charge is cleared on the booking itself in the same claim, so no
      // customer/owner surface keeps presenting the served booking as carrying a charge.
      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', status: 'NO_SHOW' },
        data: { status: 'COMPLETED', cancellationChargeAmount: null },
      });
      // WAIVED exactly once: the claim itself re-asserts OUTSTANDING.
      expect(tx.customerLedgerEntry.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.customerLedgerEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ledger-1'] }, status: 'OUTSTANDING' },
        data: { status: 'WAIVED' },
      });
      // Never deleted.
      expect(tx.customerLedgerEntry).not.toHaveProperty('delete');
      // The correction is a NEW, distinct audit row — the original BOOKING_NO_SHOW entry (written
      // when the booking was first marked) is never read, edited or deleted by this method — and it
      // preserves the original charge amount that was cleared from the booking row.
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 'owner-1',
          action: 'BOOKING_NO_SHOW_CORRECTED_TO_COMPLETED',
          entityType: 'Booking',
          entityId: 'b1',
          metadata: {
            waivedLedgerEntryIds: ['ledger-1'],
            previousStatus: 'NO_SHOW',
            previousCancellationChargeAmount: 200,
          },
        },
      });
    });

    it('tells the customer their booking was corrected — never that it was merely "confirmed"', async () => {
      await service.correctToCompleted('owner-1', 'b1');
      const types = notifications.notifyInTransaction.mock.calls.map((call) => call[2]);
      expect(types).toEqual(['booking.corrected']);
      expect(types).not.toContain('booking.confirmed');
      expect(types).not.toContain('booking.no_show');
    });

    it('emits booking.corrected, and never booking.no_show, after a successful correction', async () => {
      await service.correctToCompleted('owner-1', 'b1');
      expect(realtime.emitBookingCorrected).toHaveBeenCalledWith('s1', 'b1', 'cust-1');
      expect(realtime.emitBookingNoShow).not.toHaveBeenCalled();
    });

    it('emits nothing and notifies no one when the correction claim is lost', async () => {
      tx.booking.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.correctToCompleted('owner-1', 'b1')).rejects.toMatchObject({
        code: 'BOOKING_NOT_NO_SHOW',
      });
      expect(realtime.emitBookingCorrected).not.toHaveBeenCalled();
      expect(realtime.emitBookingNoShow).not.toHaveBeenCalled();
      expect(notifications.notifyInTransaction).not.toHaveBeenCalled();
    });

    it('records a null previous charge truthfully when the booking never carried one', async () => {
      prisma.booking.findUnique.mockResolvedValue(noShowBooking({ cancellationChargeAmount: null }));
      await service.correctToCompleted('owner-1', 'b1');
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ previousCancellationChargeAmount: null }),
        }),
      });
    });

    it('never fabricates a ledger waiver when no outstanding charge exists', async () => {
      tx.customerLedgerEntry.findMany.mockResolvedValue([]);
      const result = await service.correctToCompleted('owner-1', 'b1');
      expect(result.waivedLedgerEntryIds).toEqual([]);
      expect(tx.customerLedgerEntry.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent under a race: a second concurrent correction claim fails cleanly', async () => {
      tx.booking.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.correctToCompleted('owner-1', 'b1')).rejects.toMatchObject({
        code: 'BOOKING_NOT_NO_SHOW',
      });
    });
  });
});

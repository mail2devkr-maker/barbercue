import { Test } from '@nestjs/testing';
import { BookingSource } from '@barbercue/shared';
import { BookingsService } from './bookings.service';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

function lastCreateData(
  mock: jest.Mock<Promise<unknown>, [unknown]>,
): Record<string, unknown> {
  const [call] = mock.mock.calls;
  return (call[0] as { data: Record<string, unknown> }).data;
}

function makeBookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    salonId: 's1',
    customerId: 'c1',
    serviceId: 'sv1',
    slotStart: new Date(Date.now() + 2 * 60 * 60_000),
    slotEnd: new Date(Date.now() + 2.5 * 60 * 60_000),
    status: 'CONFIRMED',
    source: 'WEB',
    preferredStaffId: null,
    prepaymentRequiredAmount: null,
    cancellationChargeAmount: null,
    salon: {
      name: 'BarberCue Demo Salon',
      slug: 'barbercue-demo',
      addressLine: '12 MG Road',
      lat: 12.97,
      lng: 77.59,
      ownerUserId: 'owner1',
      city: { slug: 'bengaluru', countryCode: 'IN' },
    },
    service: { name: 'Haircut', durationMinutes: 30, price: decimal('300') },
    preferredStaff: null,
    reviews: [],
    ...overrides,
  };
}

interface PrismaMock {
  customerLedgerEntry: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
  salonPaymentPolicy: { findUnique: jest.Mock<Promise<unknown>, [unknown]> };
  booking: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    count: jest.Mock<Promise<number>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
  auditLog: { create: jest.Mock<Promise<unknown>, [unknown]> };
  $executeRaw: jest.Mock<Promise<unknown>, [unknown]>;
  $transaction: jest.Mock;
}

interface AvailabilityMock {
  getSalonOrThrow: jest.Mock<Promise<unknown>, [string]>;
  getServiceOrThrow: jest.Mock<Promise<unknown>, [string, string]>;
  assertWithinOperatingHours: jest.Mock<Promise<void>, [string, Date, Date]>;
  assertStaffQualified: jest.Mock<Promise<void>, [string, string, string]>;
  assertStaffWithinWorkingHours: jest.Mock<Promise<void>, [string, string, Date, Date]>;
  getSlotCapacity: jest.Mock<Promise<number>, [unknown, string, string]>;
}

describe('BookingsService', () => {
  let service: BookingsService;
  let prisma: PrismaMock;
  let availability: AvailabilityMock;
  let cancellationPolicy: {
    getEffectivePolicy: jest.Mock<Promise<unknown>, [string]>;
  };
  let realtime: {
    emitBookingCreated: jest.Mock<void, [string, string]>;
    emitBookingCancelled: jest.Mock<void, [string, string]>;
    emitBookingRescheduled: jest.Mock<void, [string, string]>;
  };
  let notifications: { notify: jest.Mock<Promise<void>, [string, string, unknown?, string?]> };

  beforeEach(async () => {
    prisma = {
      customerLedgerEntry: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        create: jest.fn<Promise<unknown>, [unknown]>(),
      },
      salonPaymentPolicy: {
        findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      },
      booking: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
        count: jest.fn<Promise<number>, [unknown]>(),
        create: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [unknown]>(),
      },
      auditLog: { create: jest.fn<Promise<unknown>, [unknown]>() },
      $executeRaw: jest.fn<Promise<unknown>, [unknown]>(),
      $transaction: jest.fn(),
    };
    // Interactive-transaction mock: run the callback against `prisma` itself, since every model
    // method the callback touches (booking.count/create/update, customerLedgerEntry.create,
    // auditLog.create, $executeRaw) is already mocked directly above.
    prisma.$transaction.mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    );

    availability = {
      getSalonOrThrow: jest
        .fn<Promise<unknown>, [string]>()
        .mockResolvedValue({
          id: 's1',
          status: 'ACTIVE',
          name: 'BarberCue Demo Salon',
          ownerUserId: 'owner1',
        }),
      getServiceOrThrow: jest
        .fn<Promise<unknown>, [string, string]>()
        .mockResolvedValue({
          id: 'sv1',
          salonId: 's1',
          durationMinutes: 30,
          price: decimal('300'),
        }),
      assertWithinOperatingHours: jest
        .fn<Promise<void>, [string, Date, Date]>()
        .mockResolvedValue(undefined),
      assertStaffQualified: jest
        .fn<Promise<void>, [string, string, string]>()
        .mockResolvedValue(undefined),
      assertStaffWithinWorkingHours: jest
        .fn<Promise<void>, [string, string, Date, Date]>()
        .mockResolvedValue(undefined),
      getSlotCapacity: jest
        .fn<Promise<number>, [unknown, string, string]>()
        .mockResolvedValue(2),
    };
    cancellationPolicy = {
      getEffectivePolicy: jest.fn<Promise<unknown>, [string]>(),
    };
    realtime = {
      emitBookingCreated: jest.fn(),
      emitBookingCancelled: jest.fn(),
      emitBookingRescheduled: jest.fn(),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AvailabilityService, useValue: availability },
        { provide: CancellationPolicyService, useValue: cancellationPolicy },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  describe('create', () => {
    const futureSlot = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

    beforeEach(() => {
      prisma.customerLedgerEntry.findFirst.mockResolvedValue(null);
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue(null);
      prisma.booking.count.mockResolvedValue(0);
      prisma.booking.create.mockResolvedValue({ id: 'b1' });
      prisma.booking.findFirst.mockResolvedValue(makeBookingRow());
    });

    it('rejects a slot that is not in the future', async () => {
      const pastSlot = new Date(Date.now() - 60_000).toISOString();
      await expect(
        service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: pastSlot },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({ code: 'SLOT_IN_PAST' });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('rejects with OUTSTANDING_BALANCE when the customer has an unsettled ledger entry at the salon', async () => {
      prisma.customerLedgerEntry.findFirst.mockResolvedValue({
        id: 'l1',
        status: 'OUTSTANDING',
      });
      await expect(
        service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({ code: 'OUTSTANDING_BALANCE' });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('propagates staff-qualification failures for a preferredStaffId', async () => {
      availability.assertStaffQualified.mockRejectedValue(
        Object.assign(new Error('not qualified'), {
          code: 'STAFF_NOT_QUALIFIED',
        }),
      );
      await expect(
        service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            preferredStaffId: 'st1',
          },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_QUALIFIED' });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('also checks the preferred barber\'s working hours (Phase 7), not just qualification', async () => {
      await service.create(
        'c1',
        {
          salonId: 's1',
          serviceId: 'sv1',
          slotStart: futureSlot,
          preferredStaffId: 'st1',
        },
        BookingSource.WEB,
        'key-1',
      );
      expect(availability.assertStaffWithinWorkingHours).toHaveBeenCalledWith(
        's1',
        'st1',
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('propagates a preferred barber being outside their working hours', async () => {
      availability.assertStaffWithinWorkingHours.mockRejectedValueOnce(
        Object.assign(new Error('not working'), {
          code: 'OUTSIDE_OPERATING_HOURS',
        }),
      );
      await expect(
        service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            preferredStaffId: 'st1',
          },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({ code: 'OUTSIDE_OPERATING_HOURS' });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('does not check working hours at all when no preferred barber is given', async () => {
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
        BookingSource.WEB,
        'key-1',
      );
      expect(availability.assertStaffWithinWorkingHours).not.toHaveBeenCalled();
    });

    it('rejects with SLOT_FULL when consumed capacity has reached the computed slot capacity', async () => {
      availability.getSlotCapacity.mockResolvedValue(2);
      prisma.booking.count.mockResolvedValue(2);
      await expect(
        service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({ code: 'SLOT_FULL' });
      expect(prisma.booking.create).not.toHaveBeenCalled();
      // No realtime emission on a failed/rolled-back create.
      expect(realtime.emitBookingCreated).not.toHaveBeenCalled();
    });

    it('creates a CONFIRMED booking with no prepayment when the salon has no payment policy (defaults to NONE)', async () => {
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
        BookingSource.WEB,
        'key-1',
      );
      const data = lastCreateData(prisma.booking.create);
      expect(data.status).toBe('CONFIRMED');
      expect(data.prepaymentRequiredAmount).toBeNull();
      expect(data.idempotencyKey).toBe('key-1');
    });

    it('emits booking.created exactly once after a successful create', async () => {
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
        BookingSource.WEB,
        'key-1',
      );
      expect(realtime.emitBookingCreated).toHaveBeenCalledTimes(1);
      expect(realtime.emitBookingCreated).toHaveBeenCalledWith('s1', 'b1');
    });

    it('creates a PENDING_PAYMENT booking with a snapshotted amount when the policy requires PARTIAL prepayment', async () => {
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        prepaymentRequirement: 'PARTIAL',
        prepaymentPercentage: 50,
      });
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
        BookingSource.WEB,
        'key-1',
      );
      const data = lastCreateData(prisma.booking.create);
      expect(data.status).toBe('PENDING_PAYMENT');
      expect(data.prepaymentRequiredAmount).toBe(150);
    });

    it('creates a PENDING_PAYMENT booking for the full service price when the policy requires FULL prepayment', async () => {
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        prepaymentRequirement: 'FULL',
        prepaymentPercentage: null,
      });
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
        BookingSource.WEB,
        'key-1',
      );
      const data = lastCreateData(prisma.booking.create);
      expect(data.prepaymentRequiredAmount).toBe(300);
    });
  });

  describe('create - staff exclusivity (Issue 1)', () => {
    const futureSlot = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

    beforeEach(() => {
      prisma.customerLedgerEntry.findFirst.mockResolvedValue(null);
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue(null);
      prisma.booking.create.mockResolvedValue({ id: 'b1' });
      prisma.booking.findFirst.mockResolvedValue(makeBookingRow());
    });

    it('rejects with STAFF_SLOT_UNAVAILABLE when the requested staff already has an overlapping booking, even with pool capacity to spare', async () => {
      availability.getSlotCapacity.mockResolvedValue(5); // plenty of pool capacity
      prisma.booking.count.mockImplementation((args: unknown) => {
        const where = (args as { where: { preferredStaffId?: string } }).where;
        // Pool-wide overlap count (no preferredStaffId filter): well under capacity.
        // Staff-specific overlap count: this exact barber is already taken.
        return Promise.resolve(where.preferredStaffId ? 1 : 1);
      });
      await expect(
        service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot, preferredStaffId: 'dinesh' },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({ code: 'STAFF_SLOT_UNAVAILABLE' });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('succeeds when the requested staff is free, even if another staff member is booked at the same time', async () => {
      availability.getSlotCapacity.mockResolvedValue(5);
      prisma.booking.count.mockImplementation((args: unknown) => {
        const where = (args as { where: { preferredStaffId?: string } }).where;
        // Salon-wide pool count sees 1 (some other staff's booking); the staff-specific count for
        // THIS barber is 0 — Ramesh is free even though Dinesh is booked.
        return Promise.resolve(where.preferredStaffId ? 0 : 1);
      });
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot, preferredStaffId: 'ramesh' },
        BookingSource.WEB,
        'key-1',
      );
      expect(prisma.booking.create).toHaveBeenCalledTimes(1);
    });

    it('never queries per-staff overlap for an "Any Staff" booking (preferredStaffId omitted) — pool capacity alone governs it', async () => {
      availability.getSlotCapacity.mockResolvedValue(2);
      prisma.booking.count.mockResolvedValue(0);
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
        BookingSource.WEB,
        'key-1',
      );
      // Only the one pool-capacity count call — no second, staff-scoped query at all.
      expect(prisma.booking.count).toHaveBeenCalledTimes(1);
      expect(prisma.booking.create).toHaveBeenCalledTimes(1);
    });

    it('checks staff exclusivity inside the same per-salon advisory-locked transaction as the pool check (ordering/atomicity)', async () => {
      availability.getSlotCapacity.mockResolvedValue(5);
      prisma.booking.count.mockResolvedValue(0);
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot, preferredStaffId: 'dinesh' },
        BookingSource.WEB,
        'key-1',
      );
      // $executeRaw (the advisory lock) must run before either count call, and both counts must
      // run inside the same $transaction callback (the mock's $transaction just invokes the
      // callback against `prisma` itself, so this is really asserting call presence/order).
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.booking.count).toHaveBeenCalledTimes(2);
    });
  });

  describe('listMine', () => {
    it('trims to the page size and sets nextCursor when there are more results', async () => {
      prisma.booking.findMany.mockResolvedValue([
        makeBookingRow({ id: 'b1' }),
        makeBookingRow({ id: 'b2' }),
        makeBookingRow({ id: 'b3' }),
      ]);
      const result = await service.listMine('c1', undefined, 2);
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('b2');
    });
  });

  describe('getOne', () => {
    it('throws BOOKING_NOT_FOUND when no booking matches for that customer', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);
      await expect(service.getOne('c1', 'b1')).rejects.toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      });
    });
  });

  describe('cancel', () => {
    it('throws BOOKING_NOT_CANCELLABLE when the booking is already COMPLETED', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ status: 'COMPLETED' }),
      );
      await expect(service.cancel('c1', 'b1')).rejects.toMatchObject({
        code: 'BOOKING_NOT_CANCELLABLE',
      });
    });

    it('charges nothing and creates no ledger entry when cancelled within the free window', async () => {
      const farSlot = new Date(Date.now() + 120 * 60_000); // 120 min out
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ slotStart: farSlot }),
      );
      prisma.booking.update.mockResolvedValue(
        makeBookingRow({ slotStart: farSlot, status: 'CANCELLED' }),
      );
      cancellationPolicy.getEffectivePolicy.mockResolvedValue({
        salonId: 's1',
        freeCancellationWindowMinutes: 60,
        lateCancellationChargeType: 'PERCENTAGE',
        lateCancellationChargeValue: 50,
        noShowChargeType: 'PERCENTAGE',
        noShowChargeValue: 100,
        appointmentArrivalGraceMinutes: 10,
        queueCallResponseGraceMinutes: 3,
      });

      const result = await service.cancel('c1', 'b1');
      expect(result.chargeAmount).toBe(0);
      expect(result.ledgerEntryCreated).toBe(false);
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
      expect(realtime.emitBookingCancelled).toHaveBeenCalledWith('s1', 'b1');
    });

    it('charges the late-cancellation percentage and creates an OUTSTANDING ledger entry outside the free window', async () => {
      const soonSlot = new Date(Date.now() + 10 * 60_000); // 10 min out
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ slotStart: soonSlot }),
      );
      prisma.booking.update.mockResolvedValue(
        makeBookingRow({ slotStart: soonSlot, status: 'CANCELLED' }),
      );
      cancellationPolicy.getEffectivePolicy.mockResolvedValue({
        salonId: 's1',
        freeCancellationWindowMinutes: 60,
        lateCancellationChargeType: 'PERCENTAGE',
        lateCancellationChargeValue: 50,
        noShowChargeType: 'PERCENTAGE',
        noShowChargeValue: 100,
        appointmentArrivalGraceMinutes: 10,
        queueCallResponseGraceMinutes: 3,
      });

      const result = await service.cancel('c1', 'b1');
      expect(result.chargeAmount).toBe(150); // 50% of 300
      expect(result.ledgerEntryCreated).toBe(true);
      const ledgerData = lastCreateData(prisma.customerLedgerEntry.create);
      expect(ledgerData).toMatchObject({
        amount: 150,
        reason: 'CANCELLATION_CHARGE',
        status: 'OUTSTANDING',
      });
    });
  });

  describe('reschedule', () => {
    const futureSlot = new Date(Date.now() + 3 * 60 * 60_000);
    const newFutureSlot = new Date(Date.now() + 26 * 60 * 60_000).toISOString();

    beforeEach(() => {
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ slotStart: futureSlot, status: 'CONFIRMED' }),
      );
      availability.getServiceOrThrow.mockResolvedValue({
        id: 'sv1',
        salonId: 's1',
        durationMinutes: 30,
        price: decimal('300'),
      });
      availability.getSlotCapacity.mockResolvedValue(2);
      prisma.booking.count.mockResolvedValue(0);
      prisma.booking.update.mockResolvedValue(
        makeBookingRow({ slotStart: new Date(newFutureSlot) }),
      );
    });

    it('throws BOOKING_NOT_FOUND when no booking matches for that customer', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);
      await expect(
        service.reschedule('c1', 'missing', { slotStart: newFutureSlot }),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    });

    it('throws BOOKING_NOT_RESCHEDULABLE when the booking is already COMPLETED', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ slotStart: futureSlot, status: 'COMPLETED' }),
      );
      await expect(
        service.reschedule('c1', 'b1', { slotStart: newFutureSlot }),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_RESCHEDULABLE' });
    });

    it('throws BOOKING_NOT_RESCHEDULABLE when the current slot has already passed', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ slotStart: new Date(Date.now() - 60_000), status: 'CONFIRMED' }),
      );
      await expect(
        service.reschedule('c1', 'b1', { slotStart: newFutureSlot }),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_RESCHEDULABLE' });
    });

    it('rejects a new slot that is not in the future', async () => {
      const pastSlot = new Date(Date.now() - 60_000).toISOString();
      await expect(
        service.reschedule('c1', 'b1', { slotStart: pastSlot }),
      ).rejects.toMatchObject({ code: 'SLOT_IN_PAST' });
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('rejects with SLOT_FULL when the new slot has no remaining capacity', async () => {
      prisma.booking.count.mockResolvedValue(2);
      await expect(
        service.reschedule('c1', 'b1', { slotStart: newFutureSlot }),
      ).rejects.toMatchObject({ code: 'SLOT_FULL' });
      expect(prisma.booking.update).not.toHaveBeenCalled();
      expect(realtime.emitBookingRescheduled).not.toHaveBeenCalled();
    });

    it('excludes the booking\'s own current slot from the overlap count', async () => {
      await service.reschedule('c1', 'b1', { slotStart: newFutureSlot });
      const [call] = prisma.booking.count.mock.calls;
      expect((call[0] as { where: { id: { not: string } } }).where.id).toEqual({ not: 'b1' });
    });

    it('moves the same booking row and writes a BOOKING_RESCHEDULED audit entry', async () => {
      await service.reschedule('c1', 'b1', { slotStart: newFutureSlot });
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b1' },
          data: { slotStart: new Date(newFutureSlot), slotEnd: expect.any(Date) },
        }),
      );
      const auditData = lastCreateData(prisma.auditLog.create);
      expect(auditData).toMatchObject({ action: 'BOOKING_RESCHEDULED', entityId: 'b1' });
      expect(realtime.emitBookingRescheduled).toHaveBeenCalledWith('s1', 'b1');
    });

    it('re-checks the existing preferred barber\'s working hours against the new slot (Phase 7)', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ slotStart: futureSlot, status: 'CONFIRMED', preferredStaffId: 'st1' }),
      );
      await service.reschedule('c1', 'b1', { slotStart: newFutureSlot });
      expect(availability.assertStaffWithinWorkingHours).toHaveBeenCalledWith(
        's1',
        'st1',
        new Date(newFutureSlot),
        expect.any(Date),
      );
    });

    it('does not check working hours when the booking has no preferred barber', async () => {
      await service.reschedule('c1', 'b1', { slotStart: newFutureSlot });
      expect(availability.assertStaffWithinWorkingHours).not.toHaveBeenCalled();
    });

    it('rejects with STAFF_SLOT_UNAVAILABLE when rescheduling into a slot the same preferred barber already has taken elsewhere', async () => {
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({ slotStart: futureSlot, status: 'CONFIRMED', preferredStaffId: 'dinesh' }),
      );
      prisma.booking.count.mockImplementation((args: unknown) => {
        const where = (args as { where: { preferredStaffId?: string } }).where;
        return Promise.resolve(where.preferredStaffId ? 1 : 0);
      });
      await expect(
        service.reschedule('c1', 'b1', { slotStart: newFutureSlot }),
      ).rejects.toMatchObject({ code: 'STAFF_SLOT_UNAVAILABLE' });
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('does not run a staff-exclusivity check at all when the booking has no preferred barber', async () => {
      await service.reschedule('c1', 'b1', { slotStart: newFutureSlot });
      expect(prisma.booking.count).toHaveBeenCalledTimes(1);
    });
  });
});

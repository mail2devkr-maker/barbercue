import { Test } from '@nestjs/testing';
import { BookingSource } from '@barbercue/shared';
import { BookingsService } from './bookings.service';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';
import { QueueService } from '../queue/queue.service';
import { CustomerCreditsService } from '../credits/customer-credits.service';

// A payment QR configured by default so every pre-existing test (about prepayment/slot/staff
// logic, not about credits/QR at all) keeps passing unchanged — BookingErrorCode.PAYMENT_QR_
// REQUIRED is exercised by its own dedicated tests below, which explicitly set this back to null.
const PAYMENT_POLICY_WITH_QR = {
  paymentQrImageUrl: 'https://cdn.example.com/salon-qr.png',
};

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
    creditsRedeemedAmount: null,
    // Part 5 completion (arrival guidance) — a normal booking's snapshot, so every existing test
    // that doesn't care about arrival guidance still exercises the real derivation path (rather
    // than the "no snapshot" null case) unless it explicitly overrides these.
    checkInOpensMinutesBefore: 15,
    checkInDueGraceMinutes: 10,
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
    queueEntries: [],
    ...overrides,
  };
}

interface PrismaMock {
  customerLedgerEntry: {
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
  salonPaymentPolicy: { findUnique: jest.Mock<Promise<unknown>, [unknown]> };
  booking: {
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    count: jest.Mock<Promise<number>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
  queueEntry: { updateMany: jest.Mock<Promise<{ count: number }>, [unknown]> };
  auditLog: { create: jest.Mock<Promise<unknown>, [unknown]> };
  platformShopSubsidyEntry: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  $executeRaw: jest.Mock<Promise<unknown>, [unknown]>;
  $transaction: jest.Mock;
}

interface AvailabilityMock {
  getSalonOrThrow: jest.Mock<Promise<unknown>, [string]>;
  getServiceOrThrow: jest.Mock<Promise<unknown>, [string, string]>;
  assertWithinOperatingHours: jest.Mock<Promise<void>, [string, Date, Date]>;
  assertStaffQualified: jest.Mock<Promise<void>, [string, string, string]>;
  assertStaffWithinWorkingHours: jest.Mock<
    Promise<void>,
    [string, string, Date, Date]
  >;
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
    emitQueueUpdated: jest.Mock<void, [string]>;
  };
  let notifications: {
    notify: jest.Mock<Promise<void>, [string, string, unknown?, string?]>;
  };
  let pushDispatch: {
    dispatchToUser: jest.Mock<Promise<void>, [string, unknown]>;
    dispatchLocalizedToUser: jest.Mock<Promise<void>, [string, string, string | null, Record<string, unknown>]>;
  };
  let queueService: {
    recomputeEtas: jest.Mock<Promise<void>, [string]>;
  };
  let credits: {
    computeMaxRedeemable: jest.Mock<number, [unknown]>;
    redeemUpTo: jest.Mock<
      Promise<{ actualUsedPaise: number; fastQueFundedConsumedPaise: number }>,
      [unknown, string, string, number, number]
    >;
    restoreForCancelledBooking: jest.Mock<
      Promise<void>,
      [unknown, string, string, number]
    >;
  };

  beforeEach(async () => {
    prisma = {
      customerLedgerEntry: {
        findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
        create: jest.fn<Promise<unknown>, [unknown]>(),
      },
      salonPaymentPolicy: {
        findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      },
      booking: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        // Part 11 regression fix: cancel() re-checks status inside its transaction (via a fresh
        // findUnique, guarded by an advisory lock) to close a double-cancel/double-restore race.
        // Defaults to "still cancellable" so every pre-existing cancel() test — which only ever set
        // up the OUTER findFirst — keeps passing; the one test exercising the race explicitly
        // overrides this to a terminal status instead.
        findUnique: jest
          .fn<Promise<unknown>, [unknown]>()
          .mockResolvedValue({ status: 'CONFIRMED' }),
        findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
        count: jest.fn<Promise<number>, [unknown]>(),
        create: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [unknown]>(),
      },
      queueEntry: {
        updateMany: jest.fn<Promise<{ count: number }>, [unknown]>().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn<Promise<unknown>, [unknown]>() },
      platformShopSubsidyEntry: {
        create: jest.fn<Promise<unknown>, [unknown]>(),
        updateMany: jest
          .fn<Promise<{ count: number }>, [unknown]>()
          .mockResolvedValue({ count: 0 }),
      },
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
      getSalonOrThrow: jest.fn<Promise<unknown>, [string]>().mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        name: 'BarberCue Demo Salon',
        ownerUserId: 'owner1',
        currency: 'INR',
      }),
      getServiceOrThrow: jest
        .fn<Promise<unknown>, [string, string]>()
        .mockResolvedValue({
          id: 'sv1',
          salonId: 's1',
          name: 'Haircut',
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
      // Part 5 completion (arrival guidance): create() now also calls getEffectivePolicy to
      // snapshot appointmentArrivalGraceMinutes onto the new booking, so every create() test needs
      // a sane default here too, not just the cancel()-path tests that override it explicitly below.
      getEffectivePolicy: jest.fn<Promise<unknown>, [string]>().mockResolvedValue({
        freeCancellationWindowMinutes: 60,
        lateCancellationChargeType: 'PERCENTAGE',
        lateCancellationChargeValue: 50,
        noShowChargeType: 'PERCENTAGE',
        noShowChargeValue: 100,
        appointmentArrivalGraceMinutes: 10,
        queueCallResponseGraceMinutes: 3,
      }),
    };
    realtime = {
      emitBookingCreated: jest.fn(),
      emitBookingCancelled: jest.fn(),
      emitBookingRescheduled: jest.fn(),
      emitQueueUpdated: jest.fn(),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    pushDispatch = {
      dispatchToUser: jest.fn().mockResolvedValue(undefined),
      dispatchLocalizedToUser: jest.fn().mockResolvedValue(undefined),
    };
    queueService = { recomputeEtas: jest.fn().mockResolvedValue(undefined) };
    credits = {
      // Part 11 precision hardening: the real method now takes the service's Decimal (or a
      // decimal()-shaped fixture) rather than a plain rupee number — this mock mirrors that via
      // .toString(), same as the real implementation's own decimalStringToPaise(price.toString()).
      computeMaxRedeemable: jest.fn(
        (price: unknown) => Math.floor(Number((price as { toString(): string }).toString()) / 50) * 10,
      ),
      // Default: behaves as if the customer always has enough balance — clamps only to the
      // price-based cap, mirroring the real service's own min(requested, balance, cap) with an
      // effectively infinite balance. Individual tests override this to exercise real clamping.
      // Returns paise (the real method's contract post-Part-11) even though requested/max here are
      // still rupee numbers, matching real callers.
      redeemUpTo: jest
        .fn()
        .mockImplementation(
          (
            _tx: unknown,
            _customerId: string,
            _bookingId: string,
            requested: number,
            max: number,
          ) =>
            Promise.resolve({
              actualUsedPaise: Math.min(requested, max) * 100,
              fastQueFundedConsumedPaise: Math.min(requested, max) * 100,
            }),
        ),
      restoreForCancelledBooking: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AvailabilityService, useValue: availability },
        { provide: CancellationPolicyService, useValue: cancellationPolicy },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: NotificationsService, useValue: notifications },
        { provide: PushDispatchService, useValue: pushDispatch },
        { provide: QueueService, useValue: queueService },
        { provide: CustomerCreditsService, useValue: credits },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  describe('create', () => {
    const futureSlot = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

    beforeEach(() => {
      prisma.customerLedgerEntry.findMany.mockResolvedValue([]);
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue(
        PAYMENT_POLICY_WITH_QR,
      );
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

    it('rejects with OUTSTANDING_BALANCE and a real amount/reason when the customer has a single unsettled ledger entry at the salon', async () => {
      prisma.customerLedgerEntry.findMany.mockResolvedValue([
        { amount: decimal('150'), reason: 'NO_SHOW_CHARGE' },
      ]);
      await expect(
        service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({
        code: 'OUTSTANDING_BALANCE',
        message: expect.stringContaining('no-show due'),
        details: {
          totalOutstandingAmount: 150,
          entries: [{ reason: 'NO_SHOW_CHARGE', amount: 150 }],
        },
      });
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('rejects with OUTSTANDING_BALANCE using the total amount when the customer has multiple unsettled ledger entries', async () => {
      prisma.customerLedgerEntry.findMany.mockResolvedValue([
        { amount: decimal('150'), reason: 'NO_SHOW_CHARGE' },
        { amount: decimal('75'), reason: 'CANCELLATION_CHARGE' },
      ]);
      await expect(
        service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
          BookingSource.WEB,
          'key-1',
        ),
      ).rejects.toMatchObject({
        code: 'OUTSTANDING_BALANCE',
        message: expect.stringContaining('225'),
        details: { totalOutstandingAmount: 225 },
      });
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

    it("also checks the preferred barber's working hours (Phase 7), not just qualification", async () => {
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
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            preferredStaffId: 'dinesh',
          },
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
        {
          salonId: 's1',
          serviceId: 'sv1',
          slotStart: futureSlot,
          preferredStaffId: 'ramesh',
        },
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
        {
          salonId: 's1',
          serviceId: 'sv1',
          slotStart: futureSlot,
          preferredStaffId: 'dinesh',
        },
        BookingSource.WEB,
        'key-1',
      );
      // $executeRaw (the advisory lock) must run before either count call, and both counts must
      // run inside the same $transaction callback (the mock's $transaction just invokes the
      // callback against `prisma` itself, so this is really asserting call presence/order).
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.booking.count).toHaveBeenCalledTimes(2);
    });

    it('creates a CONFIRMED booking with no prepayment when the payment policy has no prepaymentRequirement configured (defaults to NONE)', async () => {
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

    it('dispatches a localized push to the salon owner exactly once after a successful create, with an ids-only data payload (no customer PII)', async () => {
      await service.create(
        'c1',
        { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
        BookingSource.WEB,
        'key-1',
      );
      expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(1);
      const [userId, kind, serviceName, data] = pushDispatch.dispatchLocalizedToUser.mock.calls[0] as [
        string,
        string,
        string | null,
        Record<string, unknown>,
      ];
      expect(userId).toBe('owner1');
      expect(kind).toBe('newBooking');
      expect(serviceName).toBeTruthy();
      expect(JSON.stringify({ userId, serviceName, data })).not.toMatch(/c1|customer|phone|email/i);
      expect(data).toEqual({
        type: 'booking.created',
        salonId: 's1',
        bookingId: 'b1',
      });
    });

    it('creates a PENDING_PAYMENT booking with a snapshotted amount when the policy requires PARTIAL prepayment', async () => {
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        ...PAYMENT_POLICY_WITH_QR,
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
        ...PAYMENT_POLICY_WITH_QR,
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

    describe('payment QR gate (FastQue Credits / Wallet V1)', () => {
      it('rejects PAYMENT_QR_REQUIRED for an ONLINE (WEB) booking when the salon has no payment QR configured', async () => {
        prisma.salonPaymentPolicy.findUnique.mockResolvedValue(null);
        await expect(
          service.create(
            'c1',
            { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
            BookingSource.WEB,
            'key-1',
          ),
        ).rejects.toMatchObject({ code: 'PAYMENT_QR_REQUIRED' });
        expect(prisma.booking.create).not.toHaveBeenCalled();
      });

      it('rejects PAYMENT_QR_REQUIRED for an ONLINE (APP) booking when the salon has a payment policy row but no QR image set on it', async () => {
        prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
          paymentQrImageUrl: null,
        });
        await expect(
          service.create(
            'c1',
            { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
            BookingSource.APP,
            'key-1',
          ),
        ).rejects.toMatchObject({ code: 'PAYMENT_QR_REQUIRED' });
      });

      it('never gates a WALK_IN booking on the payment QR — that customer pays the shop in person', async () => {
        prisma.salonPaymentPolicy.findUnique.mockResolvedValue(null);
        await service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
          BookingSource.WALK_IN,
          'key-1',
        );
        expect(prisma.booking.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('credit redemption (FastQue Credits / Wallet V1)', () => {
      // Corrected design (post-review): the server never trusts the client-requested
      // creditsToRedeem, and redemption never rejects for "too much requested" — it always
      // clamps to min(requested, live balance, price-based cap), where the cap itself
      // (floor(price/50)*10) is exhaustively tested against the frozen table in
      // customer-credits.service.spec.ts. This file only tests that BookingsService correctly
      // WIRES that up: computes the cap from its own server-trusted price (never the client's),
      // passes it to redeemUpTo, and snapshots the ACTUAL amount CustomerCreditsService returns
      // — never the raw request.

      it('computes maxCreditsAllowed from the server-trusted service price and passes it to redeemUpTo, never trusting the client amount directly', async () => {
        await service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            creditsToRedeem: 9999,
          },
          BookingSource.WEB,
          'key-1',
        );
        // service.price is 300 in this suite's fixture -> cap is floor(300/50)*10 = 60. Part 11:
        // the real call now passes the Decimal itself (never Number(price)) — this fixture's
        // decimal() helper is a { toString() } stand-in, so assert on that rather than identity.
        expect(String(credits.computeMaxRedeemable.mock.calls[0][0])).toBe('300');
        expect(credits.redeemUpTo).toHaveBeenCalledWith(
          prisma,
          'c1',
          'b1',
          9999,
          60,
        );
      });

      it('snapshots creditsRedeemedAmount as the ACTUAL amount CustomerCreditsService applied, not the raw request', async () => {
        // Part 11: redeemUpTo's contract is now paise (2000 paise = Rs.20), and the write below
        // goes straight from paise to a Decimal string, never through a rupee float.
        credits.redeemUpTo.mockResolvedValueOnce({
          actualUsedPaise: 2000,
          fastQueFundedConsumedPaise: 2000,
        });
        await service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            creditsToRedeem: 9999, // far more than the customer could ever actually redeem
          },
          BookingSource.WEB,
          'key-1',
        );
        expect(prisma.booking.update).toHaveBeenCalledWith({
          where: { id: 'b1' },
          data: { creditsRedeemedAmount: '20.00' },
        });
      });

      it('creates a subsidy entry for exactly fastQueFundedConsumed, never the full actualUsed once a future SHOP_FUNDED credit exists', async () => {
        credits.redeemUpTo.mockResolvedValueOnce({
          actualUsedPaise: 3000,
          fastQueFundedConsumedPaise: 1200, // e.g. partly drawn from a hypothetical SHOP_FUNDED lot
        });
        await service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            creditsToRedeem: 30,
          },
          BookingSource.WEB,
          'key-1',
        );
        expect(prisma.platformShopSubsidyEntry.create).toHaveBeenCalledWith({
          data: {
            salonId: 's1',
            bookingId: 'b1',
            amount: '12.00',
            status: 'OUTSTANDING',
          },
        });
      });

      it('creates no subsidy entry at all when fastQueFundedConsumed is 0 (e.g. entirely shop-funded credit)', async () => {
        credits.redeemUpTo.mockResolvedValueOnce({
          actualUsedPaise: 3000,
          fastQueFundedConsumedPaise: 0,
        });
        await service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            creditsToRedeem: 30,
          },
          BookingSource.WEB,
          'key-1',
        );
        expect(prisma.platformShopSubsidyEntry.create).not.toHaveBeenCalled();
      });

      it('never snapshots creditsRedeemedAmount or writes a subsidy entry when actualUsed is 0 (e.g. zero balance)', async () => {
        credits.redeemUpTo.mockResolvedValueOnce({
          actualUsedPaise: 0,
          fastQueFundedConsumedPaise: 0,
        });
        await service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            creditsToRedeem: 30,
          },
          BookingSource.WEB,
          'key-1',
        );
        expect(prisma.booking.update).not.toHaveBeenCalled();
        expect(prisma.platformShopSubsidyEntry.create).not.toHaveBeenCalled();
      });

      // Part 11 precision hardening — the payable invariant (servicePrice = payableAmount +
      // creditsRedeemed) for a fractional price at the exact cap boundary. The returned DTO's
      // payableAmount must be exactly 65.99, never 65.98999999999999 or 66.00.
      it('service Rs.75.99, redeems the max Rs.10.00 cap -> returned payableAmount is exactly Rs.65.99', async () => {
        credits.redeemUpTo.mockResolvedValueOnce({
          actualUsedPaise: 1000,
          fastQueFundedConsumedPaise: 1000,
        });
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({
            service: { name: 'Haircut', durationMinutes: 30, price: decimal('75.99') },
            creditsRedeemedAmount: '10.00',
          }),
        );
        const result = await service.create(
          'c1',
          {
            salonId: 's1',
            serviceId: 'sv1',
            slotStart: futureSlot,
            creditsToRedeem: 10,
          },
          BookingSource.WEB,
          'key-1',
        );
        expect(result.servicePrice).toBe(75.99);
        expect(result.creditsRedeemedAmount).toBe(10);
        expect(result.payableAmount).toBe(65.99);
      });

      it('never calls into credits at all when creditsToRedeem is omitted', async () => {
        await service.create(
          'c1',
          { salonId: 's1', serviceId: 'sv1', slotStart: futureSlot },
          BookingSource.WEB,
          'key-1',
        );
        expect(credits.redeemUpTo).not.toHaveBeenCalled();
        expect(prisma.platformShopSubsidyEntry.create).not.toHaveBeenCalled();
        const data = lastCreateData(prisma.booking.create);
        expect(data.creditsRedeemedAmount).toBeUndefined();
      });
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

    // Part 5 (show arrival time after booking) — every client must format slotStart/slotEnd
    // through this field instead of the device's own timezone.
    describe('salonTimezone', () => {
      it('uses the salon\'s explicit timezone when set', async () => {
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({
            salon: {
              name: 'BarberCue Demo Salon',
              slug: 'barbercue-demo',
              addressLine: '12 MG Road',
              lat: 12.97,
              lng: 77.59,
              ownerUserId: 'owner1',
              timezone: 'America/Chicago',
              city: { slug: 'dallas', countryCode: 'US' },
            },
          }),
        );
        const result = await service.getOne('c1', 'b1');
        expect(result.salonTimezone).toBe('America/Chicago');
      });

      it('falls back to Asia/Kolkata for an India salon with no explicit timezone', async () => {
        prisma.booking.findFirst.mockResolvedValue(makeBookingRow());
        const result = await service.getOne('c1', 'b1');
        expect(result.salonTimezone).toBe('Asia/Kolkata');
      });

      it('is null rather than guessed for a non-India salon with no explicit timezone', async () => {
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({
            salon: {
              name: 'BarberCue Demo Salon',
              slug: 'barbercue-demo',
              addressLine: '12 MG Road',
              lat: null,
              lng: null,
              ownerUserId: 'owner1',
              timezone: null,
              city: { slug: 'some-us-city', countryCode: 'US' },
            },
          }),
        );
        const result = await service.getOne('c1', 'b1');
        expect(result.salonTimezone).toBeNull();
      });
    });

    // Part 5 completion (arrival guidance) — derived from the booking's own snapshotted
    // checkInOpensMinutesBefore/checkInDueGraceMinutes, never a live policy lookup.
    describe('arrival guidance', () => {
      it('derives checkInOpensAt/checkInDueBy for a normal CONFIRMED booking from its snapshot', async () => {
        const slotStart = new Date('2026-06-15T16:00:00.000Z');
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({
            slotStart,
            status: 'CONFIRMED',
            checkInOpensMinutesBefore: 15,
            checkInDueGraceMinutes: 10,
          }),
        );
        const result = await service.getOne('c1', 'b1');
        expect(result.checkInOpensAt).toBe('2026-06-15T15:45:00.000Z');
        expect(result.checkInDueBy).toBe('2026-06-15T16:10:00.000Z');
      });

      it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW'])(
        'shows no arrival guidance for a resolved %s booking',
        async (status) => {
          prisma.booking.findFirst.mockResolvedValue(makeBookingRow({ status }));
          const result = await service.getOne('c1', 'b1');
          expect(result.checkInOpensAt).toBeNull();
          expect(result.checkInDueBy).toBeNull();
        },
      );

      it('shows no arrival guidance once the customer has already checked in', async () => {
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({ queueEntries: [{ id: 'qe1' }] }),
        );
        const result = await service.getOne('c1', 'b1');
        expect(result.checkInOpensAt).toBeNull();
        expect(result.checkInDueBy).toBeNull();
      });

      it('shows no fabricated arrival guidance for a booking with no recorded snapshot (pre-feature history)', async () => {
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({ checkInOpensMinutesBefore: null, checkInDueGraceMinutes: null }),
        );
        const result = await service.getOne('c1', 'b1');
        expect(result.checkInOpensAt).toBeNull();
        expect(result.checkInDueBy).toBeNull();
      });

      it('still derives guidance for a PENDING_PAYMENT booking', async () => {
        prisma.booking.findFirst.mockResolvedValue(makeBookingRow({ status: 'PENDING_PAYMENT' }));
        const result = await service.getOne('c1', 'b1');
        expect(result.checkInOpensAt).not.toBeNull();
        expect(result.checkInDueBy).not.toBeNull();
      });

      // WALK_IN bookings (staff-created, still a real scheduled slot — distinct from a queue-only
      // walk-in join, which never produces a Booking at all) reuse the exact same DTO and
      // derivation, with no special-casing.
      it('derives guidance identically for a WALK_IN-sourced booking', async () => {
        prisma.booking.findFirst.mockResolvedValue(makeBookingRow({ source: 'WALK_IN' }));
        const result = await service.getOne('c1', 'b1');
        expect(result.checkInOpensAt).not.toBeNull();
        expect(result.checkInDueBy).not.toBeNull();
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

    // Build 9 physical-device regression: cancellation previously dispatched NO push at all (only
    // creation did), so a backgrounded/terminated owner had no way to learn of a cancellation
    // except reopening the app — this closes that asymmetry.
    it('dispatches a localized push to the salon owner after a successful cancellation, with an ids-only data payload', async () => {
      const farSlot = new Date(Date.now() + 120 * 60_000);
      prisma.booking.findFirst.mockResolvedValue(makeBookingRow({ slotStart: farSlot }));
      prisma.booking.update.mockResolvedValue(makeBookingRow({ slotStart: farSlot, status: 'CANCELLED' }));
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

      await service.cancel('c1', 'b1');

      expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledTimes(1);
      const [userId, kind, serviceName, data] = pushDispatch.dispatchLocalizedToUser.mock.calls[0] as [
        string,
        string,
        string | null,
        Record<string, unknown>,
      ];
      expect(userId).toBe('owner1');
      expect(kind).toBe('bookingCancelled');
      expect(serviceName).toBeTruthy();
      expect(JSON.stringify({ userId, serviceName, data })).not.toMatch(/c1|customer|phone|email/i);
      expect(data).toEqual({ type: 'booking.cancelled', salonId: 's1', bookingId: 'b1' });
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

    // Issue 3 (mobile stabilization mission) — a checked-in booking has a linked QueueEntry that
    // must not outlive the booking's own cancellation.
    describe('credit restoration (FastQue Credits / Wallet V1)', () => {
      beforeEach(() => {
        const farSlot = new Date(Date.now() + 120 * 60_000);
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
        prisma.booking.update.mockResolvedValue(
          makeBookingRow({ slotStart: farSlot, status: 'CANCELLED' }),
        );
      });

      it('restores exactly the snapshotted amount and voids the matching subsidy entry when a booking that redeemed credits is cancelled', async () => {
        const farSlot = new Date(Date.now() + 120 * 60_000);
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({ slotStart: farSlot, creditsRedeemedAmount: 30 }),
        );
        await service.cancel('c1', 'b1');
        // Part 11: cancel() now converts the Decimal snapshot to exact integer paise (30 rupees ->
        // 3000 paise) before calling restoreForCancelledBooking, never via Number(decimal).
        expect(credits.restoreForCancelledBooking).toHaveBeenCalledWith(
          prisma,
          'c1',
          'b1',
          3000,
        );
        expect(prisma.platformShopSubsidyEntry.updateMany).toHaveBeenCalledWith({
          where: { bookingId: 'b1', status: 'OUTSTANDING' },
          data: { status: 'VOIDED', voidedAt: expect.any(Date) },
        });
      });

      it('never touches credits or the subsidy ledger when the cancelled booking redeemed nothing', async () => {
        const farSlot = new Date(Date.now() + 120 * 60_000);
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({ slotStart: farSlot, creditsRedeemedAmount: null }),
        );
        await service.cancel('c1', 'b1');
        expect(credits.restoreForCancelledBooking).not.toHaveBeenCalled();
        expect(prisma.platformShopSubsidyEntry.updateMany).not.toHaveBeenCalled();
      });

      // Part 11 (FastQue Credits regression audit): the pre-transaction findFirst status check is
      // only a fast-path/UX check. Two concurrent cancel() calls for the same booking could both
      // pass it before either commits — without the in-transaction re-check this fix adds, the
      // second caller would silently re-cancel an already-cancelled booking and double-restore
      // credits / double-create a cancellation-charge ledger entry. Simulated here by having the
      // fresh in-transaction read (findUnique, behind the advisory lock) report a status the
      // outer/pre-transaction read never saw.
      it('rejects and performs no money-moving side effects when the in-transaction status re-check finds the booking already cancelled (double-cancel race guard)', async () => {
        const farSlot = new Date(Date.now() + 120 * 60_000);
        prisma.booking.findFirst.mockResolvedValue(
          makeBookingRow({ slotStart: farSlot, creditsRedeemedAmount: 30, status: 'CONFIRMED' }),
        );
        prisma.booking.findUnique.mockResolvedValue({ status: 'CANCELLED' });

        await expect(service.cancel('c1', 'b1')).rejects.toMatchObject({
          code: 'BOOKING_NOT_CANCELLABLE',
        });
        expect(prisma.booking.update).not.toHaveBeenCalled();
        expect(credits.restoreForCancelledBooking).not.toHaveBeenCalled();
        expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
        expect(prisma.platformShopSubsidyEntry.updateMany).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
      });
    });

    describe('linked queue entry cleanup', () => {
      beforeEach(() => {
        const farSlot = new Date(Date.now() + 120 * 60_000);
        prisma.booking.findFirst.mockResolvedValue(makeBookingRow({ slotStart: farSlot }));
        prisma.booking.update.mockResolvedValue(makeBookingRow({ slotStart: farSlot, status: 'CANCELLED' }));
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
      });

      it('1. cancels a linked WAITING queue entry and recomputes ETAs', async () => {
        prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
        await service.cancel('c1', 'b1');
        expect(prisma.queueEntry.updateMany).toHaveBeenCalledWith({
          where: { bookingId: 'b1', status: { in: ['WAITING', 'CALLED'] } },
          data: { status: 'CANCELLED' },
        });
        expect(queueService.recomputeEtas).toHaveBeenCalledWith('s1');
        expect(realtime.emitQueueUpdated).toHaveBeenCalledWith('s1');
      });

      it('2. cancels a linked CALLED (not-yet-started) queue entry', async () => {
        // The where clause itself is the eligibility check — a CALLED row matches the same
        // `status: { in: ['WAITING', 'CALLED'] }` filter regardless of which of the two it is.
        prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
        await service.cancel('c1', 'b1');
        expect(queueService.recomputeEtas).toHaveBeenCalledWith('s1');
      });

      it('4. does not touch an IN_SERVICE linked queue entry: the where clause excludes it, so 0 rows match and no recompute fires', async () => {
        // updateMany's own WHERE (status IN WAITING/CALLED) is what protects an IN_SERVICE row —
        // simulated here by the claim finding nothing to update, exactly what Postgres would do.
        prisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
        await service.cancel('c1', 'b1');
        expect(queueService.recomputeEtas).not.toHaveBeenCalled();
        expect(realtime.emitQueueUpdated).not.toHaveBeenCalled();
      });

      it('5. an unrelated WALK_IN entry can never match: the query is scoped to this exact bookingId', async () => {
        await service.cancel('c1', 'b1');
        const call = prisma.queueEntry.updateMany.mock.calls[0][0] as { where: { bookingId: string } };
        expect(call.where.bookingId).toBe('b1');
      });

      it('6. a retried cancel is idempotent: the second call finds nothing left to claim and skips the recompute', async () => {
        prisma.queueEntry.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
        await service.cancel('c1', 'b1');
        expect(queueService.recomputeEtas).toHaveBeenCalledTimes(1);
        await service.cancel('c1', 'b1');
        expect(queueService.recomputeEtas).toHaveBeenCalledTimes(1);
      });

      it('does not recompute ETAs or emit queue.updated when the booking had no linked queue entry at all', async () => {
        prisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
        await service.cancel('c1', 'b1');
        expect(queueService.recomputeEtas).not.toHaveBeenCalled();
        expect(realtime.emitQueueUpdated).not.toHaveBeenCalled();
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
        makeBookingRow({
          slotStart: new Date(Date.now() - 60_000),
          status: 'CONFIRMED',
        }),
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

    it("excludes the booking's own current slot from the overlap count", async () => {
      await service.reschedule('c1', 'b1', { slotStart: newFutureSlot });
      const [call] = prisma.booking.count.mock.calls;
      expect((call[0] as { where: { id: { not: string } } }).where.id).toEqual({
        not: 'b1',
      });
    });

    it('moves the same booking row and writes a BOOKING_RESCHEDULED audit entry', async () => {
      await service.reschedule('c1', 'b1', { slotStart: newFutureSlot });
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b1' },
          data: {
            slotStart: new Date(newFutureSlot),
            slotEnd: expect.any(Date),
          },
        }),
      );
      const auditData = lastCreateData(prisma.auditLog.create);
      expect(auditData).toMatchObject({
        action: 'BOOKING_RESCHEDULED',
        entityId: 'b1',
      });
      expect(realtime.emitBookingRescheduled).toHaveBeenCalledWith('s1', 'b1');
    });

    it("re-checks the existing preferred barber's working hours against the new slot (Phase 7)", async () => {
      prisma.booking.findFirst.mockResolvedValue(
        makeBookingRow({
          slotStart: futureSlot,
          status: 'CONFIRMED',
          preferredStaffId: 'st1',
        }),
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
        makeBookingRow({
          slotStart: futureSlot,
          status: 'CONFIRMED',
          preferredStaffId: 'dinesh',
        }),
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

import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Boots the full AppModule against the live Neon database (same pattern as
 * test/discovery.e2e-spec.ts) — the Phase 2.1 seed's demo salon (bengaluru/barbercue-demo) has 3
 * ACTIVE staff, 4 ACTIVE chairs, no StaffService rows (so all 3 staff qualify for every service)
 * and no salon-specific SalonPaymentPolicy/CancellationPolicy (so bookings go straight to
 * CONFIRMED and cancellation falls back to the seeded platform-default policy — exactly what this
 * suite exercises).
 *
 * Access tokens are minted with the real TokenService (the exact code path AuthService uses),
 * against real seeded user ids — not hand-rolled JWTs — so these tests exercise the genuine
 * JwtStrategy/RolesGuard chain, not a stand-in.
 */
describe('Bookings (e2e, live database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;

  let salonId: string;
  let haircutServiceId: string;
  let customerTokens: string[]; // 5 seeded demo customers
  let customerUserIds: string[];
  let staffToken: string;
  // Every booking this suite creates is tracked here and hard-deleted in afterAll. Without this,
  // re-running the suite on the same calendar day would accumulate real bookings against the
  // fixed dateAhead(N) slots used below, eventually exhausting capacity and making the suite
  // non-idempotent across repeated local/CI runs — this is not a hypothetical, it was observed
  // directly while developing this suite.
  const createdBookingIds: string[] = [];

  function dateAhead(days: number): string {
    const d = new Date(Date.now() + days * 24 * 60 * 60_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  async function firstAvailableSlot(
    token: string,
    date: string,
  ): Promise<{ slotStart: string }> {
    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/salons/${salonId}/booking/availability?serviceId=${haircutServiceId}&date=${date}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const slots = res.body as { slotStart: string; available: boolean }[];
    const slot = slots.find((s) => s.available);
    if (!slot)
      throw new Error(`No available slot found for ${date} in test setup`);
    return slot;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    const salon = await prisma.salon.findFirstOrThrow({
      where: { slug: 'barbercue-demo' },
    });
    salonId = salon.id;
    const haircut = await prisma.service.findFirstOrThrow({
      where: { salonId, name: 'Haircut' },
    });
    haircutServiceId = haircut.id;

    const customerRoles = await prisma.userRole.findMany({
      where: { role: Role.CUSTOMER },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    if (customerRoles.length < 5) {
      throw new Error(
        'Expected 5 seeded demo customers — run prisma/seed.ts first.',
      );
    }
    customerTokens = customerRoles.map((r) =>
      tokens.signAccessToken(r.userId, [Role.CUSTOMER]),
    );
    customerUserIds = customerRoles.map((r) => r.userId);

    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: 'marcus@barbercue-demo.com' },
    });
    staffToken = tokens.signAccessToken(marcus.id, [Role.SALON_STAFF]);
  });

  afterAll(async () => {
    if (createdBookingIds.length > 0) {
      await prisma.customerLedgerEntry.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityType: 'Booking', entityId: { in: createdBookingIds } },
      });
      await prisma.booking.deleteMany({
        where: { id: { in: createdBookingIds } },
      });
    }
    await app.close();
  });

  describe('GET /salons/:salonId/booking/staff', () => {
    it('lists all 3 seeded staff as qualified (no StaffService rows configured for this salon)', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/salons/${salonId}/booking/staff?serviceId=${haircutServiceId}`,
        )
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .expect(200);
      const names = (res.body as { displayName: string }[])
        .map((s) => s.displayName)
        .sort();
      expect(names).toEqual(['Devon', 'Marcus', 'Ray']);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(
          `/api/v1/salons/${salonId}/booking/staff?serviceId=${haircutServiceId}`,
        )
        .expect(401);
    });

    it('rejects a SALON_STAFF caller (customer-only per API.md)', async () => {
      await request(app.getHttpServer())
        .get(
          `/api/v1/salons/${salonId}/booking/staff?serviceId=${haircutServiceId}`,
        )
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });
  });

  describe('GET /salons/:salonId/booking/availability', () => {
    it('returns bookable slots for a near-future date within operating hours', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/salons/${salonId}/booking/availability?serviceId=${haircutServiceId}&date=${dateAhead(2)}`,
        )
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .expect(200);
      const slots = res.body as {
        slotStart: string;
        slotEnd: string;
        available: boolean;
      }[];
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.some((s) => s.available)).toBe(true);
    });
  });

  describe('full booking lifecycle', () => {
    let bookingId: string;
    const bookingDate = dateAhead(2);

    it('creates a CONFIRMED booking (the demo salon has no payment policy, defaults to NONE)', async () => {
      const slot = await firstAvailableSlot(customerTokens[0], bookingDate);
      const res = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          salonId,
          serviceId: haircutServiceId,
          slotStart: slot.slotStart,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        salonName: 'BarberCue Demo Salon',
        serviceName: 'Haircut',
      });
      bookingId = (res.body as { id: string }).id;
      createdBookingIds.push(bookingId);
    });

    it('replays the identical response for a retried request with the same Idempotency-Key', async () => {
      const key = randomUUID();
      const slot = await firstAvailableSlot(customerTokens[0], dateAhead(4));
      const body = {
        salonId,
        serviceId: haircutServiceId,
        slotStart: slot.slotStart,
      };

      const first = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      expect(second.body).toEqual(first.body);
      createdBookingIds.push((first.body as { id: string }).id);
      const count = await prisma.booking.count({
        where: { idempotencyKey: key },
      });
      expect(count).toBe(1);
    });

    it('rejects booking creation with no Idempotency-Key header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .send({
          salonId,
          serviceId: haircutServiceId,
          slotStart: new Date(Date.now() + 3600_000).toISOString(),
        })
        .expect(400);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    });

    it('GET /bookings/mine includes the created booking', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/bookings/mine')
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .expect(200);
      const ids = (res.body as { items: { id: string }[] }).items.map(
        (b) => b.id,
      );
      expect(ids).toContain(bookingId);
    });

    it('GET /bookings/:id 404s when requested by a different customer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${customerTokens[1]}`)
        .expect(404);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'BOOKING_NOT_FOUND',
      );
    });

    it('cancels within the free-cancellation window with no charge (platform-default policy: 60 min)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect(res.body).toMatchObject({
        chargeAmount: 0,
        ledgerEntryCreated: false,
      });
      expect((res.body as { booking: { status: string } }).booking.status).toBe(
        'CANCELLED',
      );
    });

    it('rejects cancelling an already-cancelled booking', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', randomUUID())
        .expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'BOOKING_NOT_CANCELLABLE',
      );
    });
  });

  describe('late cancellation charge and the resulting outstanding-balance gate', () => {
    // Created directly via Prisma (not through POST /bookings) specifically so its slotStart can
    // be inside the platform-default 60-minute free-cancellation window without depending on the
    // salon's real-time operating hours at whatever moment this suite happens to run.
    it('charges the late-cancellation percentage and creates an OUTSTANDING ledger entry', async () => {
      const soonBooking = await prisma.booking.create({
        data: {
          salonId,
          customerId: customerUserIds[2],
          serviceId: haircutServiceId,
          slotStart: new Date(Date.now() + 10 * 60_000),
          slotEnd: new Date(Date.now() + 40 * 60_000),
          status: 'CONFIRMED',
          source: 'WEB',
          idempotencyKey: `e2e-late-cancel-${randomUUID()}`,
        },
      });
      createdBookingIds.push(soonBooking.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${soonBooking.id}/cancel`)
        .set('Authorization', `Bearer ${customerTokens[2]}`)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect(res.body).toMatchObject({
        chargeAmount: 150,
        ledgerEntryCreated: true,
      }); // 50% of 300

      const ledgerEntry = await prisma.customerLedgerEntry.findFirst({
        where: { bookingId: soonBooking.id, status: 'OUTSTANDING' },
      });
      expect(ledgerEntry).not.toBeNull();
      expect(Number(ledgerEntry?.amount)).toBe(150);
    });

    it('blocks a new booking at the same salon until the outstanding balance is settled', async () => {
      const slot = await firstAvailableSlot(customerTokens[2], dateAhead(5));
      const res = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerTokens[2]}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          salonId,
          serviceId: haircutServiceId,
          slotStart: slot.slotStart,
        })
        .expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'OUTSTANDING_BALANCE',
      );
    });
  });

  describe('capacity exhaustion (3 qualified staff x 4 active chairs -> capacity 3)', () => {
    it('allows exactly 3 concurrent bookings for the same slot and rejects the 4th with SLOT_FULL', async () => {
      const date = dateAhead(3);
      const slot = await firstAvailableSlot(customerTokens[0], date);

      for (const token of [customerTokens[3], customerTokens[4]]) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            salonId,
            serviceId: haircutServiceId,
            slotStart: slot.slotStart,
          })
          .expect(201);
        createdBookingIds.push((res.body as { id: string }).id);
      }
      // customerTokens[0] already used this exact slot in the lifecycle suite above only on a
      // different date, so it's still free to take the 3rd seat here.
      const third = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          salonId,
          serviceId: haircutServiceId,
          slotStart: slot.slotStart,
        })
        .expect(201);
      createdBookingIds.push((third.body as { id: string }).id);

      // customerTokens[1] has no outstanding balance and hasn't touched this slot — a clean
      // SLOT_FULL, not an unrelated rejection.
      const res = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerTokens[1]}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          salonId,
          serviceId: haircutServiceId,
          slotStart: slot.slotStart,
        })
        .expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'SLOT_FULL',
      );
    });
  });
});

import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SalonStatus, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Boots the full AppModule against the live Neon database (same pattern as
 * test/booking.e2e-spec.ts). The demo salon's seeded visit history (seed.ts's
 * seedVisitsAndReviews) only ever creates COMPLETED QueueEntry/ServiceSession rows, so it never
 * collides with the two ACTIVE-only partial unique indexes this suite exercises — no fixture
 * cleanup is required for that seeded data.
 */
describe('Queue & Check-In (e2e, live database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;

  let salonId: string;
  let haircutServiceId: string;
  let customerTokens: string[]; // 5 seeded demo customers
  let customerUserIds: string[];
  let staffToken: string; // Marcus, SALON_STAFF
  let ownerToken: string; // salon owner, SALON_OWNER
  let chairIds: string[];

  // Cleaned up in afterAll, in FK-safe order: ServiceSession -> QueueEntry -> Booking.
  const createdQueueEntryIds: string[] = [];
  const createdBookingIds: string[] = [];

  // A second, unrelated salon+owner created solely for the SALON_ACCESS_DENIED assertion.
  let outsiderOwnerToken: string;
  let outsiderSalonId: string | null = null;
  let outsiderOwnerUserId: string | null = null;

  async function joinWalkIn(
    token: string,
    serviceId?: string,
  ): Promise<{ id: string; tokenNumber: number; status: string }> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/salons/${salonId}/queue/join`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(serviceId ? { serviceId } : {})
      .expect(201);
    const body = res.body as {
      id: string;
      tokenNumber: number;
      status: string;
    };
    createdQueueEntryIds.push(body.id);
    return body;
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

    const chairs = await prisma.chair.findMany({
      where: { salonId },
      orderBy: { label: 'asc' },
    });
    chairIds = chairs.map((c) => c.id);

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

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner@barbercue-demo.com' },
    });
    ownerToken = tokens.signAccessToken(owner.id, [Role.SALON_OWNER]);

    // A second salon + owner with no UserRole overlap with the demo salon, purely to prove
    // SalonAccessService rejects a genuine outsider.
    const outsiderOwner = await prisma.user.create({
      data: {
        email: `e2e-outsider-owner-${randomUUID()}@barbercue-demo.com`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    outsiderOwnerUserId = outsiderOwner.id;
    const outsiderSalon = await prisma.salon.create({
      data: {
        ownerUserId: outsiderOwner.id,
        name: 'E2E Outsider Salon',
        slug: `e2e-outsider-${randomUUID()}`,
        cityId: salon.cityId,
        addressLine: '1 Nowhere Road',
        lat: 0,
        lng: 0,
        status: SalonStatus.ACTIVE,
      },
    });
    outsiderSalonId = outsiderSalon.id;
    await prisma.userRole.create({
      data: {
        userId: outsiderOwner.id,
        role: Role.SALON_OWNER,
        salonId: outsiderSalon.id,
      },
    });
    outsiderOwnerToken = tokens.signAccessToken(outsiderOwner.id, [
      Role.SALON_OWNER,
    ]);
  });

  afterAll(async () => {
    if (createdQueueEntryIds.length > 0) {
      await prisma.serviceSession.deleteMany({
        where: { queueEntryId: { in: createdQueueEntryIds } },
      });
      await prisma.queueEntry.deleteMany({
        where: { id: { in: createdQueueEntryIds } },
      });
    }
    if (createdBookingIds.length > 0) {
      await prisma.booking.deleteMany({
        where: { id: { in: createdBookingIds } },
      });
    }
    if (outsiderSalonId) {
      await prisma.userRole.deleteMany({ where: { salonId: outsiderSalonId } });
      await prisma.salon.delete({ where: { id: outsiderSalonId } });
    }
    if (outsiderOwnerUserId) {
      await prisma.user.delete({ where: { id: outsiderOwnerUserId } });
    }
    await app.close();
  });

  describe('GET /salons/:salonId/queue/status (public)', () => {
    it('returns a waitingCount and is reachable with no auth', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/salons/${salonId}/queue/status`)
        .expect(200);
      expect(res.body).toMatchObject({ salonId });
      expect(typeof (res.body as { waitingCount: number }).waitingCount).toBe(
        'number',
      );
    });
  });

  describe('walk-in join, position, and dashboard visibility', () => {
    it('rejects a second walk-in join while the customer already has an active token', async () => {
      const entry = await joinWalkIn(customerTokens[0], haircutServiceId);
      expect(entry.status).toBe('WAITING');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/salons/${salonId}/queue/join`)
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'ALREADY_IN_QUEUE',
      );

      // Clean up immediately so it doesn't linger and interfere with later tests in this suite.
      await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entry.id}/cancel`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
    });

    it('GET queue-entries/mine/active reflects the just-joined walk-in for that customer only', async () => {
      const entry = await joinWalkIn(customerTokens[1], haircutServiceId);

      const mine = await request(app.getHttpServer())
        .get('/api/v1/queue-entries/mine/active')
        .set('Authorization', `Bearer ${customerTokens[1]}`)
        .expect(200);
      expect((mine.body as { id: string }).id).toBe(entry.id);

      const someoneElses = await request(app.getHttpServer())
        .get('/api/v1/queue-entries/mine/active')
        .set('Authorization', `Bearer ${customerTokens[2]}`)
        .expect(200);
      // Nest sends an empty body (not the literal text "null") for a controller returning null,
      // and superagent normalizes that unparseable empty body to `{}` on res.body — so the only
      // reliable no-active-entry signal here is an empty response body.
      expect(someoneElses.text).toBe('');

      await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entry.id}/cancel`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
    });

    it('rejects a dashboard queue read from an outsider owner with SALON_ACCESS_DENIED', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/dashboard/salons/${salonId}/queue`)
        .set('Authorization', `Bearer ${outsiderOwnerToken}`)
        .expect(403);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'SALON_ACCESS_DENIED',
      );
    });

    it('a SALON_OWNER (no SalonStaff roster row) can still read the dashboard queue via UserRole', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/dashboard/salons/${salonId}/queue`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('full walk-in queue lifecycle: join -> call -> assign -> complete', () => {
    let entryId: string;
    let sessionId: string;
    let marcusStaffId: string;

    beforeAll(async () => {
      const marcusStaff = await prisma.salonStaff.findFirstOrThrow({
        where: { salonId, displayName: 'Marcus' },
      });
      marcusStaffId = marcusStaff.id;
    });

    it('joins the walk-in queue with position 1 when no one else is waiting for this service', async () => {
      const entry = await joinWalkIn(customerTokens[3], haircutServiceId);
      entryId = entry.id;
    });

    it('dashboard call transitions WAITING -> CALLED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entryId}/call`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
      expect((res.body as { status: string }).status).toBe('CALLED');
    });

    it('rejects calling the same entry twice (no longer WAITING)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entryId}/call`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'INVALID_QUEUE_TRANSITION',
      );
    });

    it('assign creates an ACTIVE ServiceSession and moves the entry to IN_SERVICE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entryId}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ staffId: marcusStaffId, chairId: chairIds[3] }) // Chair 4 — the seeded "spare" chair
        .expect(201);
      expect((res.body as { status: string }).status).toBe('IN_SERVICE');
      expect(
        (res.body as { activeServiceSessionId: string | null })
          .activeServiceSessionId,
      ).not.toBeNull();
      sessionId = (res.body as { activeServiceSessionId: string })
        .activeServiceSessionId;

      const session = await prisma.serviceSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(session.status).toBe('ACTIVE');
      expect(session.staffId).toBe(marcusStaffId);
      expect(session.chairId).toBe(chairIds[3]);
    });

    it('a second assign attempt on the same staff member (a fresh walk-in) returns 409 STAFF_ALREADY_OCCUPIED', async () => {
      const other = await joinWalkIn(customerTokens[4], haircutServiceId);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${other.id}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ staffId: marcusStaffId, chairId: chairIds[2] }) // a different, unoccupied chair
        .expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'STAFF_ALREADY_OCCUPIED',
      );

      // Confirm the transaction fully rolled back: the entry must still be assignable (WAITING).
      const reread = await prisma.queueEntry.findUniqueOrThrow({
        where: { id: other.id },
      });
      expect(reread.status).toBe('WAITING');

      await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${other.id}/cancel`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
    });

    it('completing the service session marks both ServiceSession and QueueEntry COMPLETED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/service-sessions/${sessionId}/complete`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
      expect((res.body as { status: string }).status).toBe('COMPLETED');

      const session = await prisma.serviceSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(session.status).toBe('COMPLETED');
      expect(session.endedAt).not.toBeNull();
    });

    it('rejects completing the same session twice (no longer ACTIVE)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/service-sessions/${sessionId}/complete`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'INVALID_QUEUE_TRANSITION',
      );
    });
  });

  describe('appointment check-in', () => {
    it('rejects check-in more than 15 minutes before the booked slot', async () => {
      const booking = await prisma.booking.create({
        data: {
          salonId,
          customerId: customerUserIds[0],
          serviceId: haircutServiceId,
          slotStart: new Date(Date.now() + 60 * 60_000),
          slotEnd: new Date(Date.now() + 90 * 60_000),
          status: 'CONFIRMED',
          source: 'WEB',
          idempotencyKey: `e2e-checkin-early-${randomUUID()}`,
        },
      });
      createdBookingIds.push(booking.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${booking.id}/check-in`)
        .set('Authorization', `Bearer ${customerTokens[0]}`)
        .set('Idempotency-Key', randomUUID())
        .expect(400);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'CHECK_IN_TOO_EARLY',
      );
    });

    it('checks in a CONFIRMED booking inside the window, creating an APPOINTMENT-sourced entry', async () => {
      const booking = await prisma.booking.create({
        data: {
          salonId,
          customerId: customerUserIds[1],
          serviceId: haircutServiceId,
          slotStart: new Date(Date.now() + 5 * 60_000),
          slotEnd: new Date(Date.now() + 35 * 60_000),
          status: 'CONFIRMED',
          source: 'WEB',
          idempotencyKey: `e2e-checkin-ontime-${randomUUID()}`,
        },
      });
      createdBookingIds.push(booking.id);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${booking.id}/check-in`)
        .set('Authorization', `Bearer ${customerTokens[1]}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      const body = res.body as {
        id: string;
        status: string;
        source: string;
        bookingId: string;
      };
      expect(body.status).toBe('WAITING');
      expect(body.source).toBe('APPOINTMENT');
      expect(body.bookingId).toBe(booking.id);
      createdQueueEntryIds.push(body.id);

      const res2 = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${booking.id}/check-in`)
        .set('Authorization', `Bearer ${customerTokens[1]}`)
        .set('Idempotency-Key', randomUUID())
        .expect(409);
      expect((res2.body as { error: { code: string } }).error.code).toBe(
        'ALREADY_CHECKED_IN',
      );

      await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${body.id}/cancel`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
    });

    it('marks the linked Booking COMPLETED when its check-in-derived QueueEntry finishes service', async () => {
      const marcusStaff = await prisma.salonStaff.findFirstOrThrow({
        where: { salonId, displayName: 'Devon' },
      });
      const booking = await prisma.booking.create({
        data: {
          salonId,
          customerId: customerUserIds[2],
          serviceId: haircutServiceId,
          slotStart: new Date(Date.now() + 5 * 60_000),
          slotEnd: new Date(Date.now() + 35 * 60_000),
          status: 'CONFIRMED',
          source: 'WEB',
          idempotencyKey: `e2e-checkin-complete-${randomUUID()}`,
        },
      });
      createdBookingIds.push(booking.id);

      const checkIn = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${booking.id}/check-in`)
        .set('Authorization', `Bearer ${customerTokens[2]}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      const entryId = (checkIn.body as { id: string }).id;
      createdQueueEntryIds.push(entryId);

      const assign = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entryId}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ staffId: marcusStaff.id, chairId: chairIds[1] })
        .expect(201);
      const sessionId = (assign.body as { activeServiceSessionId: string })
        .activeServiceSessionId;

      await request(app.getHttpServer())
        .post(`/api/v1/dashboard/service-sessions/${sessionId}/complete`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);

      const finishedBooking = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(finishedBooking.status).toBe('COMPLETED');
    });
  });

  describe('manual no-show and staff-initiated cancel', () => {
    it('marks a CALLED entry as NO_SHOW and rejects no-show on a still-WAITING entry', async () => {
      const entry = await joinWalkIn(customerTokens[3], haircutServiceId);

      const tooEarly = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entry.id}/no-show`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(409);
      expect((tooEarly.body as { error: { code: string } }).error.code).toBe(
        'INVALID_QUEUE_TRANSITION',
      );

      await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entry.id}/call`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entry.id}/no-show`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
      expect((res.body as { status: string }).status).toBe('NO_SHOW');
    });

    it('cancelling an IN_SERVICE entry cascades to CANCEL its ACTIVE ServiceSession', async () => {
      const rayStaff = await prisma.salonStaff.findFirstOrThrow({
        where: { salonId, displayName: 'Ray' },
      });
      const entry = await joinWalkIn(customerTokens[4], haircutServiceId);
      const assign = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entry.id}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ staffId: rayStaff.id, chairId: chairIds[3] })
        .expect(201);
      const sessionId = (assign.body as { activeServiceSessionId: string })
        .activeServiceSessionId;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${entry.id}/cancel`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);
      expect((res.body as { status: string }).status).toBe('CANCELLED');

      const session = await prisma.serviceSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(session.status).toBe('CANCELLED');
    });
  });

  describe('PATCH /dashboard/staff/:id/status', () => {
    it('lets a staff member toggle their own clock-in status without owner privileges', async () => {
      const marcusStaff = await prisma.salonStaff.findFirstOrThrow({
        where: { salonId, displayName: 'Marcus' },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/dashboard/staff/${marcusStaff.id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect((res.body as { status: string }).status).toBe('ACTIVE');
    });

    it("rejects one staff member updating a different staff member's status", async () => {
      const devonStaff = await prisma.salonStaff.findFirstOrThrow({
        where: { salonId, displayName: 'Devon' },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/dashboard/staff/${devonStaff.id}/status`)
        .set('Authorization', `Bearer ${staffToken}`) // Marcus's token
        .send({ status: 'INACTIVE' })
        .expect(403);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'NOT_YOUR_STAFF_PROFILE',
      );
    });
  });
});

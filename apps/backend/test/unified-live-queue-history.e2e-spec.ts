import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

jest.setTimeout(120_000);

/**
 * Requires the disposable PostgreSQL database created by unified-live-queue-history-certification.
 * Tokens are signed by the real TokenService, then every request passes the real JWT/roles guards.
 * This does not claim password/TOTP login or production-data certification.
 */
describe('Unified Live Queue history (disposable database HTTP)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let salonId: string;
  let otherSalonId: string;
  let ownerId: string;
  let customerId: string;
  let otherOwnerId: string;
  let completedIds: string[];
  let expiredIds: string[];
  let linkedQueueId: string;
  let bookingId: string;
  let ownerToken: string;
  let customerToken: string;
  let otherCustomerToken: string;
  let otherOwnerToken: string;
  const suffix = randomUUID();

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (
      process.env.FASTQUE_DISPOSABLE_DB !== '1' ||
      !databaseUrl ||
      !/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/fastque_ci(?:\?|$)/.test(
        databaseUrl,
      )
    ) {
      throw new Error(
        'This E2E suite requires the loopback-only fastque_ci disposable database.',
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    const [owner, customer, otherCustomer, otherOwner] = await Promise.all(
      ['owner', 'customer', 'other-customer', 'other-owner'].map((label) =>
        prisma.user.create({
          data: {
            email: `${label}-${suffix}@example.invalid`,
            emailVerifiedAt: new Date(),
          },
        }),
      ),
    );
    ownerId = owner.id;
    customerId = customer.id;
    otherOwnerId = otherOwner.id;
    const city = await prisma.city.create({
      data: {
        name: 'Certification City',
        slug: `cert-city-${suffix}`,
        countryCode: 'IN',
        state: 'Test State',
        country: 'Test Country',
      },
    });
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: ownerId,
        cityId: city.id,
        name: 'Handsome Center',
        slug: `handsome-cert-${suffix}`,
        addressLine: 'Synthetic address',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        status: 'ACTIVE',
      },
    });
    const otherSalon = await prisma.salon.create({
      data: {
        ownerUserId: otherOwnerId,
        cityId: city.id,
        name: 'Other Test Shop',
        slug: `other-cert-${suffix}`,
        addressLine: 'Synthetic address',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        status: 'ACTIVE',
      },
    });
    salonId = salon.id;
    otherSalonId = otherSalon.id;
    const service = await prisma.service.create({
      data: { salonId, name: 'Haircut', durationMinutes: 30, price: 100 },
    });
    await prisma.userRole.createMany({
      data: [
        { userId: ownerId, salonId, role: Role.SALON_OWNER },
        { userId: otherOwnerId, salonId: otherSalonId, role: Role.SALON_OWNER },
        { userId: customerId, role: Role.CUSTOMER },
        { userId: otherCustomer.id, role: Role.CUSTOMER },
      ],
    });
    ownerToken = tokens.signAccessToken(
      ownerId,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );
    otherOwnerToken = tokens.signAccessToken(
      otherOwnerId,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );
    customerToken = tokens.signAccessToken(
      customerId,
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );
    otherCustomerToken = tokens.signAccessToken(
      otherCustomer.id,
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );

    // Eleven source rows on 11 Oct IST: eight completed, three expired. No Booking is invented.
    const queueRows = await Promise.all(
      Array.from({ length: 11 }, (_, index) => {
        const completed = index < 8;
        const joinedAt = new Date(
          `2026-10-11T${String(index).padStart(2, '0')}:00:00.000Z`,
        );
        return prisma.queueEntry.create({
          data: {
            salonId,
            customerId: index === 0 || index === 8 ? customerId : null,
            serviceId: service.id,
            source: 'WALK_IN',
            tokenNumber: index + 1,
            status: completed ? 'COMPLETED' : 'EXPIRED',
            joinedAt,
            serviceCompletedAt: completed
              ? new Date(joinedAt.getTime() + 30 * 60_000)
              : null,
          },
        });
      }),
    );
    completedIds = queueRows.slice(0, 8).map((row) => row.id);
    expiredIds = queueRows.slice(8).map((row) => row.id);

    const booking = await prisma.booking.create({
      data: {
        salonId,
        customerId,
        serviceId: service.id,
        slotStart: new Date('2026-10-11T12:00:00.000Z'),
        slotEnd: new Date('2026-10-11T12:30:00.000Z'),
        status: 'COMPLETED',
        source: 'WEB',
        idempotencyKey: randomUUID(),
      },
    });
    bookingId = booking.id;
    linkedQueueId = (
      await prisma.queueEntry.create({
        data: {
          salonId,
          customerId,
          bookingId,
          serviceId: service.id,
          source: 'APPOINTMENT',
          tokenNumber: 12,
          status: 'COMPLETED',
          joinedAt: new Date('2026-10-11T12:00:00.000Z'),
          serviceCompletedAt: new Date('2026-10-11T12:30:00.000Z'),
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('shows exactly 8 completed and 3 expired historical queue visits with no fabricated bookings', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/salons/${salonId}/bookings/history?limit=50`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const items = response.body.items as Array<{
      id: string;
      source: string;
      status: string;
      bookingId: string | null;
      queueEntryId: string | null;
      salonName: string;
    }>;
    expect(items).toHaveLength(12);
    const queue = items.filter((item) => item.source === 'LIVE_QUEUE');
    expect(queue).toHaveLength(11);
    expect(queue.filter((item) => item.status === 'COMPLETED')).toHaveLength(8);
    expect(queue.filter((item) => item.status === 'EXPIRED')).toHaveLength(3);
    expect(
      queue.every(
        (item) =>
          item.bookingId === null && item.salonName === 'Handsome Center',
      ),
    ).toBe(true);
    expect(items.filter((item) => item.bookingId === bookingId)).toHaveLength(
      1,
    );
    expect(items.some((item) => item.queueEntryId === linkedQueueId)).toBe(
      false,
    );
    expect(await prisma.booking.count({ where: { salonId } })).toBe(1);
    expect(
      await prisma.queueEntry.count({
        where: { salonId, source: 'WALK_IN', bookingId: null },
      }),
    ).toBe(11);
  });

  it('enforces account and salon boundaries through guarded HTTP routes', async () => {
    const mine = await request(app.getHttpServer())
      .get('/api/v1/bookings/history/mine?limit=50')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(mine.body.items).toHaveLength(3); // completed and expired queue visits, plus the online booking
    expect(
      mine.body.items.every(
        (item: { source: string }) =>
          item.source === 'ONLINE_BOOKING' || item.source === 'LIVE_QUEUE',
      ),
    ).toBe(true);
    const stranger = await request(app.getHttpServer())
      .get('/api/v1/bookings/history/mine?limit=50')
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .expect(200);
    expect(stranger.body.items).toHaveLength(0);
    await request(app.getHttpServer())
      .get(`/api/v1/dashboard/salons/${salonId}/bookings/history`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/dashboard/salons/${salonId}/bookings/history`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/dashboard/salons/${salonId}/bookings/history`)
      .expect(401);
  });

  it('supports only the verified completed customer, editing, owner response and public aggregate', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .send({ queueEntryId: completedIds[0], rating: 5 })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ queueEntryId: expiredIds[0], rating: 5 })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ queueEntryId: linkedQueueId, rating: 5 })
      .expect(404);

    const created = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        queueEntryId: completedIds[0],
        rating: 5,
        comment: 'Good service',
      })
      .expect(201);
    const reviewId = created.body.id as string;
    expect(created.body).toMatchObject({
      bookingId: null,
      queueEntryId: completedIds[0],
      rating: 5,
    });
    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ queueEntryId: completedIds[0], rating: 4 })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .send({ rating: 1 })
      .expect(403);
    const edited = await request(app.getHttpServer())
      .patch(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rating: 4, comment: 'Still good' })
      .expect(200);
    expect(edited.body).toMatchObject({
      id: reviewId,
      rating: 4,
      comment: 'Still good',
    });

    await request(app.getHttpServer())
      .put(`/api/v1/dashboard/salons/${salonId}/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({ ownerResponse: 'Denied' })
      .expect(403);
    const responded = await request(app.getHttpServer())
      .put(`/api/v1/dashboard/salons/${salonId}/reviews/${reviewId}/response`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ownerResponse: 'Thank you' })
      .expect(200);
    expect(responded.body).toMatchObject({
      source: 'LIVE_QUEUE',
      ownerResponse: 'Thank you',
      bookingId: null,
    });
    const ownerList = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/salons/${salonId}/reviews`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ownerList.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reviewId,
          source: 'LIVE_QUEUE',
          rating: 4,
        }),
      ]),
    );
    const persisted = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
    });
    expect(persisted).toMatchObject({
      bookingId: null,
      queueEntryId: completedIds[0],
      rating: 4,
      ownerResponse: 'Thank you',
    });
    const salon = await prisma.salon.findUniqueOrThrow({
      where: { id: salonId },
      include: { city: true },
    });
    const profile = await request(app.getHttpServer())
      .get(`/api/v1/salons/IN/${salon.city.slug}/${salon.slug}`)
      .expect(200);
    expect(profile.body).toMatchObject({ ratingCount: 1, ratingAverage: 4 });
    expect(profile.body.reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reviewId, rating: 4 }),
      ]),
    );
  });
});

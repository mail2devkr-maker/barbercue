import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { assertLocalDisposableQaDatabase } from '../src/common/qa-database-target';
import { PrismaService } from '../src/prisma/prisma.service';
import { utcToZonedDateStr } from '../src/common/timezone/timezone';

/** Real HTTP + PostgreSQL test; refuses to create fixtures outside named loopback QA databases. */
describe('Customer assistant catalog and availability (disposable PostgreSQL HTTP E2E)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = randomUUID();
  const date = utcToZonedDateStr(
    new Date(Date.now() + 24 * 60 * 60_000),
    'Asia/Kolkata',
  );
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    assertLocalDisposableQaDatabase(process.env);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const city = await prisma.city.findFirstOrThrow({
      where: { slug: 'jharsuguda' },
    });
    const owner = await prisma.user.create({
      data: {
        email: `assistant-owner-${run}@example.test`,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: `Assistant E2E ${run}`,
        slug: `assistant-e2e-${run}`,
        cityId: city.id,
        addressLine: 'Disposable QA Road',
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      },
    });
    salonId = salon.id;
    const service = await prisma.service.create({
      data: {
        salonId,
        name: 'Haircut',
        category: 'Hair',
        price: '250.00',
        durationMinutes: 30,
        isActive: true,
      },
    });
    serviceId = service.id;
    await prisma.chair.create({ data: { salonId, label: 'QA chair' } });
    const barberUser = await prisma.user.create({
      data: {
        email: `assistant-barber-${run}@example.test`,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.salonStaff.create({
      data: {
        salonId,
        userId: barberUser.id,
        displayName: 'QA Barber',
        roleInSalon: 'BARBER',
        status: 'ACTIVE',
      },
    });
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      await prisma.operatingHours.create({
        data: {
          salonId,
          dayOfWeek,
          openTime: '00:00',
          closeTime: '23:59',
          isClosed: false,
        },
      });
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('returns only real matching catalog data and available slots without authentication or booking creation', async () => {
    const bookingsBefore = await prisma.booking.count({ where: { salonId } });
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/search')
      .send({ serviceQuery: 'haircut', date, city: 'jharsuguda', limit: 3 })
      .expect(201);

    expect(response.body).toMatchObject({
      mode: 'DETERMINISTIC_CATALOG_AVAILABILITY',
      generated: false,
      bookingConfirmationRequired: true,
      date,
      candidates: [
        {
          salon: { id: salonId, name: `Assistant E2E ${run}` },
          service: {
            id: serviceId,
            name: 'Haircut',
            category: 'Hair',
            price: 250,
            durationMinutes: 30,
          },
          timeZone: 'Asia/Kolkata',
        },
      ],
    });
    expect(response.body.candidates[0].availableSlots.length).toBeGreaterThan(
      0,
    );
    expect(
      response.body.candidates[0].availableSlots.length,
    ).toBeLessThanOrEqual(3);
    expect(response.body.candidates[0]).not.toHaveProperty('phone');
    expect(response.body.candidates[0]).not.toHaveProperty('ownerUserId');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(await prisma.booking.count({ where: { salonId } })).toBe(
      bookingsBefore,
    );
  });

  it('honors the actual service price and does not return shops without an affordable matching service', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/search')
      .send({ serviceQuery: 'haircut', date, city: 'jharsuguda', maxPrice: 100 })
      .expect(201);
    expect(response.body.candidates).toEqual([]);
  });

  it('rejects impossible dates and oversized result requests', async () => {
    const impossible = await request(app.getHttpServer())
      .post('/api/v1/assistant/search')
      .send({ serviceQuery: 'haircut', date: '2026-02-31' })
      .expect(400);
    expect(impossible.body.error.code).toBe('VALIDATION_ERROR');

    const oversized = await request(app.getHttpServer())
      .post('/api/v1/assistant/search')
      .send({ serviceQuery: 'haircut', date, limit: 99 })
      .expect(400);
    expect(oversized.body.error.code).toBe('VALIDATION_ERROR');

    const unlocated = await request(app.getHttpServer())
      .post('/api/v1/assistant/search')
      .send({ serviceQuery: 'haircut', date })
      .expect(400);
    expect(unlocated.body.error.code).toBe('VALIDATION_ERROR');
  });
});

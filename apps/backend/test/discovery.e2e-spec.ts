import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Unlike Phase 2's auth e2e tests, this boots the FULL AppModule (including PrismaModule) against
 * the real, live Neon database configured in .env — Phase 2.1 seeded exactly one real salon
 * (bengaluru / barbercue-demo / indiranagar) to assert against. If DATABASE_URL is unreachable,
 * these tests fail with a clear connection error rather than silently passing — that is the
 * correct, honest behavior (see TESTING.md), not a bug in the test.
 */
describe('Discovery (e2e, live database)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /cities includes the seeded Bengaluru city', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cities')
      .expect(200);
    const body = res.body as { slug: string; name: string }[];
    expect(
      body.some((c) => c.slug === 'bengaluru' && c.name === 'Bengaluru'),
    ).toBe(true);
  });

  it('GET /cities/bengaluru returns the single city detail', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cities/bengaluru')
      .expect(200);
    expect(res.body).toMatchObject({
      slug: 'bengaluru',
      name: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
    });
  });

  it('GET /cities/bengaluru/localities includes the seeded Indiranagar locality', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cities/bengaluru/localities')
      .expect(200);
    const body = res.body as { slug: string }[];
    expect(body.some((l) => l.slug === 'indiranagar')).toBe(true);
  });

  it('GET /cities/:citySlug/localities/:localitySlug 404s for an unknown locality', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cities/bengaluru/localities/does-not-exist')
      .expect(404);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'LOCALITY_NOT_FOUND',
    );
  });

  it('GET /cities/:citySlug 404s for an unknown city', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cities/nowhere/localities')
      .expect(404);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'CITY_NOT_FOUND',
    );
  });

  it('GET /salons?city=bengaluru returns the seeded demo salon with a real computed rating', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/salons?city=bengaluru')
      .expect(200);
    const body = res.body as {
      items: {
        slug: string;
        ratingCount: number;
        ratingAverage: number | null;
      }[];
    };
    const salon = body.items.find((s) => s.slug === 'barbercue-demo');
    expect(salon).toBeDefined();
    expect(salon?.ratingCount).toBe(3); // 3 completed-booking reviews seeded in Phase 2.1
    expect(salon?.ratingAverage).toBeCloseTo(14 / 3, 5); // ratings 5, 4, 5
  });

  it('GET /salons rejects limit > 50 with a validation error, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/salons?limit=999')
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('GET /salons/:citySlug/:salonSlug returns the full seeded profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/salons/bengaluru/barbercue-demo')
      .expect(200);
    const body = res.body as {
      name: string;
      services: unknown[];
      operatingHours: unknown[];
      reviews: unknown[];
      priceMin: number;
      priceMax: number;
    };
    expect(body.name).toBe('BarberCue Demo Salon');
    expect(body.services).toHaveLength(4); // Haircut, Beard Trim, Haircut+Beard, Hair Spa
    expect(body.operatingHours).toHaveLength(7);
    expect(body.reviews).toHaveLength(3);
    expect(body.priceMin).toBe(150); // Beard Trim
    expect(body.priceMax).toBe(600); // Hair Spa
  });

  it('GET /salons/:citySlug/:salonSlug 404s for a nonexistent salon', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/salons/bengaluru/does-not-exist')
      .expect(404);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'SALON_NOT_FOUND',
    );
  });

  it('GET /salons/:citySlug/:salonSlug 404s when the salon exists but in a different city', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/salons/nowhere/barbercue-demo')
      .expect(404);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'CITY_NOT_FOUND',
    );
  });
});

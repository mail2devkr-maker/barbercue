import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

process.env.JWT_ACCESS_SECRET ??= 'test-only-salon-photo-activation-e2e-secret';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

/** Real AppModule + JWT/role guards + disposable PostgreSQL. It refuses non-loopback databases. */
maybe('Salon photo activation requirement (disposable PostgreSQL e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  let ownerToken = '';
  let otherOwnerToken = '';
  let customerToken = '';

  const api = (method: 'get' | 'patch', path: string, token: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${token}`);

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

    const city = await prisma.city.findFirstOrThrow({
      where: { slug: 'jharsuguda' },
    });
    const owner = await prisma.user.create({
      data: {
        email: `photo-owner-${run}@example.test`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    ids.owner = owner.id;
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: `Photo Activation ${run}`,
        slug: `photo-activation-${run}`,
        cityId: city.id,
        addressLine: 'Disposable test address',
        status: SalonStatus.PENDING,
        shopPhotoRequirementGrandfathered: false,
      },
    });
    ids.salon = salon.id;
    await prisma.userRole.create({
      data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
    });
    ownerToken = tokens.signAccessToken(
      owner.id,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );

    const service = await prisma.service.create({
      data: {
        salonId: salon.id,
        name: 'Test service',
        price: '100.00',
        durationMinutes: 30,
      },
    });
    await prisma.chair.create({
      data: { salonId: salon.id, label: 'Test chair' },
    });
    await prisma.salonStaff.create({
      data: {
        salonId: salon.id,
        userId: owner.id,
        displayName: 'Test barber',
        roleInSalon: 'BARBER',
        status: 'ACTIVE',
        services: { create: [{ serviceId: service.id }] },
      },
    });

    const otherOwner = await prisma.user.create({
      data: {
        email: `photo-other-${run}@example.test`,
        status: UserStatus.ACTIVE,
      },
    });
    const otherSalon = await prisma.salon.create({
      data: {
        ownerUserId: otherOwner.id,
        name: `Other Photo ${run}`,
        slug: `other-photo-${run}`,
        cityId: city.id,
        addressLine: 'Other disposable address',
      },
    });
    await prisma.userRole.create({
      data: {
        userId: otherOwner.id,
        role: Role.SALON_OWNER,
        salonId: otherSalon.id,
      },
    });
    otherOwnerToken = tokens.signAccessToken(
      otherOwner.id,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );
    const customer = await prisma.user.create({
      data: {
        email: `photo-customer-${run}@example.test`,
        status: UserStatus.ACTIVE,
      },
    });
    customerToken = tokens.signAccessToken(
      customer.id,
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('reports readiness, denies first activation until three distinct safe photo URLs, then activates atomically', async () => {
    const path = `dashboard/salons/${ids.salon}`;
    await api('get', `${path}/photo-readiness`, ownerToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          required: 3,
          current: 0,
          ready: false,
          grandfathered: false,
          reasons: ['THREE_VALID_PHOTOS_REQUIRED'],
        });
      });

    await api('patch', `${path}/status`, ownerToken)
      .send({ status: 'ACTIVE' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe('SHOP_PHOTOS_REQUIRED');
        expect(body.error.details).toMatchObject({
          required: 3,
          current: 0,
          ready: false,
        });
      });
    expect(
      (await prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } }))
        .status,
    ).toBe('PENDING');

    await prisma.photo.createMany({
      data: [
        {
          salonId: ids.salon,
          url: 'https://images.example/shop-one.jpg?size=small',
          type: 'GALLERY',
        },
        {
          salonId: ids.salon,
          url: 'https://images.example/shop-one.jpg?size=large',
          type: 'GALLERY',
        },
        {
          salonId: ids.salon,
          url: 'https://images.example/shop-two.jpg',
          type: 'COVER',
        },
      ],
    });
    await api('get', `${path}/photo-readiness`, ownerToken)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ current: 2, ready: false }),
      );
    await api('patch', `${path}/status`, ownerToken)
      .send({ status: 'ACTIVE' })
      .expect(409);

    await prisma.photo.create({
      data: {
        salonId: ids.salon,
        url: 'https://images.example/shop-three.jpg',
        type: 'GALLERY',
      },
    });
    await api('get', `${path}/photo-readiness`, ownerToken)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ required: 3, current: 3, ready: true }),
      );
    await api('patch', `${path}/status`, ownerToken)
      .send({ status: 'ACTIVE' })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ACTIVE'));
    expect(
      await prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } }),
    ).toMatchObject({
      status: 'ACTIVE',
      shopPhotoRequirementGrandfathered: true,
    });
  });

  it('grandfathers pre-migration active shops and keeps salon access scoped', async () => {
    const city = await prisma.city.findFirstOrThrow({
      where: { slug: 'jharsuguda' },
    });
    const legacy = await prisma.salon.create({
      data: {
        ownerUserId: ids.owner,
        name: `Legacy Active ${run}`,
        slug: `legacy-active-${run}`,
        cityId: city.id,
        addressLine: 'Legacy disposable address',
        status: SalonStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: ids.owner, role: Role.SALON_OWNER, salonId: legacy.id },
    });
    await api(
      'get',
      `dashboard/salons/${legacy.id}/photo-readiness`,
      ownerToken,
    )
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          current: 0,
          ready: true,
          grandfathered: true,
        }),
      );
    await api(
      'get',
      `dashboard/salons/${ids.salon}/photo-readiness`,
      otherOwnerToken,
    ).expect(403);
    await api('patch', `dashboard/salons/${ids.salon}/status`, otherOwnerToken)
      .send({ status: 'ACTIVE' })
      .expect(403);
    await api(
      'get',
      `dashboard/salons/${ids.salon}/photo-readiness`,
      customerToken,
    ).expect(403);
    await api('patch', `dashboard/salons/${ids.salon}/status`, customerToken)
      .send({ status: 'ACTIVE' })
      .expect(403);
    await expect(
      prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });
});

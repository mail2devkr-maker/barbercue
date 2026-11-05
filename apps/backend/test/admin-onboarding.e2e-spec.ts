import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  QueueEntrySource,
  QueueEntryStatus,
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Admin "New Shop Onboarding" funnel on a DISPOSABLE database. */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const parsed = (() => {
  try {
    return new URL(DATABASE_URL);
  } catch {
    return null;
  }
})();
const DISPOSABLE =
  !!parsed &&
  ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
  (parsed.pathname.endsWith('_e2e') || parsed.pathname === '/owner_ops_chain');
const maybe = DISPOSABLE ? describe : describe.skip;

maybe('Admin new shop onboarding (e2e, disposable database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const get = (who: string, q = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/admin/onboarding${q}`)
      .set('Authorization', `Bearer ${tok[who]}`);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const city = await prisma.city.create({
      data: {
        name: `OB ${run}`,
        slug: `ob-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    const user = async (
      label: string,
      roles: Role[],
      audience: SessionAudience,
    ) => {
      const u = await prisma.user.create({
        data: {
          email: `ob-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
          phone: null,
        },
      });
      for (const role of roles)
        await prisma.userRole.create({
          data: { userId: u.id, role, salonId: null },
        });
      tok[label] = tokens.signAccessToken(u.id, roles, audience);
      return u.id;
    };
    await user('admin', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await user('sales', [Role.SALES_ADMIN], SessionAudience.ADMIN);
    await user('hr', [Role.HR_ADMIN], SessionAudience.ADMIN);
    await user('cofounderStaff', [Role.CO_FOUNDER], SessionAudience.STAFF);
    const shop = async (
      key: string,
      status: SalonStatus,
      createdAt = new Date(),
    ) => {
      const owner = await user(`owner${key}`, [], SessionAudience.STAFF);
      const s = await prisma.salon.create({
        data: {
          ownerUserId: owner,
          name: `OB ${key} ${run}`,
          slug: `ob-${key.toLowerCase()}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          status,
          createdAt,
        },
      });
      await prisma.userRole.create({
        data: { userId: owner, role: Role.SALON_OWNER, salonId: s.id },
      });
      tok[`owner${key}`] = tokens.signAccessToken(
        owner,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      ids[key] = s.id;
      ids[`owner${key}`] = owner;
      return s;
    };
    const configure = async (key: string) => {
      await prisma.service.create({
        data: {
          salonId: ids[key],
          name: 'Cut',
          price: 100,
          durationMinutes: 30,
        },
      });
      await prisma.chair.create({
        data: { salonId: ids[key], label: 'Chair 1' },
      });
      await prisma.salonStaff.create({
        data: {
          salonId: ids[key],
          userId: ids[`owner${key}`],
          displayName: 'Barber',
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      });
    };
    await shop('New', SalonStatus.PENDING);
    await shop('Configured', SalonStatus.PENDING);
    await configure('Configured');
    await shop('Live', SalonStatus.ACTIVE);
    await configure('Live');
    await shop('Served', SalonStatus.ACTIVE);
    await configure('Served');
    await prisma.queueEntry.create({
      data: {
        salonId: ids.Served,
        source: QueueEntrySource.WALK_IN,
        status: QueueEntryStatus.COMPLETED,
        tokenNumber: 1,
        contactName: `Private Person ${run}`,
      },
    });
    await shop(
      'Old',
      SalonStatus.ACTIVE,
      new Date(Date.now() - 200 * 86_400_000),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  const mine = (body: { shops: Array<{ id: string; stage: string }> }) =>
    Object.fromEntries(
      body.shops
        .filter((s) => Object.values(ids).includes(s.id))
        .map((s) => [Object.keys(ids).find((k) => ids[k] === s.id), s]),
    );

  it('places each new shop at the furthest stage it reached', async () => {
    const body = (await get('admin').expect(200)).body;
    expect(body.days).toBe(90);
    const m = mine(body);
    expect(m.New).toMatchObject({
      stage: 'REGISTERED',
      services: 0,
      chairs: 0,
      staff: 0,
      firstCustomerAt: null,
    });
    expect(m.Configured).toMatchObject({
      stage: 'CONFIGURED',
      services: 1,
      chairs: 1,
      staff: 1,
    });
    expect(m.Live).toMatchObject({ stage: 'LIVE' });
    expect(m.Served.stage).toBe('FIRST_CUSTOMER');
    expect(m.Served.firstCustomerAt).not.toBeNull();
    expect(m.Old).toBeUndefined(); // registered 200 days ago: outside 90 days
    // The funnel counts each step's real condition: none of these synthetic shops is verified.
    const shops = body.shops as Array<{ verification: string; status: string }>;
    expect(body.funnel.REGISTERED).toBe(shops.length);
    expect(body.funnel.VERIFIED).toBe(
      shops.filter((s) => s.verification === 'APPROVED').length,
    );
    expect(body.funnel.LIVE).toBe(
      shops.filter((s) => s.status === 'ACTIVE').length,
    );
  });

  it('a 365-day window includes older shops; other windows are refused', async () => {
    expect(
      mine((await get('admin', '?days=365').expect(200)).body).Old,
    ).toBeDefined();
    expect((await get('admin', '?days=7')).status).toBe(400);
  });

  it('carries no owner or customer details', async () => {
    const raw = JSON.stringify((await get('admin').expect(200)).body);
    expect(raw).not.toContain('Private Person');
    expect(raw).not.toMatch(/@example\.test|ownerUserId|email|phone/);
  });

  it('Super Admin and Sales (admin sessions) only', async () => {
    await get('sales').expect(200);
    for (const who of ['hr', 'cofounderStaff', 'ownerNew'])
      expect((await get(who)).status).toBe(403);
  });
});

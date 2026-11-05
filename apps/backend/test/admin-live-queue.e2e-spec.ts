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

/** Admin Live Queue Monitoring on a DISPOSABLE database: counts only, correct audience. */
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

maybe('Admin live queue monitoring (e2e, disposable database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let token = 0;
  const get = (who: string) =>
    request(app.getHttpServer())
      .get('/api/v1/admin/live-queue')
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
        name: `LQ City ${run}`,
        slug: `lq-${run}`,
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
          email: `lq-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
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
    await user('cofounder', [Role.CO_FOUNDER], SessionAudience.ADMIN);
    await user('cofounderStaff', [Role.CO_FOUNDER], SessionAudience.STAFF);
    await user('customer', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    for (const key of ['Busy', 'Calm', 'Idle']) {
      const owner = await user(`owner${key}`, [], SessionAudience.STAFF);
      const s = await prisma.salon.create({
        data: {
          ownerUserId: owner,
          name: `LQ ${key} ${run}`,
          slug: `lq-${key.toLowerCase()}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          status: SalonStatus.ACTIVE,
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
      await prisma.chair.createMany({
        data: [
          { salonId: s.id, label: 'Chair 1' },
          { salonId: s.id, label: 'Chair 2' },
        ],
      });
    }
    const entry = (
      salonId: string,
      status: QueueEntryStatus,
      minutesAgo: number,
    ) =>
      prisma.queueEntry.create({
        data: {
          salonId,
          source: QueueEntrySource.WALK_IN,
          status,
          tokenNumber: ++token,
          contactName: `Synthetic Guest ${run}`,
          contactPhone: '+919999999999',
          joinedAt: new Date(Date.now() - minutesAgo * 60_000),
        },
      });
    // Busy: 3 waiting (oldest 40 min), 1 called, 1 in service, plus finished entries that must not count.
    await entry(ids.Busy, QueueEntryStatus.WAITING, 40);
    await entry(ids.Busy, QueueEntryStatus.WAITING, 10);
    await entry(ids.Busy, QueueEntryStatus.WAITING, 5);
    await entry(ids.Busy, QueueEntryStatus.CALLED, 12);
    await entry(ids.Busy, QueueEntryStatus.IN_SERVICE, 30);
    await entry(ids.Busy, QueueEntryStatus.COMPLETED, 90);
    await entry(ids.Busy, QueueEntryStatus.CANCELLED, 50);
    // Calm: 1 waiting for 2 minutes.
    await entry(ids.Calm, QueueEntryStatus.WAITING, 2);
    // Idle: only finished entries -> not listed.
    await entry(ids.Idle, QueueEntryStatus.COMPLETED, 20);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists shops with people in the queue now, split by stage, longest wait first', async () => {
    const body = (await get('admin').expect(200)).body;
    const mine = body.shops.filter((s: { id: string }) =>
      [ids.Busy, ids.Calm, ids.Idle].includes(s.id),
    );
    expect(mine.map((s: { id: string }) => s.id)).toEqual([ids.Busy, ids.Calm]);
    expect(mine[0]).toMatchObject({
      waiting: 3,
      called: 1,
      inService: 1,
      activeChairs: 2,
      city: `LQ City ${run}`,
    });
    expect(Date.now() - Date.parse(mine[0].oldestWaitingSince)).toBeGreaterThan(
      39 * 60_000,
    );
    expect(mine[1]).toMatchObject({ waiting: 1, called: 0, inService: 0 });
    expect(body.totals.waiting).toBeGreaterThanOrEqual(4);
  });

  it('never returns customer data', async () => {
    const raw = JSON.stringify((await get('admin').expect(200)).body);
    expect(raw).not.toContain('Synthetic Guest');
    expect(raw).not.toContain('9999999999');
    expect(raw).not.toMatch(/contactName|contactPhone|customerId|tokenNumber/);
  });

  it('Co-Founder in an admin session can read it; owners, customers and non-admin sessions cannot', async () => {
    await get('cofounder').expect(200);
    for (const who of ['cofounderStaff', 'ownerBusy', 'customer'])
      expect((await get(who)).status).toBe(403);
    expect(
      (await request(app.getHttpServer()).get('/api/v1/admin/live-queue'))
        .status,
    ).toBe(401);
  });
});

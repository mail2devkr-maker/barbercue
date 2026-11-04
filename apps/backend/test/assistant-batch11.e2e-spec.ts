import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SalonStatus, SessionAudience, UserStatus, type AssistantTurnDto } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Action Assistant batch 11 (issue #362) on a DISPOSABLE local database: platform customer and
 * staff analytics, figures only. Customer analytics: admin, co-founder, viewer. Staff analytics:
 * admin, co-founder, HR, viewer. No customer or staff name, email or phone is ever returned.
 */
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

maybe('Action Assistant batch 11 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface: 'admin' })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, r: r.body.result })}`);
        return r.body as AssistantTurnDto;
      });
  async function user(label: string, role: Role, audience: SessionAudience) {
    const u = await prisma.user.create({
      data: { email: `asst11-${run}-${label}@example.test`, phone: `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
    });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId: null } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    for (const [label, role] of [['admin', Role.PLATFORM_ADMIN], ['cofounder', Role.CO_FOUNDER], ['hr', Role.HR_ADMIN], ['sales', Role.SALES_ADMIN], ['viewer', Role.PLATFORM_VIEWER]] as const) {
      await user(label, role, SessionAudience.ADMIN);
    }
    const owner = await user('owner', Role.SALON_OWNER, SessionAudience.STAFF);
    const city = await prisma.city.create({ data: { name: `Asst11 ${run}`, slug: `asst11-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    const salon = await prisma.salon.create({
      data: { ownerUserId: owner.id, name: `Asst11 Shop ${run}`, slug: `asst11-${run}`, cityId: city.id, addressLine: 'Synthetic', timezone: 'Asia/Kolkata', currency: 'INR', status: SalonStatus.ACTIVE },
    });
    const haircut = await prisma.service.create({ data: { salonId: salon.id, name: 'Haircut', durationMinutes: 30, price: 200 } });
    await user('cust', Role.CUSTOMER, SessionAudience.CUSTOMER);
    const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const start = new Date(`${istToday}T12:00:00+05:30`);
    await prisma.booking.create({
      data: { salonId: salon.id, serviceId: haircut.id, customerId: ids.cust, source: 'WEB', status: 'COMPLETED', slotStart: start, slotEnd: new Date(start.getTime() + 1_800_000), idempotencyKey: `asst11-${run}` },
    });
    const barber = await user('barber', Role.SALON_STAFF, SessionAudience.STAFF);
    await prisma.salonStaff.create({ data: { salonId: salon.id, userId: barber.id, displayName: `Barber ${run}`, roleInSalon: 'BARBER', status: 'ACTIVE' } });
  });

  afterAll(async () => {
    await app?.close();
  });

  const personal = async () => {
    const users = await prisma.user.findMany({ where: { id: { in: [ids.cust, ids.barber] } } });
    return [...users.flatMap((u) => [u.email!, u.phone!]), `Barber ${run}`];
  };

  it('customer analytics: figures for admin, co-founder and viewer, never a person', async () => {
    for (const who of ['admin', 'cofounder', 'viewer']) {
      const r = await say(who, 'aaj kitne customers aaye');
      expect({ who, status: r.status }).toEqual({ who, status: 'DONE' });
      expect(Number(r.result?.items?.find((i) => i.title === 'Completed visits')?.detail)).toBeGreaterThanOrEqual(1);
      for (const secret of await personal()) expect(JSON.stringify(r)).not.toContain(secret);
    }
    for (const who of ['hr', 'sales']) expect((await say(who, 'aaj kitne customers aaye')).status).toBe('DENIED');
  });

  it('staff analytics: admin, co-founder, HR and viewer; sales and shop owners are refused', async () => {
    for (const who of ['admin', 'cofounder', 'hr', 'viewer']) {
      const r = await say(who, 'is hafte staff analytics');
      expect({ who, status: r.status }).toEqual({ who, status: 'DONE' });
      expect(Number(r.result?.items?.find((i) => i.title === 'Active staff')?.detail)).toBeGreaterThanOrEqual(1);
      for (const secret of await personal()) expect(JSON.stringify(r)).not.toContain(secret);
    }
    expect((await say('sales', 'is hafte staff analytics')).status).toBe('DENIED');
    expect((await say('owner', 'is hafte staff analytics')).status).toBe('DENIED');
  });
});

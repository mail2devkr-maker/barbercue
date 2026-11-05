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
 * Action Assistant batch 12 (issue #362) on a DISPOSABLE local database: a barber's own day (no
 * customer phone numbers), the owner's cancellation figures (owner/admin only), and a customer's
 * credit balance. All read-only. Written to be stable on a shared CI database.
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

maybe('Action Assistant batch 12 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string, surface: 'shop' | 'customer' = 'shop', salonId: string = ids.salon) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface, ...(surface === 'shop' ? { salonId } : {}) })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, r: r.body.result })}`);
        return r.body as AssistantTurnDto;
      });
  async function user(label: string, role: Role, audience: SessionAudience, salonId: string | null = null, phone?: string) {
    const u = await prisma.user.create({ data: { email: `asst12-${run}-${label}@example.test`, phone, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }

  beforeAll(async () => {
    // These suites exercise the assistant itself, so the release gate is opened for everyone here.
    process.env.ASSISTANT_MODE = 'all';
    process.env.ASSISTANT_WRITES = 'all';
    // Disposable test database only: every shop and every action may be edited here (#372).
    process.env.ASSISTANT_WRITE_SALON_IDS = '*';
    process.env.ASSISTANT_WRITE_ACTIONS = '*';
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

    const city = await prisma.city.create({ data: { name: `Asst12 ${run}`, slug: `asst12-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    for (const label of ['salon', 'otherSalon']) {
      const owner = await user(`${label}Owner`, Role.SALON_OWNER, SessionAudience.STAFF);
      const salon = await prisma.salon.create({
        data: { ownerUserId: owner.id, name: `Asst12 ${label} ${run}`, slug: `asst12-${label}-${run}`, cityId: city.id, addressLine: 'Synthetic', timezone: 'Asia/Kolkata', currency: 'INR', status: SalonStatus.ACTIVE },
      });
      await prisma.userRole.updateMany({ where: { userId: owner.id }, data: { salonId: salon.id } });
      ids[label] = salon.id;
    }
    ids.haircut = (await prisma.service.create({ data: { salonId: ids.salon, name: 'Haircut', durationMinutes: 30, price: 200 } })).id;
    const barber = await user('barber', Role.SALON_STAFF, SessionAudience.STAFF, ids.salon);
    ids.staff = (await prisma.salonStaff.create({ data: { salonId: ids.salon, userId: barber.id, displayName: `Ravi ${run}`, roleInSalon: 'BARBER', status: 'ACTIVE' } })).id;
    ids.phone = `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await user('cust', Role.CUSTOMER, SessionAudience.CUSTOMER, null, ids.phone);

    // Two bookings in the last week: one cancelled by the customer, one completed.
    const past = new Date(Date.now() - 2 * 86_400_000);
    for (const [i, status] of (['CANCELLED', 'COMPLETED'] as const).entries()) {
      await prisma.booking.create({
        data: {
          salonId: ids.salon, serviceId: ids.haircut, customerId: ids.cust, source: 'WEB', status,
          slotStart: new Date(past.getTime() + i * 3_600_000), slotEnd: new Date(past.getTime() + i * 3_600_000 + 1_800_000),
          idempotencyKey: `asst12-${run}-${i}`,
          ...(status === 'CANCELLED' ? { cancelledAt: new Date(past.getTime() - 3_600_000), cancelledByActor: 'CUSTOMER' } : {}),
        },
      });
    }
    // An appointment later today for the barber.
    const later = new Date(Date.now() + 3_600_000);
    await prisma.booking.create({
      data: { salonId: ids.salon, serviceId: ids.haircut, customerId: ids.cust, preferredStaffId: ids.staff, source: 'WEB', status: 'CONFIRMED', slotStart: later, slotEnd: new Date(later.getTime() + 1_800_000), idempotencyKey: `asst12-${run}-later` },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("a barber sees their own day, without customer phone numbers", async () => {
    const r = await say('barber', 'mera aaj ka kaam dikhao');
    expect(r.status).toBe('DONE');
    expect(r.message).toContain(`Ravi ${run}`);
    expect(JSON.stringify(r)).not.toContain(ids.phone.slice(-8));
    expect((await say('barber', 'mera aaj ka kaam dikhao', 'shop', ids.otherSalon)).status).toBe('DENIED');
  });

  it('cancellation figures: owner yes; barber, other shop and customer no', async () => {
    const r = await say('salonOwner', 'is hafte ki cancellations');
    expect(r.status).toBe('DONE');
    expect(r.message).toMatch(/^last 7 days: 1 of \d+ bookings cancelled/);
    expect(r.result?.items?.find((i) => i.title === 'By customers')?.detail).toBe('1');
    expect((await say('barber', 'is hafte ki cancellations')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'is hafte ki cancellations', 'shop', ids.salon)).status).toBe('DENIED');
  });

  it("a customer reads their own credit balance", async () => {
    const r = await say('cust', 'mere credits kitne hain', 'customer');
    expect(r.status).toBe('DONE');
    expect(r.result?.items).toEqual([{ title: 'Balance', detail: '0' }]);
    expect((await say('barber', 'mere credits kitne hain', 'customer')).status).toBe('DENIED');
  });
});

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
 * Action Assistant batch 13 (issue #362) on a DISPOSABLE local database: where the shop's bookings
 * came from (owner/admin only, counts only) and the automatic staff assignment switch (team may read;
 * only the owner may change it, after confirmation; single-use; stale previews refused). Written to
 * be stable on a shared CI database: every assertion is scoped to this run's own shop.
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

maybe('Action Assistant batch 13 (e2e, disposable local database)', () => {
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
  const confirm = (who: string, t: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token: t, decision: 'confirm' })
      .expect(200)
      .then((r) => r.body as AssistantTurnDto);
  async function user(label: string, role: Role, audience: SessionAudience, salonId: string | null = null, phone?: string) {
    const u = await prisma.user.create({ data: { email: `asst13-${run}-${label}@example.test`, phone, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }
  const autoAssign = async () => (await prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } })).queueAutoAssignEnabled;

  beforeAll(async () => {
    // These suites exercise the assistant itself, so the release gate is opened for everyone here.
    process.env.ASSISTANT_MODE = 'all';
    process.env.ASSISTANT_WRITES = 'all';
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

    const city = await prisma.city.create({ data: { name: `Asst13 ${run}`, slug: `asst13-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    for (const label of ['salon', 'otherSalon']) {
      const owner = await user(`${label}Owner`, Role.SALON_OWNER, SessionAudience.STAFF);
      const salon = await prisma.salon.create({
        data: { ownerUserId: owner.id, name: `Asst13 ${label} ${run}`, slug: `asst13-${label}-${run}`, cityId: city.id, addressLine: 'Synthetic', timezone: 'Asia/Kolkata', currency: 'INR', status: SalonStatus.ACTIVE },
      });
      await prisma.userRole.updateMany({ where: { userId: owner.id }, data: { salonId: salon.id } });
      ids[label] = salon.id;
    }
    ids.haircut = (await prisma.service.create({ data: { salonId: ids.salon, name: 'Haircut', durationMinutes: 30, price: 200 } })).id;
    const barber = await user('barber', Role.SALON_STAFF, SessionAudience.STAFF, ids.salon);
    await prisma.salonStaff.create({ data: { salonId: ids.salon, userId: barber.id, displayName: `Ravi ${run}`, roleInSalon: 'BARBER', status: 'ACTIVE' } });
    ids.phone = `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await user('cust', Role.CUSTOMER, SessionAudience.CUSTOMER, null, ids.phone);

    // Three bookings made just now: two on the website, one walk-in.
    const slot = new Date(Date.now() + 5 * 86_400_000);
    for (const [i, source] of (['WEB', 'WEB', 'WALK_IN'] as const).entries()) {
      await prisma.booking.create({
        data: {
          salonId: ids.salon, serviceId: ids.haircut, customerId: ids.cust, source, status: 'CONFIRMED',
          slotStart: new Date(slot.getTime() + i * 3_600_000), slotEnd: new Date(slot.getTime() + i * 3_600_000 + 1_800_000),
          idempotencyKey: `asst13-${run}-${i}`,
        },
      });
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('booking sources: the owner sees counts; a barber and another shop do not', async () => {
    const r = await say('salonOwner', 'is mahine bookings kahan se aayi');
    expect(r.status).toBe('DONE');
    expect(r.message).toBe('last 30 days: 3 bookings. Most came from FastQue website (2).');
    expect(r.result?.items).toEqual([
      { title: 'FastQue website', detail: '2' },
      { title: 'Walk-in', detail: '1' },
    ]);
    expect(JSON.stringify(r)).not.toContain(ids.phone.slice(-8));
    expect((await say('salonOwner', 'aaj ki booking sources dikhao')).message).toMatch(/^today: 3 bookings/);
    expect((await say('barber', 'is mahine bookings kahan se aayi')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'is mahine bookings kahan se aayi', 'shop', ids.salon)).status).toBe('DENIED');
  });

  it('auto-assign: the team can read it; only the owner can switch it, once, after confirming', async () => {
    expect(await autoAssign()).toBe(true);
    const view = await say('barber', 'auto assign on hai kya');
    expect(view.status).toBe('DONE');
    expect(view.result?.items).toEqual([{ title: 'Status', detail: 'On' }]);
    expect((await say('barber', 'auto assign band karo')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'auto assign band karo', 'shop', ids.salon)).status).toBe('DENIED');

    const preview = await say('salonOwner', 'auto assign band karo');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    expect(preview.preview?.rows).toEqual([{ label: 'Automatic staff assignment', before: 'On', after: 'Off' }]);
    // Nothing changes before confirmation, and another user cannot use the owner's token.
    expect(await autoAssign()).toBe(true);
    expect((await confirm('barber', preview.confirmation!.token)).status).not.toBe('DONE');
    expect(await autoAssign()).toBe(true);
    const done = await confirm('salonOwner', preview.confirmation!.token);
    expect(done.status).toBe('DONE');
    expect(done.refresh).toContain('queue');
    expect(await autoAssign()).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityId: ids.salon, action: 'QUEUE_AUTO_ASSIGN_DISABLED' } })).toBe(1);
    expect((await confirm('salonOwner', preview.confirmation!.token)).status).toBe('FAILED');
    expect((await say('salonOwner', 'auto assign off karo')).message).toBe('Automatic staff assignment is already OFF.');
  });

  it('a switch preview goes stale if the setting changed in the meantime', async () => {
    const preview = await say('salonOwner', 'auto assign chalu karo');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    await prisma.salon.update({ where: { id: ids.salon }, data: { queueAutoAssignEnabled: true } });
    expect((await confirm('salonOwner', preview.confirmation!.token)).status).toBe('FAILED');
    expect(await prisma.auditLog.count({ where: { entityId: ids.salon, action: 'QUEUE_AUTO_ASSIGN_ENABLED' } })).toBe(0);
  });
});

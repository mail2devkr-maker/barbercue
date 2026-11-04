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
 * Action Assistant batch 5 (issue #362) on a DISPOSABLE local database: offers saved only as drafts
 * and edited by the owner, the shop's public profile, a customer reviewing a completed visit, and
 * anyone changing their app language. Staff and other shops are refused.
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

const TZ = 'Asia/Kolkata';
type Surface = 'shop' | 'customer' | 'admin';

maybe('Action Assistant batch 5 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string, surface: Surface = 'shop') =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface, ...(surface === 'shop' ? { salonId: ids.salon } : {}) })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, o: r.body.options })}`);
        return r.body as AssistantTurnDto;
      });
  const confirm = (who: string, t: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token: t, decision: 'confirm', acknowledged: true }) // "I understand" ticked (#372)
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[confirm] ${who} => ${JSON.stringify({ s: r.body.status, m: r.body.message })}`);
        return r.body as AssistantTurnDto;
      });
  async function doWrite(who: string, text: string, surface: Surface = 'shop') {
    const preview = await say(who, text, surface);
    expect({ text, status: preview.status, message: preview.message }).toMatchObject({ status: 'NEEDS_CONFIRMATION' });
    const done = await confirm(who, preview.confirmation!.token);
    expect({ text, status: done.status, message: done.message }).toMatchObject({ status: 'DONE' });
    return { preview, done };
  }
  async function user(label: string, role: Role, salonId: string | null, audience: SessionAudience) {
    const u = await prisma.user.create({ data: { email: `asst5-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
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

    const city = await prisma.city.create({ data: { name: `Asst5 ${run}`, slug: `asst5-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    for (const label of ['salon', 'otherSalon']) {
      const owner = await user(`${label}Owner`, Role.SALON_OWNER, null, SessionAudience.STAFF);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id, name: `Asst5 ${label} ${run}`, slug: `asst5-${label}-${run}`, cityId: city.id,
          addressLine: 'Synthetic', timezone: TZ, currency: 'INR', status: SalonStatus.ACTIVE,
        },
      });
      await prisma.userRole.updateMany({ where: { userId: owner.id }, data: { salonId: salon.id } });
      ids[label] = salon.id;
    }
    ids.haircut = (await prisma.service.create({ data: { salonId: ids.salon, name: 'Haircut', durationMinutes: 30, price: 200 } })).id;
    const barber = await user('barberRavi', Role.SALON_STAFF, ids.salon, SessionAudience.STAFF);
    await prisma.salonStaff.create({ data: { salonId: ids.salon, userId: barber.id, displayName: 'Ravi', roleInSalon: 'BARBER', status: 'ACTIVE' } });
    await user('custA', Role.CUSTOMER, null, SessionAudience.CUSTOMER);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates an offer only as a draft, once, and only for the owner', async () => {
    const { preview } = await doWrite('salonOwner', 'Diwali offer banao 20% off 10 din ke liye');
    expect(preview.preview?.rows).toEqual(
      expect.arrayContaining([
        { label: 'Discount', before: null, after: '20% off' },
        { label: 'Services', before: null, after: 'All services' },
      ]),
    );
    const offer = await prisma.offer.findFirstOrThrow({ where: { salonId: ids.salon, title: 'Diwali' } });
    expect(offer).toMatchObject({ status: 'DRAFT', discountType: 'PERCENT' });
    expect(Number(offer.discountValue)).toBe(20);
    const days = (offer.validTo.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(9);
    expect(days).toBeLessThan(11.1);
    expect((await confirm('salonOwner', preview.confirmation!.token)).status).toBe('FAILED');
    expect(await prisma.offer.count({ where: { salonId: ids.salon } })).toBe(1);

    expect((await say('barberRavi', 'Holi offer banao 10% off 5 din ke liye')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'Holi offer banao 10% off 5 din ke liye')).status).toBe('DENIED');
    expect((await say('salonOwner', 'Holi offer banao 150% off 5 din ke liye')).status).toBe('NEEDS_INPUT');
    expect(await prisma.offer.count({ where: { salonId: ids.salon } })).toBe(1);
  });

  it('edits a draft offer, and refuses to edit a live one', async () => {
    await doWrite('salonOwner', 'Diwali offer 25% karo');
    const offer = await prisma.offer.findFirstOrThrow({ where: { salonId: ids.salon, title: 'Diwali' } });
    expect(Number(offer.discountValue)).toBe(25);

    await prisma.offer.update({ where: { id: offer.id }, data: { status: 'ACTIVE' } });
    const live = await say('salonOwner', 'Diwali offer 30% karo');
    expect(live.status).toBe('NEEDS_INPUT');
    expect(live.message).toMatch(/Pause it first/);
    expect(Number((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).discountValue)).toBe(25);
  });

  it('shows and changes the public shop profile with a visibility warning', async () => {
    const view = await say('salonOwner', 'dukaan ki profile dikhao');
    expect(view.status).toBe('DONE');
    expect(view.result?.items?.map((i) => i.title)).toEqual(['Phone', 'Email', 'Address', 'Description']);

    const { preview } = await doWrite('salonOwner', 'Dukaan ka description badlo: Best haircuts in town');
    expect(preview.preview?.warning).toMatch(/public shop page/);
    expect((await prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } })).description).toBe('Best haircuts in town');

    expect((await say('salonOwner', 'salon ka email: not-an-email')).status).toBe('NEEDS_INPUT');
    expect((await say('barberRavi', 'Dukaan ka description badlo: hacked')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'Dukaan ka description badlo: hacked')).status).toBe('DENIED');
    expect((await prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } })).description).toBe('Best haircuts in town');
  });

  it('a customer reviews their own completed visit once', async () => {
    const past = new Date(Date.now() - 26 * 3_600_000);
    const b = await prisma.booking.create({
      data: {
        salonId: ids.salon, serviceId: ids.haircut, customerId: ids.custA, source: 'WEB', status: 'COMPLETED',
        slotStart: past, slotEnd: new Date(past.getTime() + 1_800_000), idempotencyKey: `asst5-${run}-done`,
      },
    });
    const ask = await say('custA', 'review dena hai', 'customer');
    expect(ask.status).toBe('NEEDS_INPUT');
    expect(ask.options).toHaveLength(5);

    await doWrite('custA', 'Haircut ko 5 star review do: bahut badiya', 'customer');
    const r = await prisma.review.findFirstOrThrow({ where: { bookingId: b.id } });
    expect(r).toMatchObject({ rating: 5, comment: 'bahut badiya', customerId: ids.custA });

    const again = await say('custA', 'Haircut ko 4 star review do', 'customer');
    expect(again.status).toBe('DONE');
    expect(again.message).toMatch(/no completed visits/);
    expect(await prisma.review.count({ where: { bookingId: b.id } })).toBe(1);
  });

  it('anyone can change their own app language', async () => {
    await doWrite('custA', 'meri language Hindi karo', 'customer');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.custA } })).preferredLanguage).toBe('HI');
    expect((await say('custA', 'meri language Hindi karo', 'customer')).message).toMatch(/already/);

    await doWrite('barberRavi', 'meri language Hindi karo');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.barberRavi } })).preferredLanguage).toBe('HI');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.salonOwner } })).preferredLanguage).not.toBe('HI');
  });
});

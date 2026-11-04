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
import { AdminShopActivityService } from '../src/admin/admin-shop-activity.service';

/**
 * Action Assistant batch 9 (issue #362) on a DISPOSABLE local database: an employee schedules a
 * follow-up on their own lead; a customer edits only their own review; platform readers see shop
 * activity counts with the admin route's audience (viewer included, wrong session denied).
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

type Surface = 'employee' | 'customer' | 'admin';

maybe('Action Assistant batch 9 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string, surface: Surface) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, o: r.body.options, p: r.body.preview })}`);
        return r.body as AssistantTurnDto;
      });
  const confirm = (who: string, t: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token: t, decision: 'confirm' })
      .expect(200)
      .then((r) => r.body as AssistantTurnDto);
  async function user(label: string, role: Role, audience: SessionAudience) {
    const u = await prisma.user.create({ data: { email: `asst9-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
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

    const fe = await user('asha', Role.FIELD_EXECUTIVE, SessionAudience.EMPLOYEE);
    const profile = await prisma.employeeProfile.create({ data: { userId: fe.id, employeeCode: `A9-${run}`, fullName: 'Asha' } });
    ids.lead = (await prisma.employeeCrmLead.create({ data: { employeeProfileId: profile.id, shopName: 'Sharma Salon', status: 'CONTACTED' } })).id;

    const owner = await user('owner', Role.SALON_OWNER, SessionAudience.STAFF);
    const city = await prisma.city.create({ data: { name: `Asst9 ${run}`, slug: `asst9-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    const salon = await prisma.salon.create({
      data: { ownerUserId: owner.id, name: `Asst9 Busy Shop ${run}`, slug: `asst9-${run}`, cityId: city.id, addressLine: 'Synthetic', timezone: 'Asia/Kolkata', currency: 'INR', status: SalonStatus.ACTIVE },
    });
    await prisma.userRole.updateMany({ where: { userId: owner.id }, data: { salonId: salon.id } });
    const haircut = await prisma.service.create({ data: { salonId: salon.id, name: 'Haircut', durationMinutes: 30, price: 200 } });
    for (const label of ['custA', 'custB']) await user(label, Role.CUSTOMER, SessionAudience.CUSTOMER);
    // Noon India time today, so the bookings always fall inside "today" for the activity count.
    const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const start = new Date(`${istToday}T12:00:00+05:30`);
    for (const label of ['custA', 'custB']) {
      const b = await prisma.booking.create({
        data: { salonId: salon.id, serviceId: haircut.id, customerId: ids[label], source: 'WEB', status: 'COMPLETED', slotStart: start, slotEnd: new Date(start.getTime() + 1_800_000), idempotencyKey: `asst9-${run}-${label}` },
      });
      ids[`${label}Review`] = (await prisma.review.create({ data: { salonId: salon.id, customerId: ids[label], bookingId: b.id, rating: 5, comment: 'great' } })).id;
    }
    await user('viewer', Role.PLATFORM_VIEWER, SessionAudience.ADMIN);
    const weak = await prisma.user.create({ data: { email: `asst9-${run}-weak@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: weak.id, role: Role.PLATFORM_VIEWER, salonId: null } });
    tok.viewerWrongAudience = tokens.signAccessToken(weak.id, [Role.PLATFORM_VIEWER], SessionAudience.STAFF);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('schedules a follow-up on my own lead in India time, once; refuses a past time', async () => {
    const past = await say('asha', 'Sharma Salon ka follow up aaj 12:01 am lagao', 'employee');
    expect(past.status).toBe('NEEDS_INPUT');
    const preview = await say('asha', 'Sharma Salon ka whatsapp follow up kal 4 baje lagao: menu bhejna', 'employee');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    expect(preview.preview?.rows).toEqual(expect.arrayContaining([{ label: 'How', before: null, after: 'whatsapp' }]));
    expect((await confirm('asha', preview.confirmation!.token)).status).toBe('DONE');
    const f = await prisma.employeeCrmFollowUp.findFirstOrThrow({ where: { leadId: ids.lead } });
    expect(f).toMatchObject({ channel: 'WHATSAPP', status: 'OPEN', notes: 'menu bhejna' });
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(f.dueAt)).toBe('16:00');
    expect((await confirm('asha', preview.confirmation!.token)).status).toBe('FAILED');
    expect(await prisma.employeeCrmFollowUp.count({ where: { leadId: ids.lead } })).toBe(1);
  });

  it("a customer edits only their own review", async () => {
    const preview = await say('custA', 'Haircut ka review badlo 3 star: theek tha', 'customer');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    expect(preview.preview?.rows).toEqual(expect.arrayContaining([{ label: 'Stars', before: '★★★★★', after: '★★★' }]));
    expect((await confirm('custA', preview.confirmation!.token)).status).toBe('DONE');
    expect(await prisma.review.findUniqueOrThrow({ where: { id: ids.custAReview } })).toMatchObject({ rating: 3, comment: 'theek tha' });
    expect(await prisma.review.findUniqueOrThrow({ where: { id: ids.custBReview } })).toMatchObject({ rating: 5, comment: 'great' });
  });

  it('shop activity: counts for the viewer, refused without an admin session', async () => {
    const r = await say('viewer', 'aaj kaunsi shops busy hain', 'admin');
    expect(r.status).toBe('DONE');
    // A shared CI database has many busy shops and only the busiest 8 are listed, so compare the
    // spoken totals with the service's own figures for today instead of looking for this shop.
    const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const truth = await app.get(AdminShopActivityService).getActivity({ from: istToday, to: istToday });
    expect(truth.bookings.total).toBeGreaterThanOrEqual(2);
    expect(r.message).toContain(`${truth.bookings.total} bookings (${truth.bookings.completed} completed)`);
    expect(r.result?.items?.map((i) => i.title)).toEqual(truth.shops.slice(0, 8).map((s) => s.name));
    expect((await say('viewerWrongAudience', 'aaj kaunsi shops busy hain', 'admin')).status).toBe('DENIED');
    expect((await say('custA', 'aaj kaunsi shops busy hain', 'admin')).status).toBe('DENIED');
  });
});

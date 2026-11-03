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
import { ASSISTANT_ACTIONS } from '../src/assistant/actions/catalog';

/**
 * Action Assistant batch 3 (issue #362) over real HTTP on a DISPOSABLE local database: chairs,
 * staff weekly hours, appointment no-show, offers, reviews, invoices/revenue (read), notifications,
 * customer queue join / favorites / bills, and read-only platform figures - with the role,
 * audience and shop boundaries each one must keep.
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
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "3 nov 17:05" in the shop's time zone, so a test never depends on what "today" is. */
const spoken = (d: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.hour}:${parts.minute}`;
};

maybe('Action Assistant batch 3 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string, opts: { salonId?: string | null; surface?: 'shop' | 'customer' | 'admin' } = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface: opts.surface ?? 'shop', ...(opts.salonId === null ? {} : { salonId: opts.salonId ?? ids.salon }) })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message })}`);
        return r.body as AssistantTurnDto;
      });

  const confirm = (who: string, token: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token, decision: 'confirm' })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[confirm] ${who} => ${JSON.stringify({ s: r.body.status, m: r.body.message })}`);
        return r.body as AssistantTurnDto;
      });

  async function doWrite(who: string, text: string, opts?: Parameters<typeof say>[2]) {
    const preview = await say(who, text, opts);
    expect({ text, status: preview.status, message: preview.message }).toMatchObject({ status: 'NEEDS_CONFIRMATION' });
    const done = await confirm(who, preview.confirmation!.token);
    expect({ text, status: done.status, message: done.message }).toMatchObject({ status: 'DONE' });
    return { preview, done };
  }

  async function user(label: string, role: Role, salonId: string | null, audience: SessionAudience) {
    const u = await prisma.user.create({ data: { email: `asst3-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // Not a throttler test: one address sends more than the real 30/min here.
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    const city = await prisma.city.create({ data: { name: `Asst3 ${run}`, slug: `asst3-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    for (const label of ['salon', 'otherSalon']) {
      const owner = await user(`${label}Owner`, Role.SALON_OWNER, null, SessionAudience.STAFF);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Asst3 ${label} ${run}`,
          slug: `asst3-${label}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: TZ,
          currency: 'INR',
          status: SalonStatus.ACTIVE,
          queueAutoAssignEnabled: false,
        },
      });
      await prisma.userRole.updateMany({ where: { userId: owner.id }, data: { salonId: salon.id } });
      ids[label] = salon.id;
      for (let day = 0; day < 7; day++) {
        await prisma.operatingHours.create({ data: { salonId: salon.id, dayOfWeek: day, openTime: '00:00', closeTime: '23:59', isClosed: false } });
      }
      await prisma.chair.create({ data: { salonId: salon.id, label: 'Chair 1' } });
    }
    ids.haircut = (await prisma.service.create({ data: { salonId: ids.salon, name: 'Haircut', durationMinutes: 30, price: 200 } })).id;
    const barber = await user('barber', Role.SALON_STAFF, ids.salon, SessionAudience.STAFF);
    ids.ravi = (await prisma.salonStaff.create({ data: { salonId: ids.salon, userId: barber.id, displayName: 'Ravi', roleInSalon: 'BARBER', status: 'ACTIVE' } })).id;
    await user('custA', Role.CUSTOMER, null, SessionAudience.CUSTOMER);
    await user('admin', Role.PLATFORM_ADMIN, null, SessionAudience.ADMIN);
    await user('viewer', Role.PLATFORM_VIEWER, null, SessionAudience.ADMIN);
    // The same platform role from a non-admin (no TOTP) session must not reach platform figures.
    const weak = await prisma.user.create({ data: { email: `asst3-${run}-weak@example.test`, status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: weak.id, role: Role.PLATFORM_ADMIN, salonId: null } });
    tok.adminWrongAudience = tokens.signAccessToken(weak.id, [Role.PLATFORM_ADMIN], SessionAudience.STAFF);

    ids.offer = (
      await prisma.offer.create({
        data: {
          salonId: ids.salon,
          kind: 'OFFER',
          title: 'Diwali Dhamaka',
          discountType: 'PERCENT',
          discountValue: 10,
          currency: 'INR',
          validFrom: new Date(Date.now() - 86_400_000),
          validTo: new Date(Date.now() + 30 * 86_400_000),
          createdByUserId: ids.salonOwner,
        },
      })
    ).id;
    const served = await prisma.booking.create({
      data: {
        salonId: ids.salon, serviceId: ids.haircut, customerId: ids.custA, source: 'WEB', status: 'COMPLETED',
        slotStart: new Date(Date.now() - 3 * 86_400_000), slotEnd: new Date(Date.now() - 3 * 86_400_000 + 1_800_000),
        idempotencyKey: `asst3-${run}-served`,
      },
    });
    ids.review = (await prisma.review.create({ data: { salonId: ids.salon, customerId: ids.custA, bookingId: served.id, rating: 5, comment: 'Great cut' } })).id;
    const late = new Date(Date.now() - 90 * 60_000);
    ids.lateSlot = spoken(late);
    ids.late = (
      await prisma.booking.create({
        data: {
          salonId: ids.salon, serviceId: ids.haircut, customerId: ids.custA, source: 'WEB', status: 'CONFIRMED',
          slotStart: late, slotEnd: new Date(late.getTime() + 1_800_000), idempotencyKey: `asst3-${run}-late`,
        },
      })
    ).id;
    for (const type of ['owner.booking.created', 'owner.booking.cancelled']) {
      await prisma.notification.create({ data: { userId: ids.salonOwner, channel: 'IN_APP', type, sentAt: new Date() } });
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('advertises every catalogued action, none unavailable', async () => {
    const caps = (await request(app.getHttpServer()).get('/api/v1/assistant/capabilities').set('Authorization', `Bearer ${tok.salonOwner}`).expect(200)).body;
    expect(caps.actions).toHaveLength(Object.keys(ASSISTANT_ACTIONS).length);
    expect(caps.actions.filter((a: { state: string }) => a.state === 'UNAVAILABLE')).toHaveLength(0);
  });

  it('chairs: list, add, repair and back in use - owner only', async () => {
    expect((await say('salonOwner', 'chairs dikhao')).result?.items).toHaveLength(1);
    await doWrite('salonOwner', 'naya chair add karo Chair 2');
    const c2 = await prisma.chair.findFirstOrThrow({ where: { salonId: ids.salon, label: 'Chair 2' } });
    expect(c2.status).toBe('ACTIVE');
    await doWrite('salonOwner', 'Chair 2 maintenance mein daalo');
    expect((await prisma.chair.findUniqueOrThrow({ where: { id: c2.id } })).status).toBe('MAINTENANCE');
    await doWrite('salonOwner', 'Chair 2 chalu karo');
    expect((await prisma.chair.findUniqueOrThrow({ where: { id: c2.id } })).status).toBe('ACTIVE');
    expect((await say('barber', 'naya chair add karo Chair 9')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'chairs dikhao')).status).toBe('DENIED');
  });

  it('staff weekly hours: set a day off and show every day that becomes fixed', async () => {
    const { preview } = await doWrite('salonOwner', 'Ravi staff ka Sunday off karo');
    expect(preview.preview?.rows.find((r) => r.label === 'Sunday')).toEqual({ label: 'Sunday', before: 'Any shop hours', after: 'Off' });
    expect(preview.preview?.rows.find((r) => r.label === 'Monday')?.after).toBe('00:00–23:59 (fixed)');
    expect(preview.preview?.warning).toMatch(/shop’s current hours/);
    const sunday = await prisma.staffWorkingHours.findUniqueOrThrow({ where: { staffId_dayOfWeek: { staffId: ids.ravi, dayOfWeek: 0 } } });
    expect(sunday.isClosed).toBe(true);
    const view = await say('salonOwner', 'Ravi staff ki timing dikhao');
    expect(view.result?.items?.[0]).toEqual({ title: 'Sunday', detail: 'Off' });
    expect((await say('barber', 'Ravi staff ka Monday off karo')).status).toBe('DENIED');
  });

  it('appointment no-show after the grace period, by the owner (barbers use the Live Queue)', async () => {
    expect((await say('barber', `${ids.lateSlot} wala appointment no show`)).status).toBe('DENIED');
    await doWrite('salonOwner', `${ids.lateSlot} wala appointment no show`);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: ids.late } })).status).toBe('NO_SHOW');
    expect((await say('otherSalonOwner', `${ids.lateSlot} wala appointment no show`)).status).toBe('DENIED');
  });

  it('offers: list, publish and pause - only the real owner', async () => {
    expect((await say('salonOwner', 'offers dikhao')).result?.items?.[0]).toMatchObject({ title: 'Diwali Dhamaka', detail: 'draft' });
    const { preview } = await doWrite('salonOwner', 'Diwali offer live karo');
    expect(preview.preview?.warning).toMatch(/Customers can see/);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: ids.offer } })).status).toBe('ACTIVE');
    await doWrite('salonOwner', 'Diwali offer pause karo');
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: ids.offer } })).status).toBe('PAUSED');
    expect((await say('barber', 'offers dikhao')).status).toBe('DENIED');
    expect((await say('admin', 'offers dikhao')).status).toBe('DENIED');
  });

  it('reviews: list and reply once, keeping the owner’s words', async () => {
    expect((await say('salonOwner', 'reviews dikhao')).message).toBe('1 reviews waiting for a reply.');
    await doWrite('salonOwner', 'Review ka jawab do: Thank you, phir aaiye!');
    expect((await prisma.review.findUniqueOrThrow({ where: { id: ids.review } })).ownerResponse).toBe('Thank you, phir aaiye!');
    expect((await say('salonOwner', 'Review ka jawab do: second reply')).message).toMatch(/already has a reply/);
  });

  it('invoices and revenue report are read-only and owner/admin scoped', async () => {
    expect((await say('salonOwner', 'invoices dikhao')).status).toBe('DONE');
    const report = await say('salonOwner', 'is hafte ki sales report');
    expect(report.status).toBe('DONE');
    expect(report.result?.items?.[0]).toEqual({ title: 'Completed visits', detail: expect.any(String) });
    expect((await say('barber', 'is hafte ki sales report')).status).toBe('DENIED');
    expect((await say('custA', 'is hafte ki sales report', { surface: 'shop' })).status).toBe('DENIED');
  });

  it('notifications: each user sees and clears only their own', async () => {
    // Earlier actions in this run (no-show, queue join) notify the owner for real, so compare with the database.
    const unread = await prisma.notification.count({ where: { userId: ids.salonOwner, readAt: null } });
    expect(unread).toBeGreaterThanOrEqual(2);
    const list = await say('salonOwner', 'notifications dikhao');
    expect(list.message).toBe(`${unread} unread notifications.`);
    const custBefore = await prisma.notification.count({ where: { userId: ids.custA, readAt: null } });
    await doWrite('salonOwner', 'sab notifications read karo');
    expect(await prisma.notification.count({ where: { userId: ids.custA, readAt: null } })).toBe(custBefore);
    expect(await prisma.notification.count({ where: { userId: ids.salonOwner, readAt: null } })).toBe(0);
    // The owner clearing theirs must not touch anyone else's (the no-show above notified the customer).
    const custUnread = await prisma.notification.count({ where: { userId: ids.custA, readAt: null } });
    expect(custUnread).toBeGreaterThanOrEqual(1);
    expect((await say('custA', 'notifications dikhao', { surface: 'customer', salonId: null })).message).toBe(
      `${custUnread} unread notification${custUnread === 1 ? '' : 's'}.`,
    );
  });

  it('customer joins the salon queue once, saves and removes a favorite', async () => {
    const noPhone = await say('custA', 'mujhe queue mein lagao haircut', { surface: 'customer' });
    expect(noPhone).toMatchObject({ status: 'NEEDS_INPUT', navigateTo: '/account/profile' });
    await prisma.user.update({ where: { id: ids.custA }, data: { phone: `+9198${String(Date.now()).slice(-8)}` } });
    const { done } = await doWrite('custA', 'mujhe queue mein lagao haircut', { surface: 'customer' });
    expect(done.refresh).toEqual(['myQueue']);
    expect(await prisma.queueEntry.count({ where: { customerId: ids.custA, status: 'WAITING' } })).toBe(1);
    expect((await say('custA', 'mujhe queue mein lagao haircut', { surface: 'customer' })).message).toMatch(/already in a queue/);

    await doWrite('custA', 'is salon ko favorite karo', { surface: 'customer' });
    expect(await prisma.customerFavorite.count({ where: { userId: ids.custA, salonId: ids.salon } })).toBe(1);
    expect((await say('custA', 'meri favorite salons dikhao', { surface: 'customer', salonId: null })).result?.items).toHaveLength(1);
    await doWrite('custA', 'favorite se hatao', { surface: 'customer' });
    expect(await prisma.customerFavorite.count({ where: { userId: ids.custA } })).toBe(0);
    expect((await say('custA', 'mere bills dikhao', { surface: 'customer', salonId: null })).status).toBe('DONE');
    expect((await say('salonOwner', 'is salon ko favorite karo', { surface: 'customer' })).status).toBe('DENIED');
  });

  it('platform figures: admin and viewer from an admin session only', async () => {
    const overview = await say('admin', 'platform overview dikhao', { surface: 'admin', salonId: null });
    expect(overview.status).toBe('DONE');
    expect(overview.result?.items?.length).toBeGreaterThan(3);
    const status = await say('viewer', 'kitni shops open hain', { surface: 'admin', salonId: null });
    expect(status.status).toBe('DONE');
    expect(status.result?.items?.[0]).toMatchObject({ title: 'Registered' });
    expect((await say('adminWrongAudience', 'platform overview dikhao', { surface: 'admin', salonId: null })).status).toBe('DENIED');
    expect((await say('salonOwner', 'platform overview dikhao', { surface: 'admin', salonId: null })).status).toBe('DENIED');
    // The viewer stays read-only: shop writes are refused on the shop screen too.
    expect((await say('viewer', 'Chair 1 band karo')).status).toBe('DENIED');
  });
});

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
 * Action Assistant Phase 2 (issue #362) over real HTTP against a DISPOSABLE local database: opening
 * hours, Live Queue operations, the shop schedule, customers, renames/durations and customer
 * self-service (book, reschedule, cancel, queue status/leave) - each change verified in the database,
 * exactly once, and only for a caller allowed to make it.
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
const istDate = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
};
const istTime = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

maybe('Action Assistant Phase 2 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string, opts: { salonId?: string | null; surface?: 'shop' | 'customer' } = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({
        text,
        surface: opts.surface ?? 'shop',
        ...(opts.salonId === null ? {} : { salonId: opts.salonId ?? ids.salon }),
      })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, o: r.body.options })}`);
        return r.body as AssistantTurnDto;
      });

  const confirm = (who: string, token: string, decision: 'confirm' | 'cancel' = 'confirm') =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token, decision })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[confirm] ${who} => ${JSON.stringify({ s: r.body.status, m: r.body.message })}`);
        return r.body as AssistantTurnDto;
      });

  /** Preview, assert it is a write awaiting confirmation, confirm, assert DONE. */
  async function doWrite(who: string, text: string, opts?: Parameters<typeof say>[2]) {
    const preview = await say(who, text, opts);
    expect({ text, status: preview.status, message: preview.message }).toMatchObject({ status: 'NEEDS_CONFIRMATION' });
    const done = await confirm(who, preview.confirmation!.token);
    expect({ text, status: done.status, message: done.message }).toMatchObject({ status: 'DONE' });
    return { preview, done };
  }

  async function user(label: string, role: Role, salonId: string | null, audience: SessionAudience) {
    const u = await prisma.user.create({
      data: { email: `asst2-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE, phone: label.startsWith('cust') ? `+9198${run.replace(/\D/g, '').padEnd(6, '7').slice(0, 6)}${label === 'custA' ? '01' : '02'}` : undefined },
    });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }

  beforeAll(async () => {
    // These suites exercise the assistant itself, so the release gate is opened for everyone here.
    process.env.ASSISTANT_MODE = 'all';
    process.env.ASSISTANT_WRITES = 'all';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // The assistant's 30/min limit is real; this suite sends more than that from one address and
      // is not testing the throttler (covered elsewhere), so its counter store is stubbed here only.
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    const city = await prisma.city.create({
      data: { name: `Asst2 ${run}`, slug: `asst2-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' },
    });
    for (const label of ['salon', 'otherSalon']) {
      const owner = await prisma.user.create({
        data: { email: `asst2-${run}-${label}-owner@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
      });
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Asst2 ${label} ${run}`,
          slug: `asst2-${label}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: TZ,
          currency: 'INR',
          status: SalonStatus.ACTIVE,
          queueAutoAssignEnabled: false,
        },
      });
      await prisma.userRole.create({ data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id } });
      tok[`${label}Owner`] = tokens.signAccessToken(owner.id, [Role.SALON_OWNER], SessionAudience.STAFF);
      ids[label] = salon.id;
      for (let day = 0; day < 7; day++) {
        await prisma.operatingHours.create({ data: { salonId: salon.id, dayOfWeek: day, openTime: '00:00', closeTime: '23:59', isClosed: false } });
      }
    }
    ids.haircut = (await prisma.service.create({ data: { salonId: ids.salon, name: 'Haircut', durationMinutes: 30, price: 200 } })).id;
    ids.facial = (await prisma.service.create({ data: { salonId: ids.salon, name: 'Facial', durationMinutes: 45, price: 600 } })).id;

    // Slot capacity is min(barbers, active chairs): the shop needs a chair to take bookings.
    await prisma.chair.create({ data: { salonId: ids.salon, label: 'C1' } });
    const barber = await user('barber', Role.SALON_STAFF, ids.salon, SessionAudience.STAFF);
    await prisma.salonStaff.create({ data: { salonId: ids.salon, userId: barber.id, displayName: 'Ravi', roleInSalon: 'BARBER', status: 'ACTIVE' } });
    await user('custA', Role.CUSTOMER, null, SessionAudience.CUSTOMER);
    await user('custB', Role.CUSTOMER, null, SessionAudience.CUSTOMER);
    await user('viewer', Role.PLATFORM_VIEWER, null, SessionAudience.ADMIN);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('advertises the actions and only the caller’s own as supported; private voice is off by default', async () => {
    const owner = (await request(app.getHttpServer()).get('/api/v1/assistant/capabilities').set('Authorization', `Bearer ${tok.salonOwner}`).expect(200)).body;
    const cust = (await request(app.getHttpServer()).get('/api/v1/assistant/capabilities').set('Authorization', `Bearer ${tok.custA}`).expect(200)).body;
    expect(owner.actions.length).toBeGreaterThanOrEqual(32);
    expect(owner.interpreter).toBe('rules');
    expect(owner.voice).toEqual({ browser: true, local: false });
    const state = (dto: { actions: Array<{ id: string; state: string }> }, id: string) => dto.actions.find((a) => a.id === id)!.state;
    expect(state(owner, 'hours.set')).toBe('SUPPORTED');
    expect(state(owner, 'me.book')).toBe('DENIED');
    expect(state(cust, 'me.book')).toBe('SUPPORTED');
    expect(state(cust, 'hours.set')).toBe('DENIED');
    await request(app.getHttpServer())
      .post('/api/v1/assistant/transcriptions')
      .set('Authorization', `Bearer ${tok.custA}`)
      .attach('audio', Buffer.from('fake'), { filename: 'a.webm', contentType: 'audio/webm' })
      .expect(503);
  });

  it('opening hours: view, close a day, change a day, and refuse other roles', async () => {
    const view = await say('salonOwner', 'dukan ki timing dikhao');
    expect(view.status).toBe('DONE');
    expect(view.result?.items).toHaveLength(7);

    const sunday = await doWrite('salonOwner', 'Sunday band rakho');
    expect(sunday.preview.preview?.rows).toEqual([{ label: 'Sunday', before: '00:00–23:59', after: 'Closed' }]);
    expect((await prisma.operatingHours.findFirstOrThrow({ where: { salonId: ids.salon, dayOfWeek: 0 } })).isClosed).toBe(true);

    await doWrite('salonOwner', 'Monday 10 se 8 baje khulega');
    expect(await prisma.operatingHours.findFirstOrThrow({ where: { salonId: ids.salon, dayOfWeek: 1 } })).toMatchObject({
      openTime: '10:00',
      closeTime: '20:00',
      isClosed: false,
    });

    expect((await say('barber', 'Tuesday band rakho')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'Tuesday band rakho')).status).toBe('DENIED');
    expect((await say('viewer', 'Tuesday band rakho')).status).toBe('DENIED');
    expect((await prisma.operatingHours.findFirstOrThrow({ where: { salonId: ids.salon, dayOfWeek: 2 } })).isClosed).toBe(false);

    // Restore every day open so the booking tests below are independent of today's weekday.
    await doWrite('salonOwner', 'har din 00:00 se 23:59 baje khulega');
  });

  it('live queue: add walk-ins, call next, no-show and cancel by token - once each', async () => {
    await doWrite('barber', 'walk-in add karo Amit');
    await doWrite('barber', 'walk-in add karo Sunil');
    const entries = await prisma.queueEntry.findMany({ where: { salonId: ids.salon }, orderBy: { tokenNumber: 'asc' } });
    expect(entries.map((e) => [e.contactName, e.status])).toEqual([
      ['Amit', 'WAITING'],
      ['Sunil', 'WAITING'],
    ]);

    const call = await say('barber', 'agla customer bulao');
    const called = await confirm('barber', call.confirmation!.token);
    expect(called.status).toBe('DONE');
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: entries[0].id } })).status).toBe('CALLED');
    expect((await confirm('barber', call.confirmation!.token)).status).toBe('FAILED');

    await doWrite('barber', `token ${entries[0].tokenNumber} no show`);
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: entries[0].id } })).status).toBe('NO_SHOW');

    // Stale: a cancel previewed, then the entry changes, then the old confirmation is refused.
    const stalePreview = await say('salonOwner', `token ${entries[1].tokenNumber} cancel karo`);
    await doWrite('barber', 'agla customer bulao');
    expect((await confirm('salonOwner', stalePreview.confirmation!.token)).status).toBe('FAILED');
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: entries[1].id } })).status).toBe('CALLED');

    await doWrite('salonOwner', `token ${entries[1].tokenNumber} cancel karo`);
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: entries[1].id } })).status).toBe('CANCELLED');

    expect((await say('custA', 'agla customer bulao')).status).toBe('DENIED');
    expect((await say('otherSalonOwner', 'agla customer bulao')).status).toBe('DENIED');
  });

  it('customer books through the assistant exactly once, sees only their own bookings, and reschedules', async () => {
    const preview = await say('custA', 'kal shaam 5 baje haircut book karo', { surface: 'customer' });
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    expect(preview.preview?.rows.find((r) => r.label === 'When')?.after).toContain('17:00');
    const done = await confirm('custA', preview.confirmation!.token);
    expect(done.status).toBe('DONE');
    expect(done.refresh).toEqual(['myBookings']);
    const mine = await prisma.booking.findMany({ where: { customerId: ids.custA } });
    expect(mine).toHaveLength(1);
    expect(istDate(1)).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(mine[0].slotStart));
    expect(istTime(mine[0].slotStart)).toBe('17:00');
    ids.bookingA = mine[0].id;

    expect((await confirm('custA', preview.confirmation!.token)).status).toBe('FAILED');
    expect(await prisma.booking.count({ where: { customerId: ids.custA } })).toBe(1);

    const listA = await say('custA', 'meri bookings dikhao', { surface: 'customer', salonId: null });
    expect(listA.result?.items).toHaveLength(1);
    const listB = await say('custB', 'meri bookings dikhao', { surface: 'customer', salonId: null });
    expect(listB.result?.items).toHaveLength(0);

    await doWrite('custA', 'mera appointment kal 7 baje kar do', { surface: 'customer', salonId: null });
    expect(istTime((await prisma.booking.findUniqueOrThrow({ where: { id: ids.bookingA } })).slotStart)).toBe('19:00');
  });

  it('shop sees the schedule and reschedules / cancels appointments; customers cannot', async () => {
    const schedule = await say('salonOwner', 'kal ke appointments dikhao');
    expect(schedule.status).toBe('DONE');
    expect(schedule.result?.items?.some((i) => i.title.startsWith('19:00 · Haircut'))).toBe(true);

    await doWrite('salonOwner', 'kal 7 baje wala appointment 8 baje kar do');
    expect(istTime((await prisma.booking.findUniqueOrThrow({ where: { id: ids.bookingA } })).slotStart)).toBe('20:00');

    expect((await say('custB', 'kal raat 8 baje ka appointment cancel karo')).status).not.toBe('NEEDS_CONFIRMATION');
    expect((await say('otherSalonOwner', 'kal raat 8 baje ka appointment cancel karo')).status).toBe('DENIED');

    await doWrite('salonOwner', 'kal raat 8 baje ka appointment cancel karo');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: ids.bookingA } })).status).toBe('CANCELLED');
  });

  it('customer cancels their own appointment and another customer cannot touch it', async () => {
    await doWrite('custB', 'kal subah 11 baje facial book karo', { surface: 'customer' });
    const b = await prisma.booking.findFirstOrThrow({ where: { customerId: ids.custB } });
    expect((await say('custA', 'mera appointment cancel karo', { surface: 'customer', salonId: null })).status).toBe('DONE');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');
    await doWrite('custB', 'mera appointment cancel karo', { surface: 'customer', salonId: null });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CANCELLED');
  });

  it('customer queue status and leave', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/salons/${ids.salon}/queue/join`)
      .set('Authorization', `Bearer ${tok.custA}`)
      .set('Idempotency-Key', randomUUID())
      .send({ serviceId: ids.haircut })
      .expect((r) => {
        if (r.status !== 201) throw new Error(`join ${r.status}: ${JSON.stringify(r.body)}`);
      });
    const status = await say('custA', 'meri queue ka status batao', { surface: 'customer', salonId: null });
    expect(status.status).toBe('DONE');
    expect(status.message).toMatch(/number 1 in line/);
    await doWrite('custA', 'queue chhod do', { surface: 'customer', salonId: null });
    expect(await prisma.queueEntry.count({ where: { customerId: ids.custA, status: { in: ['WAITING', 'CALLED'] } } })).toBe(0);
    expect((await say('custB', 'queue chhod do', { surface: 'customer', salonId: null })).message).toContain('not in any queue');
  });

  it('renames and durations; customers directory is owner-only and masks phones', async () => {
    await doWrite('salonOwner', 'rename service Facial to Gold Facial');
    expect((await prisma.service.findUniqueOrThrow({ where: { id: ids.facial } })).name).toBe('Gold Facial');
    await doWrite('salonOwner', 'haircut 45 minute karo');
    expect((await prisma.service.findUniqueOrThrow({ where: { id: ids.haircut } })).durationMinutes).toBe(45);
    await doWrite('salonOwner', 'Ravi staff ka naam Ravi Kumar karo');
    expect(await prisma.salonStaff.count({ where: { salonId: ids.salon, displayName: 'Ravi Kumar' } })).toBe(1);
    expect((await say('barber', 'rename service Gold Facial to Facial')).status).toBe('DENIED');

    const customers = await say('salonOwner', 'customers dikhao');
    expect(customers.status).toBe('DONE');
    const body = JSON.stringify(customers);
    const custA = await prisma.user.findUniqueOrThrow({ where: { id: ids.custA } });
    if (custA.phone) expect(body).not.toContain(custA.phone);
    expect((await say('barber', 'customers dikhao')).status).toBe('DENIED');
  });

  it('a customer surface never runs shop actions, even with a shop id', async () => {
    const before = await prisma.service.findUniqueOrThrow({ where: { id: ids.haircut } });
    const r = await say('custA', 'Haircut price 1 karo', { surface: 'customer' });
    expect(['UNSUPPORTED', 'DENIED']).toContain(r.status);
    expect(Number((await prisma.service.findUniqueOrThrow({ where: { id: ids.haircut } })).price)).toBe(Number(before.price));
    // And an owner cannot use customer self-service actions.
    expect((await say('salonOwner', 'kal 5 baje haircut book karo', { surface: 'customer' })).status).toBe('DENIED');
  });
});

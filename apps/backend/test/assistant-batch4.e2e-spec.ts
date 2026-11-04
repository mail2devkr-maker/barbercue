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
 * Action Assistant batch 4 (issue #362) on a DISPOSABLE local database: seating a queue customer
 * only with an explicitly chosen barber and chair, starting the service, in-shop appointments that
 * save a phone only with stated consent, and correcting a no-show to completed.
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
const spoken = (d: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.hour}:${parts.minute}`;
};
const istTime = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

maybe('Action Assistant batch 4 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let token = 0;

  const say = (who: string, text: string, salonId: string | null = ids.salon) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface: 'shop', ...(salonId ? { salonId } : {}) })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, o: r.body.options })}`);
        return r.body as AssistantTurnDto;
      });
  const confirm = (who: string, t: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token: t, decision: 'confirm' })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[confirm] ${who} => ${JSON.stringify({ s: r.body.status, m: r.body.message })}`);
        return r.body as AssistantTurnDto;
      });
  async function doWrite(who: string, text: string) {
    const preview = await say(who, text);
    expect({ text, status: preview.status, message: preview.message }).toMatchObject({ status: 'NEEDS_CONFIRMATION' });
    const done = await confirm(who, preview.confirmation!.token);
    expect({ text, status: done.status, message: done.message }).toMatchObject({ status: 'DONE' });
    return { preview, done };
  }
  async function user(label: string, role: Role, salonId: string | null, audience: SessionAudience) {
    const u = await prisma.user.create({ data: { email: `asst4-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }
  const walkIn = (name: string) =>
    prisma.queueEntry.create({ data: { salonId: ids.salon, source: 'WALK_IN', status: 'WAITING', tokenNumber: ++token, contactName: name, serviceId: ids.haircut } });

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

    const city = await prisma.city.create({ data: { name: `Asst4 ${run}`, slug: `asst4-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    for (const label of ['salon', 'otherSalon']) {
      const owner = await user(`${label}Owner`, Role.SALON_OWNER, null, SessionAudience.STAFF);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id, name: `Asst4 ${label} ${run}`, slug: `asst4-${label}-${run}`, cityId: city.id,
          addressLine: 'Synthetic', timezone: TZ, currency: 'INR', status: SalonStatus.ACTIVE, queueAutoAssignEnabled: false,
        },
      });
      await prisma.userRole.updateMany({ where: { userId: owner.id }, data: { salonId: salon.id } });
      ids[label] = salon.id;
      for (let day = 0; day < 7; day++) {
        await prisma.operatingHours.create({ data: { salonId: salon.id, dayOfWeek: day, openTime: '00:00', closeTime: '23:59', isClosed: false } });
      }
    }
    ids.haircut = (await prisma.service.create({ data: { salonId: ids.salon, name: 'Haircut', durationMinutes: 30, price: 200 } })).id;
    ids.chair1 = (await prisma.chair.create({ data: { salonId: ids.salon, label: 'Chair 1' } })).id;
    ids.chair2 = (await prisma.chair.create({ data: { salonId: ids.salon, label: 'Chair 2' } })).id;
    for (const name of ['Ravi', 'Sunil']) {
      const u = await user(`barber${name}`, Role.SALON_STAFF, ids.salon, SessionAudience.STAFF);
      ids[name] = (await prisma.salonStaff.create({ data: { salonId: ids.salon, userId: u.id, displayName: name, roleInSalon: 'BARBER', status: 'ACTIVE' } })).id;
    }
    await user('custA', Role.CUSTOMER, null, SessionAudience.CUSTOMER);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('never picks a barber or chair itself: it offers the free pairs and changes nothing', async () => {
    const e = await walkIn('Amit');
    const ask = await say('barberRavi', `token ${e.tokenNumber} assign karo`);
    expect(ask.status).toBe('NEEDS_INPUT');
    expect(ask.options?.map((o) => o.label)).toEqual(expect.arrayContaining(['Ravi · Chair 1', 'Sunil · Chair 2']));
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: e.id } })).assignedStaffId).toBeNull();

    const onlyBarber = await say('barberRavi', `token ${e.tokenNumber} Ravi ko assign karo`);
    expect(onlyBarber.status).toBe('NEEDS_INPUT');
    expect(onlyBarber.options?.every((o) => o.label.startsWith('Ravi · '))).toBe(true);
  });

  it('seats with the chosen barber and chair, then starts the service - once each', async () => {
    const e = await prisma.queueEntry.findFirstOrThrow({ where: { salonId: ids.salon, contactName: 'Amit' } });
    const { preview } = await doWrite('barberRavi', `token ${e.tokenNumber} Ravi Chair 1 assign karo`);
    expect(preview.preview?.rows).toEqual(expect.arrayContaining([{ label: 'Barber', before: null, after: 'Ravi' }, { label: 'Chair', before: null, after: 'Chair 1' }]));
    const seated = await prisma.queueEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(seated).toMatchObject({ status: 'CALLED', assignedStaffId: ids.Ravi, assignedChairId: ids.chair1 });
    expect((await confirm('barberRavi', preview.confirmation!.token)).status).toBe('FAILED');

    await doWrite('barberRavi', `token ${e.tokenNumber} start karo`);
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('IN_SERVICE');
  });

  it('a busy barber or chair is no longer offered, and outsiders are denied', async () => {
    const e = await walkIn('Neha');
    const ask = await say('salonOwner', `token ${e.tokenNumber} assign karo`);
    expect(ask.options?.map((o) => o.label)).toEqual(['Sunil · Chair 2']);
    expect((await say('custA', `token ${e.tokenNumber} Sunil Chair 2 assign karo`)).status).toBe('DENIED');
    expect((await say('otherSalonOwner', `token ${e.tokenNumber} Sunil Chair 2 assign karo`)).status).toBe('DENIED');
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: e.id } })).assignedStaffId).toBeNull();
  });

  it('in-shop appointment saves a phone only when the customer agreed, and books once', async () => {
    const noConsent = await say('salonOwner', 'Amit ke liye kal 5 baje haircut appointment book karo 98765 43210');
    expect(noConsent.preview?.rows.find((r) => r.label === 'Mobile')?.after).toBe('Not saved');
    expect(noConsent.preview?.warning).toMatch(/NOT saved/);
    expect((await confirm('salonOwner', noConsent.confirmation!.token)).status).toBe('DONE');
    const amit = await prisma.booking.findFirstOrThrow({ where: { salonId: ids.salon, guestName: 'Amit' } });
    expect(amit).toMatchObject({ source: 'IN_SHOP', guestPhone: null, customerId: null, status: 'CONFIRMED' });
    expect(istTime(amit.slotStart)).toBe('17:00');
    expect((await confirm('salonOwner', noConsent.confirmation!.token)).status).toBe('FAILED');
    expect(await prisma.booking.count({ where: { salonId: ids.salon, guestName: 'Amit' } })).toBe(1);

    await doWrite('salonOwner', 'Riya ke liye kal 6 baje haircut appointment book karo 98765 43211 customer agreed');
    const riya = await prisma.booking.findFirstOrThrow({ where: { salonId: ids.salon, guestName: 'Riya' } });
    expect(riya.guestPhone).toContain('9876543211');
    expect((await say('custA', 'Riya ke liye kal 7 baje haircut appointment book karo')).status).toBe('DENIED');
  });

  it('corrects a mistaken no-show to completed, with a clear warning', async () => {
    const past = new Date(Date.now() - 2 * 3_600_000);
    const b = await prisma.booking.create({
      data: {
        salonId: ids.salon, serviceId: ids.haircut, customerId: ids.custA, source: 'WEB', status: 'NO_SHOW',
        slotStart: past, slotEnd: new Date(past.getTime() + 1_800_000), idempotencyKey: `asst4-${run}-ns`,
      },
    });
    const { preview } = await doWrite('salonOwner', `${spoken(past)} wala appointment no show galat tha completed karo`);
    expect(preview.preview?.warning).toMatch(/removes the no-show and any no-show charge/);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('COMPLETED');
    expect((await say('otherSalonOwner', `${spoken(past)} wala appointment no show galat tha completed karo`)).status).toBe('DENIED');
  });
});

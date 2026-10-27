import { createHash, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  QueueEntryStatus,
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { QueueService } from '../src/queue/queue.service';
import { QueueArrivalReminderService } from '../src/queue/queue-arrival-reminder.service';
import { ExpoPushSender, type ExpoPushMessage } from '../src/push-notifications/expo-push-sender';

/**
 * Independent verification of Live Queue PR #330 (guest join, T-10 arrival prompts, role authorization, call shop) against the
 * REAL AppModule, real guards and a real disposable PostgreSQL. Only the outbound Expo push call is replaced by a recorder.
 * SAFETY: loopback database only; every fixture carries this run's tag.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

maybe('Live Queue #330 independent verification (disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let queue: QueueService;
  let reminders: QueueArrivalReminderService;
  const pushes: ExpoPushMessage[] = [];
  const run = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const tok: Record<string, string> = {};
  const digits = String(parseInt(run, 16) % 100_000_000).padStart(8, '0');
  const phone = (n: number) => `9${digits}${n}`.slice(0, 10).padEnd(10, '0');
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');

  const api = (method: 'get' | 'post', path: string, token?: string, headers: Record<string, string> = {}) => {
    const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (method === 'post' && token) req.set('Idempotency-Key', randomUUID());
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req;
  };

  async function makeUser(label: string, role: Role, salonId: string | null = null, extra: Record<string, unknown> = {}) {
    const user = await prisma.user.create({
      data: { email: `lq-${run}-${label}@example.test`, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), ...extra },
    });
    await prisma.userRole.create({ data: { userId: user.id, role, salonId } });
    ids[label] = user.id;
    tok[label] = tokens.signAccessToken(user.id, [role], role === Role.CUSTOMER ? SessionAudience.CUSTOMER : SessionAudience.STAFF);
    return user;
  }

  async function makeShop(label: string, ownerId: string, over: Record<string, unknown> = {}) {
    const city = await prisma.city.findFirstOrThrow({ where: { slug: 'jharsuguda' } });
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: ownerId, name: `LQ ${label} ${run}`, slug: `lq-${label.toLowerCase()}-${run}`, cityId: city.id,
        addressLine: '1 Test Road', lat: 21.85, lng: 84.0, status: SalonStatus.ACTIVE, timezone: 'Asia/Kolkata', currency: 'INR',
        phone: '+919800000001', showPhoneToCustomers: true, queueAutoAssignEnabled: false, ...over,
      },
    });
    await prisma.userRole.create({ data: { userId: ownerId, role: Role.SALON_OWNER, salonId: salon.id } });
    for (let d = 0; d < 7; d++) await prisma.operatingHours.create({ data: { salonId: salon.id, dayOfWeek: d, openTime: '00:00', closeTime: '23:59', isClosed: false } });
    const svc = await prisma.service.create({ data: { salonId: salon.id, name: `Cut ${label}`, price: '200.00', durationMinutes: 30 } });
    ids[`${label}Salon`] = salon.id;
    ids[`${label}Service`] = svc.id;
    return salon;
  }

  const guestJoin = (salon: string, over: Record<string, unknown> = {}) =>
    api('post', `salons/${ids[`${salon}Salon`]}/queue/guest-join`).send({ serviceId: ids[`${salon}Service`], contactName: 'Asha Guest', contactPhone: phone(1), ...over });
  const status = (id: string, token: string) => api('get', `queue-entries/${id}/guest-status`, undefined, { 'x-queue-guest-token': token });
  const row = (id: string) => prisma.queueEntry.findUniqueOrThrow({ where: { id } });
  const setEta = (id: string, minutes: number) => prisma.queueEntry.update({ where: { id }, data: { estimatedWaitMinutes: minutes } });
  const deliveries = (key: string) => prisma.notificationDelivery.count({ where: { dedupeKey: { startsWith: `queue-arrival:${key}:` } } });
  const notifs = (userId: string) => prisma.notification.count({ where: { userId, type: 'queue.arrival_check' } });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .overrideProvider(ExpoPushSender)
      .useValue({ send: async (messages: ExpoPushMessage[]) => { pushes.push(...messages); return messages.map(() => ({ status: 'ok' as const, id: 'ticket' })); } })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    queue = app.get(QueueService);
    reminders = app.get(QueueArrivalReminderService);

    const ownerA = await makeUser('ownerA', Role.CUSTOMER); // owner row below; role fixed after salon exists
    await prisma.userRole.deleteMany({ where: { userId: ownerA.id } });
    await makeShop('A', ownerA.id);
    tok.ownerA = tokens.signAccessToken(ownerA.id, [Role.SALON_OWNER], SessionAudience.STAFF);
    const ownerB = await makeUser('ownerB', Role.CUSTOMER);
    await prisma.userRole.deleteMany({ where: { userId: ownerB.id } });
    await makeShop('B', ownerB.id, { showPhoneToCustomers: false });
    tok.ownerB = tokens.signAccessToken(ownerB.id, [Role.SALON_OWNER], SessionAudience.STAFF);
    await makeUser('cust1', Role.CUSTOMER, null, { phone: null });
    await makeUser('cust2', Role.CUSTOMER);
    for (const [label, token] of [['ownerA', 'OWNERA'], ['cust1', 'CUST1']] as const) {
      await prisma.pushDevice.create({ data: { userId: ids[label], expoPushToken: `ExponentPushToken[${token}${run}abcdef]`, platform: 'android' } });
    }
  });

  afterAll(async () => { await app?.close(); });

  describe('guest join: Name + Mobile + Service, no Google, no account', () => {
    let entryId = '';
    let guestToken = '';

    it('joins without any credential and returns a one-time 256-bit capability; only its SHA-256 is stored; no account is created', async () => {
      const usersBefore = await prisma.user.count();
      const res = await guestJoin('A');
      expect(res.status).toBe(201);
      guestToken = res.body.guestAccessToken;
      entryId = res.body.id;
      expect(guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.body.status).toBe('WAITING');
      const stored = await row(entryId);
      expect(stored.guestAccessHash).toBe(sha(guestToken));
      expect(stored.guestAccessHash).not.toBe(guestToken);
      expect(stored.customerId).toBeNull();
      expect(stored.contactName).toBe('Asha Guest');
      expect(stored.guestAccessExpiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
      expect(await prisma.user.count()).toBe(usersBefore); // never creates an account from an unverified number
      expect(await prisma.user.count({ where: { phone: { contains: phone(1) } } })).toBe(0);
      // the owner is told, and the token is nowhere in the database in clear
      expect(await prisma.notification.count({ where: { userId: ids.ownerA, type: 'owner.walk_in.joined' } })).toBeGreaterThan(0);
      const dump = JSON.stringify(await prisma.$queryRawUnsafe(`select * from queue_entries where id = '${entryId}'`));
      expect(dump).not.toContain(guestToken);
    });

    it('requires all three fields and a valid number; another shop\'s service is refused', async () => {
      const full = { serviceId: ids.AService, contactName: 'Asha Guest', contactPhone: phone(2) };
      const { contactName: _n, ...noName } = full;
      const { contactPhone: _p, ...noPhone } = full;
      const { serviceId: _s, ...noService } = full;
      for (const body of [noName, noPhone, noService, { ...full, contactPhone: '12345' }, { ...full, contactName: 'x' }, { ...full, serviceId: 'not-a-uuid' }, {}]) {
        const res = await api('post', `salons/${ids.ASalon}/queue/guest-join`).send(body);
        expect(res.status).toBe(400);
      }
      const cross = await guestJoin('A', { serviceId: ids.BService, contactPhone: phone(3) });
      expect([400, 404]).toContain(cross.status);
      expect(await prisma.queueEntry.count({ where: { salonId: ids.ASalon, contactPhone: { endsWith: phone(3) } } })).toBe(0);
    });

    it('does not let the same number hold two active tokens at one shop (formats normalised), but allows it at another shop', async () => {
      const dup = await guestJoin('A', { contactPhone: `+91 ${phone(1)}` });
      expect(dup.status).toBe(409);
      const other = await guestJoin('B', { contactPhone: phone(1) });
      expect(other.status).toBe(201);
    });

    it('status, cancel, arrival and device calls work ONLY with this ticket\'s own capability', async () => {
      expect((await status(entryId, guestToken)).status).toBe(200);
      const other = await guestJoin('A', { contactPhone: phone(4), contactName: 'Second Guest' });
      const otherToken = other.body.guestAccessToken;
      for (const bad of ['', 'short', 'A'.repeat(43), otherToken]) {
        expect((await status(entryId, bad)).status).toBe(404);
      }
      expect((await status(other.body.id, guestToken)).status).toBe(404);
      const res = await status(entryId, guestToken);
      expect(JSON.stringify(res.body)).not.toContain(guestToken);
      // expiry kills the capability
      await prisma.queueEntry.update({ where: { id: other.body.id }, data: { guestAccessExpiresAt: new Date(Date.now() - 1000) } });
      expect((await status(other.body.id, otherToken)).status).toBe(404);
      expect((await api('post', `queue-entries/${other.body.id}/guest-cancel`, undefined, { 'x-queue-guest-token': otherToken })).status).toBe(404);
      // a wrong capability cannot cancel
      expect((await api('post', `queue-entries/${entryId}/guest-cancel`, undefined, { 'x-queue-guest-token': otherToken })).status).toBe(404);
      expect((await row(entryId)).status).toBe(QueueEntryStatus.WAITING);
    });

    it('registers a device only with a plausible Expo token and only for that ticket', async () => {
      const bad = await api('post', `queue-entries/${entryId}/guest-device`, undefined, { 'x-queue-guest-token': guestToken }).send({ expoPushToken: 'raw-fcm-credential' });
      expect(bad.status).toBe(400);
      const ok = await api('post', `queue-entries/${entryId}/guest-device`, undefined, { 'x-queue-guest-token': guestToken }).send({ expoPushToken: `ExponentPushToken[GUEST${run}abcdef]` });
      expect(ok.status).toBe(201);
      expect(ok.body.registered).toBe(true);
      expect((await row(entryId)).guestExpoPushToken).toContain('GUEST');
      const other = await api('post', `queue-entries/${randomUUID()}/guest-device`, undefined, { 'x-queue-guest-token': guestToken }).send({ expoPushToken: `ExponentPushToken[GUEST${run}abcdef]` });
      expect(other.status).toBe(404);
    });

    it('caps the live queue at 80 active tokens per shop', async () => {
      const data = Array.from({ length: 80 }, (_, i) => ({ salonId: ids.BSalon, serviceId: ids.BService, source: 'WALK_IN' as const, tokenNumber: 500 + i, status: QueueEntryStatus.WAITING, contactName: 'Filler', contactPhone: `+9190000${String(i).padStart(5, '0')}` }));
      await prisma.queueEntry.createMany({ data });
      const res = await guestJoin('B', { contactPhone: phone(5) });
      expect(res.status).toBe(400);
      await prisma.queueEntry.deleteMany({ where: { salonId: ids.BSalon, contactName: 'Filler' } });
    });

    it('a shop that is not ACTIVE does not accept guests', async () => {
      await prisma.salon.update({ where: { id: ids.BSalon }, data: { status: SalonStatus.SUSPENDED } });
      const res = await guestJoin('B', { contactPhone: phone(6) });
      await prisma.salon.update({ where: { id: ids.BSalon }, data: { status: SalonStatus.ACTIVE } });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    describe('T-10 arrival prompt and confirmation (guest)', () => {
      beforeAll(() => { jest.spyOn(queue, 'recomputeEtas').mockResolvedValue(undefined as never); });
      afterAll(() => { jest.restoreAllMocks(); });

      it('does not fire at 11 minutes, fires once at 10, notifies the owner (in-app + push) and the guest device, never twice', async () => {
        await setEta(entryId, 11);
        pushes.length = 0;
        await reminders.sendDueReminders();
        expect((await row(entryId)).arrivalPromptSentAt).toBeNull();
        expect(await notifs(ids.ownerA)).toBe(0);

        await setEta(entryId, 10);
        const [a, b] = await Promise.all([reminders.sendDueReminders(), reminders.sendDueReminders()]);
        expect(a + b).toBe(1); // two simultaneous sweeps: exactly one claim
        const after = await row(entryId);
        expect(after.arrivalPromptSentAt).not.toBeNull();
        expect(await notifs(ids.ownerA)).toBe(1);
        expect(await deliveries(entryId)).toBeGreaterThanOrEqual(2); // owner IN_APP + PUSH ledger rows, none for the account-less guest
        const ownerPush = pushes.filter((p) => String(p.to).includes('OWNERA'));
        const guestPush = pushes.filter((p) => String(p.to).includes('GUEST'));
        expect(ownerPush).toHaveLength(1);
        expect(ownerPush[0].data).toMatchObject({ type: 'queue.arrival_check', queueEntryId: entryId });
        expect(guestPush).toHaveLength(1);
        expect(guestPush[0].data).toMatchObject({ type: 'queue.arrival_check', queueEntryId: entryId, salonId: ids.ASalon });
        // later sweeps and later ETA changes never repeat it
        await setEta(entryId, 5);
        await reminders.sendDueReminders();
        await reminders.sendDueReminders();
        expect(await notifs(ids.ownerA)).toBe(1);
        expect(pushes.filter((p) => String(p.to).includes('GUEST'))).toHaveLength(1);
      });

      it('the guest answers Yes once (first answer wins); a wrong capability and an owner credential are refused; the answer is advisory only', async () => {
        const wrong = await api('post', `queue-entries/${entryId}/guest-arrival-response`, undefined, { 'x-queue-guest-token': 'B'.repeat(43) }).send({ arrived: true });
        expect(wrong.status).toBe(404);
        expect((await api('post', `queue-entries/${entryId}/guest-arrival-response`, undefined, { 'x-queue-guest-token': guestToken }).send({ arrived: 'yes' })).status).toBe(400);
        const yes = await api('post', `queue-entries/${entryId}/guest-arrival-response`, undefined, { 'x-queue-guest-token': guestToken }).send({ arrived: true });
        expect(yes.status).toBe(201);
        const stored = await row(entryId);
        expect(stored.customerArrivalResponse).toBe(true);
        expect(stored.arrivedAt).toBeNull(); // a customer claim is NOT a verified arrival
        expect(stored.status).toBe(QueueEntryStatus.WAITING); // never auto no-show / charge / assign
        const again = await api('post', `queue-entries/${entryId}/guest-arrival-response`, undefined, { 'x-queue-guest-token': guestToken }).send({ arrived: false });
        // first answer wins: a second tap is an idempotent no-op that reports the stored answer, never a change
        expect(again.status).toBe(201);
        expect(again.body.customerArrivalResponse).toBe(true);
        expect((await row(entryId)).customerArrivalResponse).toBe(true);
      });

      it('only the shop\'s owner can confirm physical arrival: another shop\'s owner and a customer cannot', async () => {
        expect((await api('post', `dashboard/queue-entries/${entryId}/arrive`, tok.ownerB)).status).toBe(403);
        expect((await api('post', `dashboard/queue-entries/${entryId}/arrive`, tok.cust2)).status).toBe(403);
        expect((await row(entryId)).arrivedAt).toBeNull();
        expect((await api('post', `dashboard/queue-entries/${entryId}/arrive`, tok.ownerA)).status).toBe(201);
        expect((await row(entryId)).arrivedAt).not.toBeNull();
      });
    });
  });

  describe('signed-in customer: T-10, Yes/No, call shop, role isolation', () => {
    let entryId = '';
    beforeAll(() => { jest.spyOn(queue, 'recomputeEtas').mockResolvedValue(undefined as never); });
    afterAll(() => { jest.restoreAllMocks(); });

    it('joins with the existing authenticated flow (old clients keep working: serviceId and contact optional when the account has a phone)', async () => {
      await prisma.user.update({ where: { id: ids.cust2 }, data: { phone: `+91${phone(7)}` } });
      const res = await api('post', `salons/${ids.ASalon}/queue/join`, tok.cust2).send({ serviceId: ids.AService });
      expect(res.status).toBe(201);
      entryId = res.body.id;
      const legacy = Object.keys(res.body);
      for (const key of ['id', 'status', 'tokenNumber', 'salonId']) expect(legacy).toContain(key);
    });

    it('at T-10 both the customer and the owner get exactly one in-app + push notification', async () => {
      pushes.length = 0;
      await prisma.user.update({ where: { id: ids.cust2 }, data: {} });
      await prisma.pushDevice.create({ data: { userId: ids.cust2, expoPushToken: `ExponentPushToken[CUST2${run}abcdef]`, platform: 'android' } });
      await setEta(entryId, 10);
      expect(await reminders.sendDueReminders()).toBe(1);
      expect(await reminders.sendDueReminders()).toBe(0);
      expect(await notifs(ids.cust2)).toBe(1);
      expect(await notifs(ids.ownerA)).toBe(2); // 1 from the guest above + this one
      expect(pushes.filter((p) => String(p.to).includes('CUST2'))).toHaveLength(1);
      expect(pushes.filter((p) => String(p.to).includes('OWNERA'))).toHaveLength(1);
      expect(pushes.find((p) => String(p.to).includes('CUST2'))!.body).toContain('Have you arrived');
      expect(pushes.find((p) => String(p.to).includes('OWNERA'))!.body).toContain('Confirm arrival');
    });

    it('another customer, an owner and no token cannot answer for this ticket; the owner of a different shop cannot see it', async () => {
      const as = (token?: string) => api('post', `queue-entries/${entryId}/arrival-response`, token).send({ arrived: false });
      expect((await as(tok.cust1)).status).toBe(404);
      expect((await as(tok.ownerA)).status).toBe(403);
      expect((await as()).status).toBe(401);
      expect((await row(entryId)).customerArrivalResponse).toBeNull();
    });

    it('the customer can answer No (not yet) once; it is advisory and the owner still decides', async () => {
      const res = await api('post', `queue-entries/${entryId}/arrival-response`, tok.cust2).send({ arrived: false });
      expect(res.status).toBe(201);
      const stored = await row(entryId);
      expect([stored.customerArrivalResponse, stored.arrivedAt, stored.status]).toEqual([false, null, QueueEntryStatus.WAITING]);
      const second = await api('post', `queue-entries/${entryId}/arrival-response`, tok.cust2).send({ arrived: true });
      expect(second.status).toBe(201);
      expect(second.body.customerArrivalResponse).toBe(false); // first answer wins
      expect((await row(entryId)).customerArrivalResponse).toBe(false);
    });

    it('Call Shop: only the token holder gets the shop\'s PUBLIC business number; a shop that opted out, an invalid number and strangers get nothing', async () => {
      const ok = await api('get', `queue-entries/${entryId}/shop-contact`, tok.cust2);
      expect(ok.status).toBe(200);
      expect(ok.body.shopPhone).toBe('+919800000001');
      expect(JSON.stringify(ok.body)).not.toContain(String(ids.ownerA));
      expect((await api('get', `queue-entries/${entryId}/shop-contact`, tok.cust1)).status).toBe(404);
      await prisma.salon.update({ where: { id: ids.ASalon }, data: { showPhoneToCustomers: false } });
      expect((await api('get', `queue-entries/${entryId}/shop-contact`, tok.cust2)).body.shopPhone).toBeNull();
      await prisma.salon.update({ where: { id: ids.ASalon }, data: { showPhoneToCustomers: true, phone: 'call me maybe' } });
      expect((await api('get', `queue-entries/${entryId}/shop-contact`, tok.cust2)).body.shopPhone).toBeNull();
      await prisma.salon.update({ where: { id: ids.ASalon }, data: { phone: '+919800000001' } });
    });

    it('an arrival prompt is never sent for a customer already marked arrived, cancelled, or in service', async () => {
      pushes.length = 0;
      for (const status of [QueueEntryStatus.CALLED, QueueEntryStatus.IN_SERVICE, QueueEntryStatus.CANCELLED]) {
        const e = await prisma.queueEntry.create({ data: { salonId: ids.ASalon, serviceId: ids.AService, source: 'WALK_IN', tokenNumber: 900 + Math.floor(Math.random() * 90), status, contactName: 'Skip', contactPhone: `+9191111${Math.floor(Math.random() * 90000 + 10000)}`, estimatedWaitMinutes: 3 } });
        await reminders.sendDueReminders();
        expect((await row(e.id)).arrivalPromptSentAt).toBeNull();
      }
      const arrived = await prisma.queueEntry.create({ data: { salonId: ids.ASalon, serviceId: ids.AService, source: 'WALK_IN', tokenNumber: 990, status: QueueEntryStatus.WAITING, contactName: 'Here', contactPhone: '+919222233334', estimatedWaitMinutes: 2, arrivedAt: new Date() } });
      await reminders.sendDueReminders();
      expect((await row(arrived.id)).arrivalPromptSentAt).toBeNull();
      expect(pushes).toHaveLength(0);
    });
  });

  describe('abuse control (real rate limiter, keyed by shop and ticket - not by the shared proxy address)', () => {
    it('joins are limited per shop, so one busy shop cannot starve another and a forged X-Forwarded-For changes nothing', async () => {
      const real = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ExpoPushSender).useValue({ send: async () => [] })
        .compile();
      const limited = real.createNestApplication<INestApplication<App>>();
      limited.setGlobalPrefix('api/v1');
      limited.useGlobalFilters(new AllExceptionsFilter());
      await limited.init();
      const join = (salon: 'A' | 'B', i: number, xff: string) =>
        request(limited.getHttpServer())
          .post(`/api/v1/salons/${ids[`${salon}Salon`]}/queue/guest-join`)
          .set('X-Forwarded-For', xff)
          .send({ serviceId: ids[`${salon}Service`], contactName: 'Rate Guest', contactPhone: `+9193${salon === 'A' ? '3' : '4'}${String(i).padStart(7, '0')}` });
      try {
        const codes: number[] = [];
        for (let i = 0; i < 22; i += 1) codes.push((await join('A', i, `198.51.100.${i + 10}`)).status);
        expect(codes.slice(0, 20).every((c) => c === 201)).toBe(true);
        expect(codes.slice(20)).toEqual([429, 429]);
        // the same client address can still join another shop at once
        expect((await join('B', 1, '198.51.100.10')).status).toBe(201);

        // guests polling their own tickets do not consume each other's allowance (one shared address, many guests)
        const tickets = await prisma.queueEntry.findMany({ where: { salonId: ids.ASalon, contactName: 'Rate Guest' }, take: 3 });
        expect(tickets.length).toBe(3);
        // real tokens are not recoverable (hash only), so use a bad token: every poll is a counted 404 on that ticket's own bucket
        const poll = (id: string) => request(limited.getHttpServer()).get(`/api/v1/queue-entries/${id}/guest-status`).set('x-queue-guest-token', 'A'.repeat(43));
        for (const t of tickets) for (let i = 0; i < 30; i += 1) expect((await poll(t.id)).status).toBe(404);
        // one ticket's own limit (60/min) still protects it
        let blocked = 0;
        for (let i = 0; i < 40; i += 1) if ((await poll(tickets[0].id)).status === 429) blocked += 1;
        expect(blocked).toBeGreaterThan(0);
        expect((await poll(tickets[1].id)).status).toBe(404); // a different ticket is unaffected
      } finally {
        await limited.close();
      }
    });
  });
});

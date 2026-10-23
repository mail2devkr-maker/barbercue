import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SalonStatus, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { QueueAutoAssignTrigger } from '../src/queue/queue-auto-assign.trigger';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';

/**
 * Customer Live Queue cancellation (POST /queue-entries/:id/cancel): the REAL AppModule, real Prisma, real
 * PostgreSQL, real JWT + roles guards. Covers permissions, queue/position updates, the owner board, realtime
 * emission, release of an assigned-but-unstarted barber/chair to automatic assignment, rejoining, the
 * booking boundary, IN_SERVICE / terminal protection and the cancel-vs-start race.
 *
 * SAFETY: refuses to run against anything but a local database and only touches rows it created.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

const CANDIDATE_ZONES = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'America/Los_Angeles'];
const localHourIn = (zone: string) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date())) % 24;
const TZ = CANDIDATE_ZONES.find((zone) => localHourIn(zone) >= 7 && localHourIn(zone) <= 19) ?? 'Asia/Kolkata';

maybe('Customer Live Queue cancellation (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let trigger: QueueAutoAssignTrigger;
  let realtime: RealtimeGateway;

  const run = randomUUID().slice(0, 8);
  const runDigits = String(parseInt(run, 16) % 100_000_000).padStart(8, '0');
  const phone = (n: number) => `+919${runDigits}${n}`.slice(0, 13);
  const ids: Record<string, string> = {};
  const tok: Record<string, string> = {};

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (method === 'post' || method === 'put' || method === 'patch') req.set('Idempotency-Key', randomUUID());
    return req;
  };

  async function makeUser(label: string, role: Role | null, salonId: string | null, extra: Record<string, unknown> = {}) {
    const user = await prisma.user.create({
      data: { email: `e2e-cancel-${run}-${label}@example.test`, phone: null, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), ...extra },
    });
    if (role) await prisma.userRole.create({ data: { userId: user.id, role, salonId } });
    ids[label] = user.id;
    tok[label] = tokens.signAccessToken(
      user.id,
      role ? [role] : [Role.CUSTOMER],
      role === Role.SALON_STAFF || role === Role.SALON_OWNER ? SessionAudience.STAFF : SessionAudience.CUSTOMER,
    );
    return user;
  }

  const settle = () => trigger.idle(ids.salon);
  const board = async () => (await api('get', `dashboard/salons/${ids.salon}/queue`, tok.owner).expect(200)).body;
  const setAuto = (enabled: boolean) =>
    api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).send({ autoAssignEnabled: enabled }).expect(200);
  const entryRow = (id: string) => prisma.queueEntry.findUniqueOrThrow({ where: { id } });
  const activeSessions = () =>
    prisma.serviceSession.findMany({ where: { status: 'ACTIVE', chair: { salonId: ids.salon } }, include: { queueEntry: true } });

  /** A customer joins the Live Queue remotely, like the website / mobile app does. */
  const join = async (label: string) =>
    (
      await api('post', `salons/${ids.salon}/queue/join`, tok[label])
        .send({ serviceId: ids.haircut, contactName: `Cust ${label}`, contactPhone: `98765000${label.slice(-1)}1` })
        .expect(201)
    ).body as { id: string; status: string; position: number | null };
  const arrive = (entryId: string) => api('post', `dashboard/queue-entries/${entryId}/arrive`, tok.owner).expect(201);
  const cancelAs = (label: string, entryId: string) => api('post', `queue-entries/${entryId}/cancel`, tok[label]);
  const mine = async (label: string) => (await api('get', 'queue-entries/mine/active', tok[label]).expect(200)).body as { id?: string; position?: number | null; status?: string };

  /** Leaves the shop empty for the next scenario: finish sessions, cancel everything still active. */
  const cleanup = async () => {
    await setAuto(false);
    await settle();
    for (const row of await activeSessions()) {
      await api('post', `dashboard/service-sessions/${row.id}/complete`, tok.owner).expect(201);
    }
    const snapshot = await board();
    for (const row of [...snapshot.sections.waiting, ...(snapshot.sections.called ?? []), ...(snapshot.sections.assigned ?? [])] as Array<{ id: string }>) {
      await api('post', `dashboard/queue-entries/${row.id}/cancel`, tok.owner).expect(201);
    }
    await settle();
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    trigger = app.get(QueueAutoAssignTrigger);
    realtime = app.get(RealtimeGateway);

    const city = await prisma.city.findFirstOrThrow({ where: { slug: 'jharsuguda' } });
    const owner = await makeUser('owner', null, null);
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: `Cancel Salon ${run}`,
        slug: `cancel-${run}`,
        cityId: city.id,
        addressLine: '1 Test Road',
        lat: 21.85,
        lng: 84.0,
        status: SalonStatus.ACTIVE,
        timezone: TZ,
        currency: 'INR',
        phone: '+919800000001',
        queueAutoAssignEnabled: false,
      },
    });
    ids.salon = salon.id;
    await prisma.userRole.create({ data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id } });
    tok.owner = tokens.signAccessToken(owner.id, [Role.SALON_OWNER], SessionAudience.STAFF);
    for (let day = 0; day < 7; day++) {
      await prisma.operatingHours.create({ data: { salonId: salon.id, dayOfWeek: day, openTime: '00:00', closeTime: '23:59', isClosed: false } });
    }
    const haircut = await prisma.service.create({ data: { salonId: salon.id, name: 'Haircut', price: '250.00', durationMinutes: 30 } });
    ids.haircut = haircut.id;
    for (const label of ['Chair 1', 'Chair 2']) {
      const chair = await prisma.chair.create({ data: { salonId: salon.id, label } });
      ids[label] = chair.id;
    }
    const staffUser = await makeUser('ravi', Role.SALON_STAFF, salon.id);
    const staff = await prisma.salonStaff.create({
      data: { salonId: salon.id, userId: staffUser.id, displayName: 'Ravi', roleInSalon: 'BARBER', status: 'ACTIVE', services: { create: [{ serviceId: haircut.id }] } },
    });
    ids.raviStaff = staff.id;
    for (let n = 1; n <= 4; n++) await makeUser(`cust${n}`, Role.CUSTOMER, null, { phone: phone(n) });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
  });

  describe('permissions', () => {
    it('requires authentication and the customer role; staff and owners cannot use the customer route', async () => {
      const a = await join('cust1');
      await api('post', `queue-entries/${a.id}/cancel`).expect(401);
      await cancelAs('ravi', a.id).expect(403);
      await cancelAs('owner', a.id).expect(403);
      expect((await entryRow(a.id)).status).toBe('WAITING');
    });

    it("another customer cannot cancel someone else's token, and an unknown id is a 404", async () => {
      const a = await join('cust1');
      await cancelAs('cust2', a.id).expect(404);
      await cancelAs('cust1', randomUUID()).expect(404);
      expect((await entryRow(a.id)).status).toBe('WAITING');
    });

    it('never cancels an appointment check-in (booking-linked entry) through the customer route', async () => {
      const start = new Date(Date.now() + 2 * 60_000);
      const booking = await api('post', 'bookings', tok.cust1).send({ salonId: ids.salon, serviceIds: [ids.haircut], slotStart: start.toISOString() });
      expect(booking.status).toBe(201);
      const arrived = await api('post', `dashboard/bookings/${booking.body.id}/arrive`, tok.owner).expect(201);
      expect((await entryRow(arrived.body.id)).bookingId).toBe(booking.body.id);
      await cancelAs('cust1', arrived.body.id).expect(404);
      const after = await entryRow(arrived.body.id);
      expect(after.status).toBe('WAITING');
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.body.id } })).status).not.toBe('CANCELLED');
    });
  });

  describe('waiting token', () => {
    it('cancels, keeps the history row, moves the next customer up, tells the board, and allows rejoining', async () => {
      const emit = jest.spyOn(realtime, 'emitQueueUpdated');
      const a = await join('cust1');
      const b = await join('cust2');
      expect((await mine('cust2')).position).toBe(2);

      const res = await cancelAs('cust1', a.id).expect(201);
      expect(res.body).toMatchObject({ id: a.id, status: 'CANCELLED' });

      const row = await entryRow(a.id);
      expect(row).toMatchObject({ status: 'CANCELLED', bookingId: null, customerId: ids.cust1 });
      expect((await mine('cust1')).id).toBeUndefined();
      expect((await mine('cust2')).position).toBe(1);
      expect(emit).toHaveBeenCalledWith(ids.salon);

      const snapshot = await board();
      const waitingIds = (snapshot.sections.waiting as Array<{ id: string }>).map((x) => x.id);
      expect(waitingIds).toContain(b.id);
      expect(waitingIds).not.toContain(a.id);

      const rejoined = await join('cust1');
      expect(rejoined.id).not.toBe(a.id);
      expect(rejoined.status).toBe('WAITING');
      expect((await mine('cust1')).position).toBe(2);
      expect((await entryRow(a.id)).status).toBe('CANCELLED'); // the old visit stays a CANCELLED record
    });

    it('a repeated cancel (retry after a lost response) succeeds idempotently instead of telling the customer to call the shop', async () => {
      const a = await join('cust1');
      await cancelAs('cust1', a.id).expect(201);
      const again = await cancelAs('cust1', a.id);
      expect(again.status).toBe(201);
      expect(again.body).toMatchObject({ id: a.id, status: 'CANCELLED' });
      expect((await entryRow(a.id)).status).toBe('CANCELLED');
    });
  });

  describe('assigned-but-unstarted token (CALLED)', () => {
    it('frees the reserved barber and chair so automatic assignment seats the next arrived customer', async () => {
      // A legacy client (old Android, startService:false) reserves a barber and chair without starting the service
      // (CALLED / ASSIGNED). Current assignment starts the service at once, which is not cancellable by the customer.
      const a = await join('cust1');
      const b = await join('cust2');
      await arrive(b.id);
      await api('post', `dashboard/queue-entries/${a.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: false }).expect(201);
      expect(await entryRow(a.id)).toMatchObject({ status: 'CALLED', assignedStaffId: ids.raviStaff, assignedChairId: ids['Chair 1'] });

      await setAuto(true);
      await settle();
      expect((await entryRow(b.id)).status).toBe('WAITING'); // the only barber is reserved for A

      const res = await cancelAs('cust1', a.id).expect(201);
      expect(res.body.status).toBe('CANCELLED');
      await settle();
      expect((await entryRow(a.id)).status).toBe('CANCELLED');
      expect(await entryRow(b.id)).toMatchObject({ status: 'IN_SERVICE' });
      const sessions = await activeSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ queueEntryId: b.id, staffId: ids.raviStaff });
    });

    it('with automatic assignment OFF the owner can reuse the freed barber and chair by hand', async () => {
      const a = await join('cust1');
      const b = await join('cust2');
      await api('post', `dashboard/queue-entries/${a.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: false }).expect(201);
      expect((await entryRow(a.id)).status).toBe('CALLED');
      await api('post', `dashboard/queue-entries/${b.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'] }).expect(409);
      await cancelAs('cust1', a.id).expect(201);
      await api('post', `dashboard/queue-entries/${b.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: false }).expect(201);
      expect((await entryRow(b.id)).status).toBe('CALLED');
    });
  });

  describe('protection of started and finished visits', () => {
    it('cannot cancel an IN_SERVICE token; the service session stays ACTIVE', async () => {
      const a = await join('cust1');
      await arrive(a.id);
      await api('post', `dashboard/queue-entries/${a.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: true }).expect(201);
      expect((await entryRow(a.id)).status).toBe('IN_SERVICE');
      const res = await cancelAs('cust1', a.id);
      expect(res.status).toBe(409);
      expect((await entryRow(a.id)).status).toBe('IN_SERVICE');
      expect(await activeSessions()).toHaveLength(1);
    });

    it('cannot cancel a COMPLETED token', async () => {
      const a = await join('cust1');
      await arrive(a.id);
      await api('post', `dashboard/queue-entries/${a.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: true }).expect(201);
      const [session] = await activeSessions();
      await api('post', `dashboard/service-sessions/${session.id}/complete`, tok.owner).expect(201);
      expect((await entryRow(a.id)).status).toBe('COMPLETED');
      expect((await cancelAs('cust1', a.id)).status).toBe(409);
      expect((await entryRow(a.id)).status).toBe('COMPLETED');
    });
  });

  describe('races', () => {
    it('cancel vs the shop starting the service: exactly one wins and the state is never mixed', async () => {
      const outcomes = { cancelled: 0, started: 0 };
      for (let i = 0; i < 6; i++) {
        const a = await join('cust1');
        await arrive(a.id);
        const [cancel, start] = await Promise.all([
          cancelAs('cust1', a.id),
          api('post', `dashboard/queue-entries/${a.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: true }),
        ]);
        const row = await entryRow(a.id);
        const sessions = (await activeSessions()).filter((s) => s.queueEntryId === a.id);
        if (cancel.status === 201) {
          expect(start.status).toBe(409);
          expect(row.status).toBe('CANCELLED');
          expect(sessions).toHaveLength(0);
          outcomes.cancelled++;
        } else {
          expect(cancel.status).toBe(409);
          expect(start.status).toBe(201);
          expect(row.status).toBe('IN_SERVICE');
          expect(sessions).toHaveLength(1);
          outcomes.started++;
        }
        await cleanup();
      }
      expect(outcomes.cancelled + outcomes.started).toBe(6);
    });

    it('two simultaneous cancels of the same token both end in CANCELLED without error', async () => {
      const a = await join('cust1');
      const results = await Promise.all([cancelAs('cust1', a.id), cancelAs('cust1', a.id)]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect((await entryRow(a.id)).status).toBe('CANCELLED');
    });
  });
});

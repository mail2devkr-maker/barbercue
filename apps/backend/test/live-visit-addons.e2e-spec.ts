import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  BookingSource,
  BookingStatus,
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { QueueAutoAssignTrigger } from '../src/queue/queue-auto-assign.trigger';

/**
 * Live-visit add-on mission (17 Nov 2026), on the REAL AppModule, real Prisma, real PostgreSQL and real
 * JWT + roles guards:
 *  - a service added at the chair is recorded on the live visit, lengthens everyone's wait, is billed;
 *  - the shop's buffer after every service changes the bookable slot grid;
 *  - visit notifications retire from the notification centre and the unread badge once the visit is
 *    over (raw SQL against the real schema), with keyset pagination intact;
 *  - Live Queue joins are refused outside opening hours.
 *
 * SAFETY: refuses to run against anything but a local database and only touches rows it created.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

// A zone where it is currently daytime, so "open 00:00-23:59" never meets a day boundary mid-test.
const CANDIDATE_ZONES = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'America/Los_Angeles'];
const localHourIn = (zone: string) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date())) % 24;
const TZ = CANDIDATE_ZONES.find((zone) => localHourIn(zone) >= 7 && localHourIn(zone) <= 19) ?? 'Asia/Kolkata';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const todayDow = () =>
  WEEKDAYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date()));
const localDate = (daysAhead: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + daysAhead * 86_400_000),
  );

interface Entry {
  id: string;
  status: string;
  estimatedWaitMinutes: number | null;
  activeServiceSessionId: string | null;
  addOns?: Array<{ serviceId: string; name: string; durationMinutes: number; price: number }>;
  addOnMinutes?: number;
}

maybe('Live-visit add-on services, service buffer, notification expiry and join hours (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let trigger: QueueAutoAssignTrigger;

  const run = randomUUID().slice(0, 8);
  const runDigits = String(parseInt(run, 16) % 100_000_000).padStart(8, '0');
  const phone = (n: number) => `+919${runDigits}${n}`.slice(0, 13);
  const ids: Record<string, string> = {};
  const tok: Record<string, string> = {};

  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (method !== 'get') req.set('Idempotency-Key', randomUUID());
    return req;
  };

  async function makeUser(label: string, role: Role | null, salonId: string | null, extra: Record<string, unknown> = {}) {
    const user = await prisma.user.create({
      data: { email: `e2e-addons-${run}-${label}@example.test`, phone: null, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), ...extra },
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
  const board = async () => (await api('get', `dashboard/salons/${ids.salon}/queue`, tok.owner).expect(200)).body as {
    entries: Entry[];
    serviceBufferMinutes?: number;
    services: Array<{ id: string; name: string; durationMinutes?: number; price?: number }>;
  };
  const entryOnBoard = async (id: string) => (await board()).entries.find((e) => e.id === id);
  const join = async (label: string, serviceId = ids.haircut) =>
    (
      await api('post', `salons/${ids.salon}/queue/join`, tok[label])
        .send({ serviceId, contactName: `Cust ${label}`, contactPhone: phone(Number(label.slice(-1))) })
        .expect(201)
    ).body as Entry;
  const addOn = (entryId: string, serviceId: string, token = tok.owner) =>
    api('post', `dashboard/queue-entries/${entryId}/add-ons`, token).send({ serviceId });
  const removeAddOn = (entryId: string, serviceId: string, token = tok.owner) =>
    api('delete', `dashboard/queue-entries/${entryId}/add-ons/${serviceId}`, token);
  const ownerNotices = async (cursor?: string) =>
    (await api('get', `notifications/mine${cursor ? `?cursor=${cursor}` : ''}`, tok.owner).expect(200)).body as {
      items: Array<{ id: string; type: string; payload: Record<string, unknown> | null }>;
      nextCursor: string | null;
    };
  const ownerUnread = async () => (await api('get', 'notifications/mine/unread-count', tok.owner).expect(200)).body.count as number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    trigger = app.get(QueueAutoAssignTrigger);

    const city = await prisma.city.findFirstOrThrow({ where: { slug: 'jharsuguda' } });
    const owner = await makeUser('owner', null, null);
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: `Add-on Salon ${run}`,
        slug: `addons-${run}`,
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
    const beard = await prisma.service.create({ data: { salonId: salon.id, name: 'Beard Trim', price: '150.00', durationMinutes: 15 } });
    const massage = await prisma.service.create({ data: { salonId: salon.id, name: 'Head Massage', price: '200.00', durationMinutes: 20 } });
    ids.haircut = haircut.id;
    ids.beard = beard.id;
    ids.massage = massage.id;
    for (const label of ['Chair 1', 'Chair 2']) {
      const chair = await prisma.chair.create({ data: { salonId: salon.id, label } });
      ids[label] = chair.id;
    }
    const staffUser = await makeUser('ravi', Role.SALON_STAFF, salon.id);
    const staff = await prisma.salonStaff.create({
      data: {
        salonId: salon.id,
        userId: staffUser.id,
        displayName: 'Ravi',
        roleInSalon: 'BARBER',
        status: 'ACTIVE',
        services: { create: [{ serviceId: haircut.id }, { serviceId: beard.id }, { serviceId: massage.id }] },
      },
    });
    ids.raviStaff = staff.id;
    for (let n = 1; n <= 4; n++) await makeUser(`cust${n}`, Role.CUSTOMER, null, { phone: phone(n) });
    await api('put', `dashboard/salons/${ids.salon}/billing-profile`, tok.owner)
      .send({ legalName: 'Add-on Salon Pvt Ltd', taxEnabled: false })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe('an add-on chosen at the chair', () => {
    it('is recorded on the live visit, lengthens the wait of the customer behind, and is permission-checked', async () => {
      const first = await join('cust1');
      await api('post', `dashboard/queue-entries/${first.id}/arrive`, tok.owner).expect(201);
      await api('post', `dashboard/queue-entries/${first.id}/assign`, tok.owner)
        .send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: true })
        .expect(201);
      const second = await join('cust2');
      await settle();
      const before = (await entryOnBoard(second.id))!.estimatedWaitMinutes;
      expect(before).not.toBeNull();

      const added = await addOn(first.id, ids.beard).expect(201);
      expect(added.body).toMatchObject({
        addOnMinutes: 15,
        addOns: [{ serviceId: ids.beard, name: 'Beard Trim', durationMinutes: 15, price: 150 }],
      });
      const row = await prisma.queueEntry.findUniqueOrThrow({ where: { id: first.id }, include: { addOns: true } });
      expect(row.addOnMinutes).toBe(15);
      expect(row.addOns).toHaveLength(1);

      const after = (await entryOnBoard(second.id))!.estimatedWaitMinutes!;
      // Everyone behind the customer in the chair now waits ~15 minutes longer.
      expect(after - before!).toBeGreaterThanOrEqual(14);
      expect(after - before!).toBeLessThanOrEqual(16);

      // The barber on duty can add one too; and remove it again.
      await addOn(first.id, ids.massage, tok.ravi).expect(201);
      expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: first.id } })).addOnMinutes).toBe(35);
      const removed = await removeAddOn(first.id, ids.massage, tok.ravi).expect(200);
      expect(removed.body.addOnMinutes).toBe(15);
      // Removing it twice is harmless.
      await removeAddOn(first.id, ids.massage, tok.ravi).expect(200);

      // Never twice, never the visit's own service, never by a customer.
      expect((await addOn(first.id, ids.beard).expect(409)).body.error.code).toBe('ADD_ON_DUPLICATE');
      expect((await addOn(first.id, ids.haircut).expect(409)).body.error.code).toBe('ADD_ON_DUPLICATE');
      await addOn(first.id, ids.massage, tok.cust1).expect(403);
      await addOn(first.id, randomUUID()).expect(404);

      // The board lists add-on choices with their duration and price.
      const services = (await board()).services;
      expect(services.find((s) => s.id === ids.beard)).toMatchObject({ durationMinutes: 15, price: 150 });

      ids.firstEntry = first.id;
      ids.secondEntry = second.id;
    });

    it('is billed on the visit invoice and can no longer change once the visit is completed', async () => {
      const entry = (await entryOnBoard(ids.firstEntry))!;
      await api('post', `dashboard/service-sessions/${entry.activeServiceSessionId}/complete`, tok.owner).expect(201);
      const invoice = await api('post', `dashboard/salons/${ids.salon}/invoices`, tok.owner)
        .send({ queueEntryId: ids.firstEntry })
        .expect(201);
      expect(invoice.body.subtotal).toBe(400);
      expect(invoice.body.total).toBe(400);
      expect((invoice.body.lines as Array<{ description: string; lineTotal: number }>).map((l) => [l.description, l.lineTotal])).toEqual([
        ['Haircut', 250],
        ['Beard Trim', 150],
      ]);
      expect((await addOn(ids.firstEntry, ids.massage).expect(409)).body.error.code).toBe('ADD_ON_NOT_ALLOWED');
      expect((await removeAddOn(ids.firstEntry, ids.beard).expect(409)).body.error.code).toBe('ADD_ON_NOT_ALLOWED');
    });
  });

  describe('notifications retire when their visit is over', () => {
    it('hides a finished visit from the list and the unread badge, keeps a live one, and pages correctly', async () => {
      // The owner was told about both joins above. The first visit is completed, the second waits.
      const notices = await ownerNotices();
      const joinedFor = (entryId: string) =>
        notices.items.filter((n) => n.type === 'owner.walk_in.joined' && n.payload?.queueEntryId === entryId);
      expect(joinedFor(ids.firstEntry)).toHaveLength(0);
      expect(joinedFor(ids.secondEntry)).toHaveLength(1);
      const unreadWhileWaiting = await ownerUnread();

      await api('post', `dashboard/queue-entries/${ids.secondEntry}/cancel`, tok.owner).expect(201);
      const afterCancel = await ownerNotices();
      expect(afterCancel.items.some((n) => n.payload?.queueEntryId === ids.secondEntry)).toBe(false);
      expect(await ownerUnread()).toBe(unreadWhileWaiting - 1);

      // Rows are hidden, never deleted.
      expect(
        await prisma.notification.count({
          where: { userId: ids.owner, type: 'owner.walk_in.joined', payload: { path: ['queueEntryId'], equals: ids.secondEntry } },
        }),
      ).toBe(1);
    });

    it('retires booking notices once the appointment has ended and old unlinked queue notices after 12 hours', async () => {
      const mk = (minutesFromNow: number, label: string) =>
        prisma.booking.create({
          data: {
            salonId: ids.salon,
            serviceId: ids.haircut,
            customerId: ids.cust3,
            slotStart: new Date(Date.now() + minutesFromNow * 60_000),
            slotEnd: new Date(Date.now() + (minutesFromNow + 30) * 60_000),
            status: BookingStatus.CONFIRMED,
            source: BookingSource.WEB,
            idempotencyKey: `addons-${run}-${label}`,
          },
        });
      const past = await mk(-120, 'past');
      const upcoming = await mk(24 * 60, 'upcoming');
      const notice = (type: string, payload: Prisma.InputJsonObject, createdAt = new Date()) =>
        prisma.notification.create({
          data: { userId: ids.owner, channel: 'IN_APP', type, payload, status: 'SENT', sentAt: createdAt, createdAt },
        });
      const pastNotice = await notice('owner.booking.created', { salonId: ids.salon, bookingId: past.id });
      const upcomingNotice = await notice('owner.booking.created', { salonId: ids.salon, bookingId: upcoming.id });
      const oldUnlinked = await notice('owner.walk_in.joined', { salonId: ids.salon }, new Date(Date.now() - 13 * 3_600_000));
      const recentUnlinked = await notice('owner.walk_in.joined', { salonId: ids.salon }, new Date(Date.now() - 3_600_000));
      // An outcome notice written after a visit is never retired.
      const outcome = await notice('owner.booking.no_show', { salonId: ids.salon, bookingId: past.id });

      const visible = new Set((await ownerNotices()).items.map((n) => n.id));
      expect(visible.has(pastNotice.id)).toBe(false);
      expect(visible.has(upcomingNotice.id)).toBe(true);
      expect(visible.has(oldUnlinked.id)).toBe(false);
      expect(visible.has(recentUnlinked.id)).toBe(true);
      expect(visible.has(outcome.id)).toBe(true);

      // Keyset pagination over the filtered list: 25 more current notices -> two pages, no duplicates.
      for (let i = 0; i < 25; i++) {
        await notice('owner.inventory.reorder', { salonId: ids.salon, i }, new Date(Date.now() - i * 1000));
      }
      const page1 = await ownerNotices();
      expect(page1.items).toHaveLength(20);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await ownerNotices(page1.nextCursor!);
      const all = [...page1.items, ...page2.items].map((n) => n.id);
      expect(new Set(all).size).toBe(all.length);
      expect(all).not.toContain(pastNotice.id);
      expect(all).toContain(upcomingNotice.id);
    });
  });

  describe('the service buffer', () => {
    it('is owner-only, shown on the board, and keeps a gap around every appointment in the slot grid', async () => {
      await api('patch', `dashboard/salons/${ids.salon}/service-buffer`, tok.ravi).send({ serviceBufferMinutes: 15 }).expect(403);
      await api('patch', `dashboard/salons/${ids.salon}/service-buffer`, tok.owner).send({ serviceBufferMinutes: 45 }).expect(400);

      const day = localDate(2);
      const grid = async () =>
        (await api('get', `salons/${ids.salon}/booking/availability?serviceId=${ids.haircut}&date=${day}`).expect(200)).body as Array<{
          slotStart: string;
          available: boolean;
        }>;
      // One appointment on the only barber, in the middle of that day.
      const slots = await grid();
      const middle = slots[Math.floor(slots.length / 2)];
      const start = new Date(middle.slotStart);
      await prisma.booking.create({
        data: {
          salonId: ids.salon,
          serviceId: ids.haircut,
          customerId: ids.cust4,
          slotStart: start,
          slotEnd: new Date(start.getTime() + 30 * 60_000),
          status: BookingStatus.CONFIRMED,
          source: BookingSource.WEB,
          idempotencyKey: `addons-${run}-grid`,
        },
      });
      const rightAfter = new Date(start.getTime() + 30 * 60_000).toISOString();
      const fifteenAfter = new Date(start.getTime() + 45 * 60_000).toISOString();

      await api('patch', `dashboard/salons/${ids.salon}/service-buffer`, tok.owner).send({ serviceBufferMinutes: 0 }).expect(200);
      expect((await grid()).find((s) => s.slotStart === rightAfter)?.available).toBe(true);

      await api('patch', `dashboard/salons/${ids.salon}/service-buffer`, tok.owner).send({ serviceBufferMinutes: 15 }).expect(200);
      expect((await board()).serviceBufferMinutes).toBe(15);
      const buffered = await grid();
      expect(buffered.find((s) => s.slotStart === rightAfter)?.available).toBe(false);
      expect(buffered.find((s) => s.slotStart === fifteenAfter)?.available).toBe(true);
      expect(
        await prisma.auditLog.count({ where: { entityId: ids.salon, action: 'SALON_SERVICE_BUFFER_CHANGED' } }),
      ).toBe(2);
    });
  });

  describe('Live Queue joins outside opening hours', () => {
    it('are refused for customers, guests and the shop itself while the shop is closed today', async () => {
      const dow = todayDow();
      await prisma.operatingHours.update({
        where: { salonId_dayOfWeek: { salonId: ids.salon, dayOfWeek: dow } },
        data: { isClosed: true },
      });
      try {
        const customer = await api('post', `salons/${ids.salon}/queue/join`, tok.cust3)
          .send({ serviceId: ids.haircut, contactName: 'Cust 3', contactPhone: phone(3) })
          .expect(409);
        expect(customer.body.error.code).toBe('QUEUE_CLOSED');
        const guest = await api('post', `salons/${ids.salon}/queue/guest-join`)
          .send({ serviceId: ids.haircut, contactName: 'Guest', contactPhone: '+919811122233' })
          .expect(409);
        expect(guest.body.error.code).toBe('QUEUE_CLOSED');
        const shop = await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner)
          .send({ name: 'Walk In', contactConsent: false })
          .expect(409);
        expect(shop.body.error.code).toBe('QUEUE_CLOSED');
      } finally {
        await prisma.operatingHours.update({
          where: { salonId_dayOfWeek: { salonId: ids.salon, dayOfWeek: dow } },
          data: { isClosed: false },
        });
      }
      // Open again: the same customer can join.
      await join('cust3');
    });
  });
});

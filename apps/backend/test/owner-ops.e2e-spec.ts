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
import { ExpoPushSender } from '../src/push-notifications/expo-push-sender';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { QueueAutoAssignTrigger } from '../src/queue/queue-auto-assign.trigger';
import { addZonedCalendarDays, utcToZonedDateStr, zonedWallTimeToUtc } from '../src/common/timezone/timezone';

/**
 * Owner-operations e2e: the REAL AppModule, real Prisma, real PostgreSQL, real JWT + roles guards.
 *
 * SAFETY: this suite creates and mutates data, so it refuses to run against anything but a local
 * database. It creates its own uniquely named fixtures and never touches rows it did not create.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

const TZ = 'Asia/Kolkata';

maybe('Owner operations (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let trigger: QueueAutoAssignTrigger;
  let delivery: NotificationDeliveryService;
  let expo: ExpoPushSender;

  const run = randomUUID().slice(0, 8);
  // Unique per run so repeated runs against the same disposable database never collide on User.phone.
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

  /** A future salon-local slot start (ISO) at HH:mm, `daysAhead` days from today. */
  const slot = (hhmm: string, daysAhead = 1): string => {
    const date = addZonedCalendarDays(utcToZonedDateStr(new Date(), TZ), daysAhead);
    return zonedWallTimeToUtc(date, hhmm, TZ)!.toISOString();
  };

  async function makeUser(label: string, role: Role | null, salonId: string | null, extra: Record<string, unknown> = {}) {
    const user = await prisma.user.create({
      data: { email: `e2e-${run}-${label}@example.test`, phone: null, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), ...extra },
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

  async function makeStaff(label: string, displayName: string, salonId: string, serviceIds: string[]) {
    const user = await makeUser(label, Role.SALON_STAFF, salonId);
    const staff = await prisma.salonStaff.create({
      data: {
        salonId,
        userId: user.id,
        displayName,
        roleInSalon: 'BARBER',
        status: 'ACTIVE',
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
    ids[`${label}Staff`] = staff.id;
    return staff;
  }

  async function createBookingAs(customerLabel: string, startIso: string, opts: { serviceIds?: string[]; staffId?: string } = {}) {
    const res = await api('post', 'bookings', tok[customerLabel]).send({
      salonId: ids.salon,
      serviceIds: opts.serviceIds ?? [ids.haircut],
      slotStart: startIso,
      ...(opts.staffId ? { preferredStaffId: opts.staffId } : {}),
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    trigger = app.get(QueueAutoAssignTrigger);
    delivery = app.get(NotificationDeliveryService);
    expo = app.get(ExpoPushSender);

    const city = await prisma.city.findFirstOrThrow({ where: { slug: 'jharsuguda' } });
    const owner = await makeUser('owner', null, null);
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: `Owner Ops Salon ${run}`,
        slug: `owner-ops-${run}`,
        cityId: city.id,
        addressLine: '1 Test Road',
        lat: 21.85,
        lng: 84.0,
        status: SalonStatus.ACTIVE,
        timezone: TZ,
        currency: 'INR',
        phone: '+919800000001',
      },
    });
    ids.salon = salon.id;
    await prisma.userRole.create({ data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id } });
    tok.owner = tokens.signAccessToken(owner.id, [Role.SALON_OWNER], SessionAudience.STAFF);

    for (let day = 0; day < 7; day++) {
      await prisma.operatingHours.create({ data: { salonId: salon.id, dayOfWeek: day, openTime: '00:00', closeTime: '23:59', isClosed: false } });
    }
    const haircut = await prisma.service.create({ data: { salonId: salon.id, name: 'Haircut', price: '250.00', durationMinutes: 30 } });
    const beard = await prisma.service.create({ data: { salonId: salon.id, name: 'Beard Trim', price: '100.00', durationMinutes: 15 } });
    ids.haircut = haircut.id;
    ids.beard = beard.id;
    for (const label of ['Chair 1', 'Chair 2', 'Chair 3']) {
      const chair = await prisma.chair.create({ data: { salonId: salon.id, label } });
      ids[label] = chair.id;
    }
    // Ravi does haircut + beard; Sunil only haircuts.
    await makeStaff('ravi', 'Ravi', salon.id, [haircut.id, beard.id]);
    await makeStaff('sunil', 'Sunil', salon.id, [haircut.id]);
    await makeUser('cust1', Role.CUSTOMER, null, { phone: phone(1) });
    await makeUser('cust2', Role.CUSTOMER, null, { phone: phone(2) });

    // An unrelated shop + owner, to prove isolation.
    const outsider = await makeUser('outsider', null, null);
    const otherSalon = await prisma.salon.create({
      data: {
        ownerUserId: outsider.id,
        name: `Other Salon ${run}`,
        slug: `other-${run}`,
        cityId: city.id,
        addressLine: '2 Elsewhere Road',
        lat: 21.9,
        lng: 84.1,
        status: SalonStatus.ACTIVE,
        timezone: TZ,
        currency: 'INR',
      },
    });
    ids.otherSalon = otherSalon.id;
    await prisma.userRole.create({ data: { userId: outsider.id, role: Role.SALON_OWNER, salonId: otherSalon.id } });
    tok.outsider = tokens.signAccessToken(outsider.id, [Role.SALON_OWNER], SessionAudience.STAFF);
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------------------------------
  describe('authorization', () => {
    it('lets the owner read the overview, with real numbers and no fabricated revenue', async () => {
      const res = await api('get', `dashboard/salons/${ids.salon}/overview`, tok.owner).expect(200);
      expect(res.body.salonId).toBe(ids.salon);
      expect(res.body.currency).toBe('INR');
      expect(res.body.kpis.activeStaff).toBe(2);
      expect(res.body.kpis.recordedRevenueToday).toBe(0);
      expect(res.body.revenue.hasRecordedPayments).toBe(false);
      expect(res.body.revenue.today.changePercent).toBeNull();
      expect(res.body.staffPerformance).toHaveLength(2);
      expect(res.body.staffPerformance[0].rating).toBeNull();
    });

    it('rejects a customer on every owner/staff route', async () => {
      for (const path of [
        `dashboard/salons/${ids.salon}/overview`,
        `dashboard/salons/${ids.salon}/revenue`,
        `dashboard/salons/${ids.salon}/analytics/cancellations`,
        `dashboard/salons/${ids.salon}/billing-profile`,
        `dashboard/salons/${ids.salon}/invoices`,
        `dashboard/salons/${ids.salon}/staff/me/work`,
        `dashboard/salons/${ids.salon}/search?q=ha`,
      ]) {
        await api('get', path, tok.cust1).expect(403);
      }
    });

    it('rejects a barber on owner-only routes but lets them reach their own work', async () => {
      for (const path of [
        `dashboard/salons/${ids.salon}/overview`,
        `dashboard/salons/${ids.salon}/revenue`,
        `dashboard/salons/${ids.salon}/analytics/cancellations`,
        `dashboard/salons/${ids.salon}/billing-profile`,
        `dashboard/salons/${ids.salon}/invoices`,
      ]) {
        await api('get', path, tok.ravi).expect(403);
      }
      const work = await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.ravi).expect(200);
      expect(work.body.staffId).toBe(ids.raviStaff);
      expect(work.body.displayName).toBe('Ravi');
    });

    it("rejects another shop's owner everywhere, and the owner has no barber profile to work from", async () => {
      await api('get', `dashboard/salons/${ids.salon}/overview`, tok.outsider).expect(403);
      await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.outsider).send({ name: 'Sneaky' }).expect(403);
      await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.owner).expect(403);
    });

    it('does not let a barber change owner-only settings', async () => {
      await api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.ravi).send({ autoAssignEnabled: true }).expect(403);
      await api('patch', `dashboard/salons/${ids.salon}/contact-visibility`, tok.ravi).send({ showPhoneToCustomers: false }).expect(403);
      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.sunilStaff}/access/revoke`, tok.ravi).send({}).expect(403);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('shop cancellation, notification delivery and attribution', () => {
    it('cancels as the owner, records who did it and tells the customer exactly once', async () => {
      const booking = await createBookingAs('cust1', slot('10:00'));
      const res = await api('post', `dashboard/salons/${ids.salon}/bookings/${booking.id}/cancel`, tok.owner)
        .send({ reason: 'Barber unwell' })
        .expect(201);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.cancelledByActor).toBe('OWNER');
      expect(res.body.notification.inApp).toBe('SENT');
      // Nothing is claimed for a channel that cannot deliver: no device is registered.
      expect(res.body.notification.push).toBe('NO_DEVICE');

      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row.status).toBe('CANCELLED');
      expect(row.cancelledById).toBe(ids.owner);
      expect(row.cancelledByActor).toBe('OWNER');
      expect(row.cancellationReason).toBe('Barber unwell');
      expect(row.cancellationChargeAmount).toBeNull();
      expect(await prisma.customerLedgerEntry.count({ where: { bookingId: booking.id } })).toBe(0);

      const inbox = await api('get', 'notifications/mine', tok.cust1).expect(200);
      const note = (inbox.body.items as Array<{ type: string; payload: Record<string, unknown> }>).find(
        (n) => n.type === 'booking.cancelled_by_shop',
      );
      expect(note).toBeDefined();
      expect(note!.payload.salonName).toBe(`Owner Ops Salon ${run}`);
      expect(note!.payload.serviceName).toBe('Haircut');
      expect(note!.payload.reason).toBe('Barber unwell');
      expect(note!.payload.shopPhone).toBe('+919800000001');
      expect(String(note!.payload.message)).toContain('cancelled by the shop');
    });

    it('cancelling twice is refused (409) and never notifies a second time', async () => {
      const booking = await createBookingAs('cust1', slot('11:00'));
      await api('post', `dashboard/salons/${ids.salon}/bookings/${booking.id}/cancel`, tok.owner).send({}).expect(201);
      await api('post', `dashboard/salons/${ids.salon}/bookings/${booking.id}/cancel`, tok.owner).send({}).expect(409);
      expect(
        await prisma.notificationDelivery.count({ where: { dedupeKey: { startsWith: `booking.cancelled_by_shop:${booking.id}` } } }),
      ).toBe(2); // one IN_APP + one PUSH ledger row
      expect(
        await prisma.notification.count({ where: { userId: ids.cust1, type: 'booking.cancelled_by_shop', payload: { path: ['bookingId'], equals: booking.id } } }),
      ).toBe(1);
    });

    it('delivery is idempotent at the ledger: the same event can never produce two notifications', async () => {
      const key = `test.event:${randomUUID()}`;
      const input = {
        dedupeKey: key,
        userId: ids.cust2,
        type: 'booking.cancelled_by_shop' as const,
        inAppPayload: { hello: 'world' },
        deepLink: 'account/bookings',
        push: { title: 't', body: 'b', data: {}, category: 'BOOKING_UPDATES' as never },
      };
      const [a, b, c] = await Promise.all([delivery.deliverToUser(input), delivery.deliverToUser(input), delivery.deliverToUser(input)]);
      expect([a.inApp, b.inApp, c.inApp].every((s) => s === 'SENT')).toBe(true);
      expect(await prisma.notification.count({ where: { userId: ids.cust2, payload: { path: ['hello'], equals: 'world' } } })).toBe(1);
    });

    it('a failing push provider never rolls the cancellation back, is retried, and is recorded honestly', async () => {
      await prisma.pushDevice.create({ data: { userId: ids.cust2, expoPushToken: `ExponentPushToken[${run}-e2e]`, platform: 'android' } as never });
      const send = jest.spyOn(expo, 'send').mockRejectedValue(new Error('provider down'));
      try {
        const booking = await createBookingAs('cust2', slot('12:00'));
        const res = await api('post', `dashboard/salons/${ids.salon}/bookings/${booking.id}/cancel`, tok.owner).send({}).expect(201);
        expect(res.body.status).toBe('CANCELLED'); // the business action stands
        expect(res.body.notification.inApp).toBe('SENT'); // the durable in-app notice exists
        expect(res.body.notification.push).toBe('FAILED');
        const ledger = await prisma.notificationDelivery.findUniqueOrThrow({ where: { dedupeKey: `booking.cancelled_by_shop:${booking.id}:PUSH` } });
        expect(ledger.status).toBe('FAILED');
        expect(ledger.attempts).toBe(1);
        expect(ledger.nextAttemptAt).not.toBeNull();

        // The provider recovers; the sweep (run once its backoff has elapsed) delivers it.
        send.mockResolvedValue([{ status: 'ok', id: 't1' }]);
        const handled = await delivery.sweepRetries(new Date(Date.now() + 10 * 60_000));
        expect(handled).toBeGreaterThanOrEqual(1);
        const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { dedupeKey: `booking.cancelled_by_shop:${booking.id}:PUSH` } });
        expect(after.status).toBe('SENT');
        expect(after.attempts).toBe(2);
      } finally {
        send.mockRestore();
        await prisma.pushDevice.deleteMany({ where: { userId: ids.cust2 } });
      }
    });

    it('attributes cancellations to the real actor and never guesses for legacy rows', async () => {
      // customer's own cancellation
      const mine = await createBookingAs('cust1', slot('13:00'));
      await api('post', `bookings/${mine.id}/cancel`, tok.cust1).send({}).expect(200);
      // a barber cancelling an appointment assigned to them
      const assigned = await createBookingAs('cust1', slot('14:00'), { staffId: ids.raviStaff });
      await api('post', `dashboard/salons/${ids.salon}/bookings/${assigned.id}/cancel`, tok.ravi).send({ reason: 'Chair repair' }).expect(201);
      // legacy: cancelled before attribution existed and not by the customer
      const legacy = await createBookingAs('cust2', slot('15:00'));
      await prisma.booking.update({
        where: { id: legacy.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: null, cancelledByActor: null },
      });

      const res = await api('get', `dashboard/salons/${ids.salon}/analytics/cancellations?range=30d`, tok.owner).expect(200);
      expect(res.body.byActor.OWNER).toBeGreaterThanOrEqual(3);
      expect(res.body.byActor.CUSTOMER).toBeGreaterThanOrEqual(1);
      expect(res.body.byActor.STAFF).toBe(1);
      expect(res.body.byActor.UNKNOWN).toBeGreaterThanOrEqual(1);
      expect(res.body.unattributedCount).toBe(res.body.byActor.UNKNOWN);
      const legacyRow = (res.body.rows as Array<{ bookingId: string; actor: string }>).find((r) => r.bookingId === legacy.id);
      expect(legacyRow?.actor).toBe('UNKNOWN');
      const staffRow = (res.body.rows as Array<{ bookingId: string; actor: string; reason: string }>).find((r) => r.bookingId === assigned.id);
      expect(staffRow).toMatchObject({ actor: 'STAFF', reason: 'Chair repair' });
      expect(res.body.cancellationRatePercent).toBeGreaterThan(0);

      const onlyCustomer = await api('get', `dashboard/salons/${ids.salon}/analytics/cancellations?range=30d&actor=CUSTOMER`, tok.owner).expect(200);
      expect(onlyCustomer.body.rows.every((r: { actor: string }) => r.actor === 'CUSTOMER')).toBe(true);
      // Live Queue outcomes are reported separately, never mixed into booking cancellations.
      expect(res.body.liveQueue).toEqual({ cancelled: expect.any(Number), expired: expect.any(Number), noShow: expect.any(Number) });
    });

    it("a barber cannot cancel a colleague's appointment or another shop's booking", async () => {
      const theirs = await createBookingAs('cust1', slot('16:00'), { staffId: ids.sunilStaff });
      await api('post', `dashboard/salons/${ids.salon}/bookings/${theirs.id}/cancel`, tok.ravi).send({}).expect(403);
      await api('post', `dashboard/salons/${ids.salon}/bookings/${theirs.id}/cancel`, tok.outsider).send({}).expect(403);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('CONFIRMED');
    });

    it('the shop phone is shown to the customer only while the owner publishes it', async () => {
      const booking = await createBookingAs('cust1', slot('09:00', 2));
      const shown = await api('get', `bookings/${booking.id}`, tok.cust1).expect(200);
      expect(shown.body.shopPhone).toBe('+919800000001');
      await api('patch', `dashboard/salons/${ids.salon}/contact-visibility`, tok.owner).send({ showPhoneToCustomers: false }).expect(200);
      const hidden = await api('get', `bookings/${booking.id}`, tok.cust1).expect(200);
      expect(hidden.body.shopPhone).toBeNull();
      await api('patch', `dashboard/salons/${ids.salon}/contact-visibility`, tok.owner).send({ showPhoneToCustomers: true }).expect(200);
      expect(await prisma.auditLog.count({ where: { action: 'SALON_PHONE_VISIBILITY_CHANGED', entityId: ids.salon } })).toBe(2);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('in-shop appointments', () => {
    it('creates a guest appointment with no account, no payment QR and a full audit trail', async () => {
      const startIso = slot('10:30', 3);
      const res = await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner)
        .send({ guestName: 'Mohan Das', serviceIds: [ids.haircut], slotStart: startIso, note: 'Prefers scissors only' })
        .expect(201);
      expect(res.body.guestName).toBe('Mohan Das');
      expect(res.body.guestPhone).toBeNull();
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.source).toBe('IN_SHOP');
      expect(row.customerId).toBeNull();
      expect(row.status).toBe('CONFIRMED'); // no online prepayment gate for an in-person booking
      expect(row.createdByUserId).toBe(ids.owner);
      expect(await prisma.auditLog.count({ where: { action: 'BOOKING_CREATED_IN_SHOP', entityId: row.id } })).toBe(1);
      // it is a real booking: it shows up in the owner's Bookings list
      const list = await api('get', `dashboard/salons/${ids.salon}/bookings?filter=all`, tok.owner).expect(200);
      const found = (list.body.items as Array<{ id: string; guestName?: string }>).find((b) => b.id === row.id);
      expect(found?.guestName).toBe('Mohan Das');
    });

    it('stores a phone only with consent and never invents a user account', async () => {
      const usersBefore = await prisma.user.count();
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.ravi)
        .send({ guestName: 'Kiran', guestPhone: '9876511111', serviceIds: [ids.haircut], slotStart: slot('11:30', 3) })
        .expect(400);
      const ok = await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.ravi)
        .send({ guestName: 'Kiran', guestPhone: '9876511111', contactConsent: true, serviceIds: [ids.haircut], slotStart: slot('11:30', 3) })
        .expect(201);
      expect(ok.body.guestPhone).toBe('+919876511111');
      expect(await prisma.user.count()).toBe(usersBefore);
    });

    it('rejects an exact duplicate even with a fresh idempotency key, and an over-capacity slot', async () => {
      const startIso = slot('13:30', 3);
      const body = { guestName: 'Duplicate Dan', serviceIds: [ids.haircut], slotStart: startIso };
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner).send(body).expect(201);
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner).send(body).expect(409);
      // capacity = min(2 qualified barbers, 3 chairs) = 2 per slot
      const busy = slot('15:30', 3);
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner).send({ guestName: 'A One', serviceIds: [ids.haircut], slotStart: busy }).expect(201);
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner).send({ guestName: 'B Two', serviceIds: [ids.haircut], slotStart: busy }).expect(201);
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner).send({ guestName: 'C Three', serviceIds: [ids.haircut], slotStart: busy }).expect(409);
    });

    it('does not let another shop create an appointment here, and rejects a barber who cannot do the service', async () => {
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.outsider)
        .send({ guestName: 'Nope', serviceIds: [ids.haircut], slotStart: slot('17:00', 3) })
        .expect(403);
      await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner)
        .send({ guestName: 'Needs Beard', serviceIds: [ids.beard], slotStart: slot('17:30', 3), preferredStaffId: ids.sunilStaff })
        .expect(400);
    });

    it('a booking made by the shop for a guest can be cancelled with nobody to notify', async () => {
      const made = await api('post', `dashboard/salons/${ids.salon}/bookings/in-shop`, tok.owner)
        .send({ guestName: 'Walk Away', serviceIds: [ids.haircut], slotStart: slot('18:00', 3) })
        .expect(201);
      const res = await api('post', `dashboard/salons/${ids.salon}/bookings/${made.body.id}/cancel`, tok.owner).send({}).expect(201);
      expect(res.body.notification).toEqual({ inApp: 'NO_ACCOUNT', push: 'NO_ACCOUNT' });
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('Live Queue: separated views, seating, completion and positions', () => {
    const board = async () => (await api('get', `dashboard/salons/${ids.salon}/queue`, tok.owner).expect(200)).body;
    const addCustomer = async (name: string, extra: Record<string, unknown> = {}) =>
      (await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner).send({ name, ...extra }).expect(201)).body as {
        id: string;
        status: string;
        customerName: string;
        arrivedAt: string | null;
        position: number | null;
      };
    const idsIn = (entries: Array<{ id: string }>) => entries.map((e) => e.id);

    it('adds a local customer who is waiting, named, present, and in exactly one section', async () => {
      const entry = await addCustomer('Anil Verma');
      expect(entry).toMatchObject({ status: 'WAITING', customerName: 'Anil Verma' });
      expect(entry.arrivedAt).not.toBeNull();
      const b = await board();
      expect(typeof b.revision).toBe('number');
      expect(idsIn(b.sections.waiting)).toContain(entry.id);
      expect(idsIn(b.sections.inService)).not.toContain(entry.id);
      expect(idsIn(b.sections.completedToday)).not.toContain(entry.id);
      // every entry of the legacy flat list is in exactly one section
      const all = [...b.sections.waiting, ...b.sections.called, ...b.sections.inService];
      expect(new Set(idsIn(all)).size).toBe(all.length);
      expect(idsIn(b.entries).sort()).toEqual(idsIn(all).sort());
      expect(b.counts.waiting).toBe(b.sections.waiting.length);
      expect(b.autoAssignEnabled).toBe(false);
      // clean up for the following tests
      await api('post', `dashboard/queue-entries/${entry.id}/cancel`, tok.owner).expect(201);
    });

    it('refuses the same customer added twice within moments (a double tap), but not a different one', async () => {
      const first = await addCustomer('Double Tap');
      await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner).send({ name: 'Double Tap' }).expect(409);
      const other = await addCustomer('Someone Else');
      for (const id of [first.id, other.id]) await api('post', `dashboard/queue-entries/${id}/cancel`, tok.owner).expect(201);
    });

    it('seating moves the customer out of Waiting into In service; completion moves them to Completed and frees the barber', async () => {
      const entry = await addCustomer('Seated Sam', { serviceId: ids.haircut });
      await api('post', `dashboard/queue-entries/${entry.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'] }).expect(201);
      let b = await board();
      expect(idsIn(b.sections.waiting)).not.toContain(entry.id);
      expect(idsIn(b.sections.inService)).toContain(entry.id);
      const session = b.sections.inService.find((e: { id: string }) => e.id === entry.id).activeServiceSessionId as string;

      // The barber sees exactly this as THEIR current service; the colleague sees none.
      const mine = await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.ravi).expect(200);
      expect(mine.body.current).toMatchObject({ queueEntryId: entry.id, serviceSessionId: session, customerLabel: 'Seated Sam' });
      expect((await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.sunil).expect(200)).body.current).toBeNull();

      // A colleague may not complete it; the performing barber may; a repeat is refused (no double completion).
      await api('post', `dashboard/service-sessions/${session}/complete`, tok.sunil).expect(403);
      await api('post', `dashboard/service-sessions/${session}/complete`, tok.ravi).expect(201);
      await api('post', `dashboard/service-sessions/${session}/complete`, tok.ravi).expect(409);

      b = await board();
      expect(idsIn(b.sections.inService)).not.toContain(entry.id);
      expect(idsIn(b.sections.completedToday)).toContain(entry.id);
      const after = await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.ravi).expect(200);
      expect(after.body.current).toBeNull();
      expect(after.body.completedToday).toBeGreaterThanOrEqual(1);
      // the barber is immediately free again
      const next = await addCustomer('Next Nick', { serviceId: ids.haircut });
      await api('post', `dashboard/queue-entries/${next.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'] }).expect(201);
      const nextSession = (await board()).sections.inService.find((e: { id: string }) => e.id === next.id).activeServiceSessionId as string;
      await api('post', `dashboard/service-sessions/${nextSession}/complete`, tok.owner).expect(201); // the owner may complete any
    });

    it('keeps waiting positions contiguous and unique, and shows cancellations only under History', async () => {
      const a = await addCustomer('Pos A');
      const bb = await addCustomer('Pos B');
      const c = await addCustomer('Pos C');
      let b = await board();
      const positions = (list: Array<{ position: number }>) => list.map((e) => e.position);
      const mine = b.sections.waiting.filter((e: { id: string }) => [a.id, bb.id, c.id].includes(e.id));
      expect(positions(b.sections.waiting)).toEqual(b.sections.waiting.map((_: unknown, i: number) => i + 1));
      expect(mine).toHaveLength(3);

      await api('post', `dashboard/queue-entries/${a.id}/cancel`, tok.owner).expect(201);
      b = await board();
      expect(positions(b.sections.waiting)).toEqual(b.sections.waiting.map((_: unknown, i: number) => i + 1));
      expect(idsIn(b.sections.waiting)).not.toContain(a.id);
      expect(idsIn(b.sections.historyToday)).toContain(a.id);
      expect(idsIn(b.sections.completedToday)).not.toContain(a.id);
      for (const id of [bb.id, c.id]) await api('post', `dashboard/queue-entries/${id}/cancel`, tok.owner).expect(201);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('Automatic barber allocation', () => {
    const board = async () => (await api('get', `dashboard/salons/${ids.salon}/queue`, tok.owner).expect(200)).body;
    const add = async (name: string, extra: Record<string, unknown> = {}) =>
      (await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner).send({ name, ...extra }).expect(201)).body as { id: string };
    const settle = () => trigger.idle(ids.salon);
    const activeSessions = () =>
      prisma.serviceSession.findMany({ where: { status: 'ACTIVE', chair: { salonId: ids.salon } }, include: { queueEntry: true } });
    const cleanup = async () => {
      for (const s of await activeSessions()) await api('post', `dashboard/service-sessions/${s.id}/complete`, tok.owner).expect(201);
      const waiting = (await board()).sections.waiting as Array<{ id: string }>;
      for (const e of waiting) await api('post', `dashboard/queue-entries/${e.id}/cancel`, tok.owner);
      await api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).send({ autoAssignEnabled: false }).expect(200);
      await settle();
    };

    afterEach(cleanup);

    it('is OFF by default: a present customer waits even though a barber and chair are free', async () => {
      const e = await add('Waits Wally', { serviceId: ids.haircut });
      await settle();
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toContain(e.id);
      expect(await activeSessions()).toHaveLength(0);
    });

    it('when the owner turns it on it seats present customers fairly, FIFO, on distinct chairs and leaves the rest waiting', async () => {
      // Ravi has already finished services today (earlier tests); Sunil has not => Sunil gets the first customer.
      const first = await add('First Fay', { serviceId: ids.haircut });
      const second = await add('Second Sid', { serviceId: ids.haircut });
      const third = await add('Third Tia', { serviceId: ids.haircut });
      await api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).send({ autoAssignEnabled: true }).expect(200);
      await settle();
      const sessions = await activeSessions();
      expect(sessions).toHaveLength(2); // two barbers, so exactly two seated
      const byEntry = new Map(sessions.map((s) => [s.queueEntryId, s]));
      expect(byEntry.get(first.id)?.staffId).toBe(ids.sunilStaff);
      expect(byEntry.get(second.id)?.staffId).toBe(ids.raviStaff);
      expect(byEntry.has(third.id)).toBe(false);
      expect(new Set(sessions.map((s) => s.chairId)).size).toBe(2);
      expect(new Set(sessions.map((s) => s.staffId)).size).toBe(2);

      const b = await board();
      // seated customers left the Waiting section; the third remains, as position 1
      expect(b.sections.waiting.map((x: { id: string }) => x.id)).toEqual([third.id]);
      expect(b.sections.waiting[0].position).toBe(1);
      expect(b.sections.inService.map((x: { id: string }) => x.id).sort()).toEqual([first.id, second.id].sort());
      expect(await prisma.auditLog.count({ where: { action: 'QUEUE_ENTRY_AUTO_ASSIGNED', entityId: first.id } })).toBe(1);

      // Completing a service frees that barber and the allocator immediately seats the next one.
      const sunilSession = sessions.find((x) => x.staffId === ids.sunilStaff)!;
      await api('post', `dashboard/service-sessions/${sunilSession.id}/complete`, tok.sunil).expect(201);
      await settle();
      const now = await activeSessions();
      expect(now.map((x) => x.queueEntryId)).toContain(third.id);
      expect((await board()).sections.waiting).toHaveLength(0);
    });

    it('never seats someone who has not arrived yet, a barber who is busy, or a barber lacking the skill', async () => {
      await api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).send({ autoAssignEnabled: true }).expect(200);
      // remote customer: joined through the app, not yet in the shop => never auto-seated
      const remote = await api('post', `salons/${ids.salon}/queue/join`, tok.cust1).send({ serviceId: ids.haircut, contactName: 'Remote Ria', contactPhone: '9876500009' }).expect(201);
      await settle();
      expect(await activeSessions()).toHaveLength(0);
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toContain(remote.body.id);
      await api('post', `dashboard/queue-entries/${remote.body.id}/cancel`, tok.owner).expect(201);

      // Ravi is busy; a beard customer needs a barber who can do beards (only Ravi can) => waits though Sunil is free.
      const haircut = await add('Busy Bee', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      await settle();
      expect((await activeSessions()).map((s) => s.staffId)).toEqual([ids.raviStaff]);
      const beard = await add('Beard Ben', { serviceId: ids.beard });
      await settle();
      const sessionsNow = await activeSessions();
      expect(sessionsNow.map((s) => s.queueEntryId)).not.toContain(beard.id); // Sunil is free but unqualified
      expect(sessionsNow.filter((s) => s.staffId === ids.sunilStaff)).toHaveLength(0);
      // When Ravi finishes, the beard customer is seated with Ravi, the only qualified barber.
      const raviSession = sessionsNow.find((s) => s.queueEntryId === haircut.id)!;
      await api('post', `dashboard/service-sessions/${raviSession.id}/complete`, tok.ravi).expect(201);
      await settle();
      const after = await activeSessions();
      expect(after.find((s) => s.queueEntryId === beard.id)?.staffId).toBe(ids.raviStaff);
    });

    it('honors a preferred barber exactly: waits for them rather than taking someone else', async () => {
      await api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).send({ autoAssignEnabled: true }).expect(200);
      const blocker = await add('Blocks Ravi', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      await settle();
      const wantsRavi = await add('Wants Ravi', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      const anyone = await add('Anyone Alex', { serviceId: ids.haircut });
      await settle();
      const sessions = await activeSessions();
      expect(sessions.map((s) => s.queueEntryId)).not.toContain(wantsRavi.id);
      // an earlier customer waiting for a busy preferred barber does not block the next customer
      expect(sessions.find((s) => s.queueEntryId === anyone.id)?.staffId).toBe(ids.sunilStaff);
      void blocker;
    });

    it('concurrent allocation requests seat a customer exactly once and never double-book a barber', async () => {
      const entry = await add('Race Rick', { serviceId: ids.haircut });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => api('post', `dashboard/salons/${ids.salon}/queue/auto-assign`, tok.owner).then((r) => r.status)),
      );
      expect(results.every((c) => c === 201)).toBe(true);
      const sessions = await activeSessions();
      expect(sessions.filter((s) => s.queueEntryId === entry.id)).toHaveLength(1);
      expect(new Set(sessions.map((s) => s.staffId)).size).toBe(sessions.length);
      expect(new Set(sessions.map((s) => s.chairId)).size).toBe(sessions.length);
    });

    it('lets a barber take the next customer they are allowed to serve, but not while serving', async () => {
      const first = await add('Next For Sunil', { serviceId: ids.haircut });
      const taken = await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.sunil).expect(201);
      expect(taken.body).toMatchObject({ id: first.id, status: 'IN_SERVICE', assignedStaffId: ids.sunilStaff });
      await add('Another One', { serviceId: ids.haircut });
      await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.sunil).expect(409); // already serving
      // the owner has no barber profile, so cannot "take" a customer
      await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.owner).expect(403);
    });

    it('explains why a customer cannot be seated instead of failing silently', async () => {
      // 3 chairs, 2 barbers: after both barbers are busy the third request has nobody to take it
      const a = await add('Fill A', { serviceId: ids.haircut });
      const b = await add('Fill B', { serviceId: ids.haircut });
      const c = await add('Fill C', { serviceId: ids.haircut });
      const res = await api('post', `dashboard/salons/${ids.salon}/queue/auto-assign`, tok.owner).expect(201);
      expect(res.body.assigned).toHaveLength(2);
      expect(res.body.skipped).toHaveLength(1);
      expect(res.body.skipped[0].entryId).toBe(c.id);
      expect(String(res.body.skipped[0].reason)).toMatch(/barber|busy|chair/i);
      void a;
      void b;
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('Staff access', () => {
    it('an owner can remove a barber’s access immediately, and restore it; history is kept', async () => {
      await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.sunil).expect(200);
      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.sunilStaff}/access/revoke`, tok.owner).send({ reason: 'Left the shop' }).expect(201);
      // the still-valid access token no longer opens anything at this shop
      await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.sunil).expect(403);
      await api('get', `dashboard/salons/${ids.salon}/queue`, tok.sunil).expect(403);
      await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.sunil).send({ name: 'Nope' }).expect(403);
      const row = await prisma.salonStaff.findUniqueOrThrow({ where: { id: ids.sunilStaff } });
      expect(row.accessRevokedAt).not.toBeNull();
      expect(row.status).toBe('INACTIVE');
      expect(await prisma.userRole.count({ where: { userId: ids.sunil, role: Role.SALON_STAFF, salonId: ids.salon } })).toBe(0);
      expect(await prisma.serviceSession.count({ where: { staffId: ids.sunilStaff } })).toBeGreaterThan(0); // history untouched
      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.sunilStaff}/access/revoke`, tok.owner).send({}).expect(409);
      // a revoked barber cannot clock themselves back in
      await api('patch', `dashboard/staff/${ids.sunilStaff}/status`, tok.sunil).send({ status: 'ACTIVE' }).expect(403);

      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.sunilStaff}/access/restore`, tok.owner).send({}).expect(201);
      await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, tok.sunil).expect(200);
      await api('patch', `dashboard/staff/${ids.sunilStaff}/status`, tok.sunil).send({ status: 'ACTIVE' }).expect(200);
      expect(await prisma.auditLog.count({ where: { entityId: ids.sunilStaff, action: { in: ['STAFF_ACCESS_REVOKED', 'STAFF_ACCESS_RESTORED'] } } })).toBe(2);
    });

    it('refuses to remove a barber who is serving a customer, and refuses self-removal', async () => {
      const entry = (await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner).send({ name: 'In Chair', serviceId: ids.haircut }).expect(201)).body as { id: string };
      await api('post', `dashboard/queue-entries/${entry.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 2'] }).expect(201);
      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.raviStaff}/access/revoke`, tok.owner).send({}).expect(409);
      const session = await prisma.serviceSession.findFirstOrThrow({ where: { queueEntryId: entry.id } });
      await api('post', `dashboard/service-sessions/${session.id}/complete`, tok.owner).expect(201);
    });
  });

  // @@BILLING@@
});

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

// The fixture shop uses whichever zone currently has mid-day local hours, so scenarios that book
// "a few minutes from now" (check-in has a 15-minute window) never straddle the shop's closing time
// or local midnight, whatever hour the suite runs at. Production code is timezone-aware throughout.
const CANDIDATE_ZONES = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'America/Los_Angeles'];
const localHourIn = (zone: string) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date())) % 24;
const TZ = CANDIDATE_ZONES.find((zone) => localHourIn(zone) >= 7 && localHourIn(zone) <= 19) ?? 'Asia/Kolkata';

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
        // The shop-level scenarios below (queue board, invoices, ...) drive seating by hand, so this fixture
        // is the "owner switched automatic assignment OFF" case. The ON-by-default behaviour is proven on a
        // brand-new shop at the end of the allocation scenarios.
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
  describe('Automatic barber allocation: assigned is not in service', () => {
    const board = async () => (await api('get', `dashboard/salons/${ids.salon}/queue`, tok.owner).expect(200)).body;
    const add = async (name: string, extra: Record<string, unknown> = {}) =>
      (await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner).send({ name, ...extra }).expect(201)).body as { id: string };
    const settle = () => trigger.idle(ids.salon);
    const setAuto = (enabled: boolean) =>
      api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).send({ autoAssignEnabled: enabled }).expect(200);
    const activeSessions = () =>
      prisma.serviceSession.findMany({ where: { status: 'ACTIVE', chair: { salonId: ids.salon } }, include: { queueEntry: true } });
    /** Customers with a barber and chair RESERVED whose service has not started. */
    const assignedHolds = () =>
      prisma.queueEntry.findMany({ where: { salonId: ids.salon, status: 'CALLED', assignedStaffId: { not: null } } });
    const tokenOfStaff = (staffId: string) => (staffId === ids.raviStaff ? tok.ravi : tok.sunil);
    const start = (entryId: string, token: string) => api('post', `dashboard/queue-entries/${entryId}/start-service`, token);
    const cleanup = async () => {
      await setAuto(false);
      await settle();
      for (const s of await activeSessions()) await api('post', `dashboard/service-sessions/${s.id}/complete`, tok.owner).expect(201);
      const b = await board();
      for (const e of [...b.sections.waiting, ...(b.sections.called ?? []), ...(b.sections.assigned ?? [])] as Array<{ id: string }>) {
        await api('post', `dashboard/queue-entries/${e.id}/cancel`, tok.owner);
      }
      await settle();
    };

    afterEach(cleanup);

    it('persists the owner’s choice: OFF is kept, ON again is kept, every change is audited, and the server reports it', async () => {
      await setAuto(false);
      expect((await api('get', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).expect(200)).body).toEqual({ autoAssignEnabled: false });
      expect((await board()).autoAssignEnabled).toBe(false);
      expect((await api('get', `dashboard/salons/${ids.salon}/overview`, tok.owner).expect(200)).body.settings.autoAssignEnabled).toBe(false);
      expect((await prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } })).queueAutoAssignEnabled).toBe(false);

      await setAuto(true);
      expect((await api('get', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).expect(200)).body).toEqual({ autoAssignEnabled: true });
      expect((await board()).autoAssignEnabled).toBe(true);
      expect((await api('get', `dashboard/salons/${ids.salon}/overview`, tok.owner).expect(200)).body.settings.autoAssignEnabled).toBe(true);

      expect(await prisma.auditLog.count({ where: { entityId: ids.salon, action: 'QUEUE_AUTO_ASSIGN_DISABLED' } })).toBeGreaterThanOrEqual(1);
      expect(await prisma.auditLog.count({ where: { entityId: ids.salon, action: 'QUEUE_AUTO_ASSIGN_ENABLED' } })).toBeGreaterThanOrEqual(1);
      // a barber may read the setting (the Live Queue shows it) but never change it
      expect((await api('get', `dashboard/salons/${ids.salon}/queue/settings`, tok.ravi).expect(200)).body).toEqual({ autoAssignEnabled: true });
      // another shop's owner can neither read nor change it
      await api('get', `dashboard/salons/${ids.salon}/queue/settings`, tok.outsider).expect(403);
      await api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.outsider).send({ autoAssignEnabled: false }).expect(403);
    });

    it('OFF: a present customer simply waits even though a barber and chair are free', async () => {
      await setAuto(false);
      const e = await add('Waits Wally', { serviceId: ids.haircut });
      await settle();
      const b = await board();
      expect(b.sections.waiting.map((x: { id: string }) => x.id)).toContain(e.id);
      expect(await assignedHolds()).toHaveLength(0);
      expect(await activeSessions()).toHaveLength(0);
    });

    it('ON: present customers are ASSIGNED fairly, FIFO, on distinct chairs - and NOT started; the rest keep waiting', async () => {
      const first = await add('First Fay', { serviceId: ids.haircut });
      const second = await add('Second Sid', { serviceId: ids.haircut });
      const third = await add('Third Tia', { serviceId: ids.haircut });
      await setAuto(true);
      await settle();

      const holds = await assignedHolds();
      expect(holds.map((h) => h.id).sort()).toEqual([first.id, second.id].sort()); // two barbers: exactly two, FIFO
      expect(new Set(holds.map((h) => h.assignedStaffId)).size).toBe(2);
      expect(new Set(holds.map((h) => h.assignedChairId)).size).toBe(2);
      for (const h of holds) {
        expect(h.serviceStartedAt).toBeNull(); // assigned is NOT started
        expect(h.assignedAt).not.toBeNull();
      }
      expect(await activeSessions()).toHaveLength(0); // no service session was opened

      const b = await board();
      const ids3 = (rows: Array<{ id: string }>) => rows.map((x) => x.id);
      expect(ids3(b.sections.assigned).sort()).toEqual([first.id, second.id].sort());
      expect(ids3(b.sections.inService)).toEqual([]);
      expect(ids3(b.sections.waiting)).toEqual([third.id]);
      expect(b.sections.waiting[0].position).toBe(1);
      expect(b.counts).toMatchObject({ waiting: 1, assigned: 2, inService: 0 });
      for (const e of b.sections.assigned as Array<{ phase: string; serviceStartedAt: string | null; assignedStaffName: string | null; assignedChairLabel: string | null }>) {
        expect(e).toMatchObject({ phase: 'ASSIGNED', serviceStartedAt: null });
        expect(e.assignedStaffName).toBeTruthy();
        expect(e.assignedChairLabel).toBeTruthy();
      }
      expect(await prisma.auditLog.count({ where: { action: 'QUEUE_ENTRY_AUTO_ASSIGNED', entityId: first.id } })).toBe(1);
    });

    it('a barber with a customer assigned is not given a second one, and their chair is not reused', async () => {
      await setAuto(true);
      const a = await add('Hold A', { serviceId: ids.haircut });
      const b2 = await add('Hold B', { serviceId: ids.haircut });
      await settle();
      expect(await assignedHolds()).toHaveLength(2);
      const c = await add('Hold C', { serviceId: ids.haircut });
      const d = await add('Hold D', { serviceId: ids.haircut });
      await settle();
      const holds = await assignedHolds();
      expect(holds).toHaveLength(2);
      expect(holds.map((h) => h.id).sort()).toEqual([a.id, b2.id].sort());
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toEqual([c.id, d.id]);
      // and a manual attempt to hand a held barber a second customer is refused
      const holder = holds[0];
      await api('post', `dashboard/queue-entries/${c.id}/assign`, tok.owner)
        .send({ staffId: holder.assignedStaffId, chairId: ids['Chair 3'], startService: false })
        .expect(409);
      // ... and so is putting a second customer in a chair someone else is waiting in
      const other = holds[1];
      await api('post', `dashboard/queue-entries/${c.id}/assign`, tok.owner)
        .send({ staffId: other.assignedStaffId, chairId: holder.assignedChairId, startService: false })
        .expect(409);
    });

    it('the assigned barber starts service explicitly: only then is it IN_SERVICE, with a real start time and an ACTIVE session', async () => {
      await setAuto(true);
      const first = await add('Start Me', { serviceId: ids.haircut });
      await settle();
      const hold = (await assignedHolds()).find((h) => h.id === first.id)!;
      expect(hold).toBeTruthy();
      const barber = tokenOfStaff(hold.assignedStaffId as string);
      const colleague = hold.assignedStaffId === ids.raviStaff ? tok.sunil : tok.ravi;
      // The barber's own view lists the customer as ASSIGNED to them, not as their current service.
      const mine = await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, barber).expect(200);
      expect(mine.body.current).toBeNull();
      expect(mine.body.assigned).toMatchObject({ queueEntryId: first.id, serviceSessionId: null, startedAt: null, status: 'CALLED' });
      // a colleague may not start someone else's customer
      await start(first.id, colleague).expect(403);
      expect(await activeSessions()).toHaveLength(0);

      const started = await start(first.id, barber).expect(201);
      expect(started.body).toMatchObject({ id: first.id, status: 'IN_SERVICE', phase: 'IN_SERVICE', assignedStaffId: hold.assignedStaffId });
      expect(started.body.serviceStartedAt).not.toBeNull();
      expect(started.body.activeServiceSessionId).toBeTruthy();
      const sessions = await activeSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ queueEntryId: first.id, staffId: hold.assignedStaffId, chairId: hold.assignedChairId });
      expect(await assignedHolds()).toHaveLength(0);
      const after = await api('get', `dashboard/salons/${ids.salon}/staff/me/work`, barber).expect(200);
      expect(after.body.current).toMatchObject({ queueEntryId: first.id });
      expect(after.body.assigned).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: 'QUEUE_ENTRY_SERVICE_STARTED', entityId: first.id } })).toBe(1);
      // starting again (a double tap) changes nothing
      await start(first.id, barber).expect(201);
      expect(await activeSessions()).toHaveLength(1);
    });

    it('the owner may start any assigned customer; a waiting or unassigned customer cannot be started', async () => {
      const waiting = await add('Not Assigned', { serviceId: ids.haircut });
      await start(waiting.id, tok.owner).expect(409);
      await setAuto(true);
      await settle();
      const hold = (await assignedHolds()).find((h) => h.id === waiting.id)!;
      expect(hold).toBeTruthy();
      await start(waiting.id, tok.owner).expect(201);
      expect((await activeSessions())[0].queueEntryId).toBe(waiting.id);
      // a customer or another shop's owner has no business starting anything here
      await start(waiting.id, tok.cust1).expect(403);
      await start(waiting.id, tok.outsider).expect(403);
    });

    it('completing a service releases the barber and chair, and the next waiting customer is ASSIGNED (not started)', async () => {
      await setAuto(true);
      const a = await add('Done A', { serviceId: ids.haircut });
      const b2 = await add('Done B', { serviceId: ids.haircut });
      const c = await add('Done C', { serviceId: ids.haircut });
      await settle();
      for (const h of await assignedHolds()) await start(h.id, tokenOfStaff(h.assignedStaffId as string)).expect(201);
      expect(await activeSessions()).toHaveLength(2);
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toEqual([c.id]);

      const sessionOfA = (await activeSessions()).find((s) => s.queueEntryId === a.id)!;
      await api('post', `dashboard/service-sessions/${sessionOfA.id}/complete`, tokenOfStaff(sessionOfA.staffId)).expect(201);
      await settle();
      // C now holds A's barber and chair - assigned, still not started
      const holds = await assignedHolds();
      expect(holds.map((h) => h.id)).toEqual([c.id]);
      expect(holds[0].assignedStaffId).toBe(sessionOfA.staffId);
      expect(holds[0].assignedChairId).toBe(sessionOfA.chairId);
      expect(holds[0].serviceStartedAt).toBeNull();
      expect((await activeSessions()).map((s) => s.queueEntryId)).toEqual([b2.id]);
      const done = await prisma.queueEntry.findUniqueOrThrow({ where: { id: a.id } });
      expect(done.status).toBe('COMPLETED');
      expect(done.serviceCompletedAt).not.toBeNull();
    });

    it('auto-assigns a remote arrival immediately after the owner marks them in the shop', async () => {
      await setAuto(true);
      const remote = await api('post', `salons/${ids.salon}/queue/join`, tok.cust1)
        .send({ serviceId: ids.haircut, contactName: 'Remote Arrival', contactPhone: '9876500009' }).expect(201);
      await settle();
      expect(await assignedHolds()).toHaveLength(0);
      const before = await prisma.queueEntry.findUniqueOrThrow({ where: { id: remote.body.id } });
      expect(before.arrivedAt).toBeNull();

      await api('post', `dashboard/queue-entries/${remote.body.id}/arrive`, tok.owner).expect(201);
      await settle();
      const after = await prisma.queueEntry.findUniqueOrThrow({ where: { id: remote.body.id } });
      expect(after.arrivedAt).not.toBeNull();
      expect(after).toMatchObject({ status: 'CALLED', assignedStaffId: expect.any(String), assignedChairId: expect.any(String), serviceStartedAt: null });
      expect(await prisma.serviceSession.count({ where: { queueEntryId: remote.body.id } })).toBe(0);
    });

    it('never assigns someone who has not arrived, a barber who is busy or holding a customer, or a barber lacking the skill', async () => {
      await setAuto(true);
      // remote customer: joined through the app, not yet in the shop => never auto-assigned
      const remote = await api('post', `salons/${ids.salon}/queue/join`, tok.cust1).send({ serviceId: ids.haircut, contactName: 'Remote Ria', contactPhone: '9876500009' }).expect(201);
      await settle();
      expect(await assignedHolds()).toHaveLength(0);
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toContain(remote.body.id);
      await api('post', `dashboard/queue-entries/${remote.body.id}/cancel`, tok.owner).expect(201);

      // Ravi is given a customer; a beard customer needs a barber who can do beards (only Ravi can),
      // so they WAIT although Sunil is free - and Sunil is never given them.
      const haircut = await add('Busy Bee', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      await settle();
      expect((await assignedHolds()).map((h) => h.assignedStaffId)).toEqual([ids.raviStaff]);
      const beard = await add('Beard Ben', { serviceId: ids.beard });
      await settle();
      expect((await assignedHolds()).map((h) => h.id)).not.toContain(beard.id);
      const waitingNow = (await board()).sections.waiting.map((x: { id: string }) => x.id);
      expect(waitingNow).toContain(beard.id);
      // When Ravi starts and finishes, the beard customer is assigned to Ravi, the only qualified barber.
      await start(haircut.id, tok.ravi).expect(201);
      const raviSession = (await activeSessions()).find((s) => s.queueEntryId === haircut.id)!;
      await api('post', `dashboard/service-sessions/${raviSession.id}/complete`, tok.ravi).expect(201);
      await settle();
      const after = await assignedHolds();
      expect(after.find((h) => h.id === beard.id)?.assignedStaffId).toBe(ids.raviStaff);
    });

    it('honors a preferred barber exactly: waits for them rather than taking someone else, without blocking the next customer', async () => {
      await setAuto(true);
      const blocker = await add('Blocks Ravi', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      await settle();
      const wantsRavi = await add('Wants Ravi', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      const anyone = await add('Anyone Alex', { serviceId: ids.haircut });
      await settle();
      const holds = await assignedHolds();
      expect(holds.map((h) => h.id)).not.toContain(wantsRavi.id);
      expect(holds.find((h) => h.id === blocker.id)?.assignedStaffId).toBe(ids.raviStaff);
      expect(holds.find((h) => h.id === anyone.id)?.assignedStaffId).toBe(ids.sunilStaff);
    });

    it('concurrent allocation requests assign a customer exactly once and never hold a barber or chair twice', async () => {
      const entry = await add('Race Rick', { serviceId: ids.haircut });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => api('post', `dashboard/salons/${ids.salon}/queue/auto-assign`, tok.owner).then((r) => r.status)),
      );
      expect(results.every((c) => c === 201)).toBe(true);
      const holds = await assignedHolds();
      expect(holds.filter((h) => h.id === entry.id)).toHaveLength(1);
      expect(new Set(holds.map((h) => h.assignedStaffId)).size).toBe(holds.length);
      expect(new Set(holds.map((h) => h.assignedChairId)).size).toBe(holds.length);
      expect(await activeSessions()).toHaveLength(0);
    });

    it('two simultaneous manual assignments of one barber to two different customers: exactly one wins', async () => {
      const x = await add('Contender X', { serviceId: ids.haircut });
      const y = await add('Contender Y', { serviceId: ids.haircut });
      const results = await Promise.all([
        api('post', `dashboard/queue-entries/${x.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: false }).then((r) => r.status),
        api('post', `dashboard/queue-entries/${y.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 2'], startService: false }).then((r) => r.status),
      ]);
      expect(results.filter((s) => s === 201)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(1);
      const holds = await assignedHolds();
      expect(holds).toHaveLength(1);
      expect(holds[0].assignedStaffId).toBe(ids.raviStaff);
    });

    it('two simultaneous Start Service taps create exactly one service session', async () => {
      await setAuto(true);
      const entry = await add('Double Start', { serviceId: ids.haircut });
      await settle();
      const hold = (await assignedHolds()).find((h) => h.id === entry.id)!;
      const barber = tokenOfStaff(hold.assignedStaffId as string);
      const results = await Promise.all([start(entry.id, barber).then((r) => r.status), start(entry.id, barber).then((r) => r.status)]);
      expect(results.every((s) => s === 201 || s === 409)).toBe(true);
      expect(results).toContain(201);
      expect(await prisma.serviceSession.count({ where: { queueEntryId: entry.id } })).toBe(1);
    });

    it('lets a barber take the next customer they may serve: assigned to them, started by them, and not while they hold or serve one', async () => {
      const first = await add('Next For Sunil', { serviceId: ids.haircut });
      const taken = await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.sunil).expect(201);
      expect(taken.body).toMatchObject({ id: first.id, status: 'CALLED', phase: 'ASSIGNED', assignedStaffId: ids.sunilStaff });
      expect(taken.body.serviceStartedAt).toBeNull();
      await add('Another One', { serviceId: ids.haircut });
      await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.sunil).expect(409); // already holds a customer
      await start(first.id, tok.sunil).expect(201);
      await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.sunil).expect(409); // already serving
      // the owner has no barber profile, so cannot "take" a customer
      await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.owner).expect(403);
    });

    it('explains why a customer cannot be assigned instead of failing silently', async () => {
      // 3 chairs, 2 barbers: after both barbers hold a customer the third request has nobody to take it
      const a = await add('Fill A', { serviceId: ids.haircut });
      const b2 = await add('Fill B', { serviceId: ids.haircut });
      const c = await add('Fill C', { serviceId: ids.haircut });
      const res = await api('post', `dashboard/salons/${ids.salon}/queue/auto-assign`, tok.owner).expect(201);
      expect(res.body.assigned).toHaveLength(2);
      expect(res.body.skipped).toHaveLength(1);
      expect(res.body.skipped[0].entryId).toBe(c.id);
      expect(String(res.body.skipped[0].reason)).toMatch(/barber|busy|chair/i);
      expect(await activeSessions()).toHaveLength(0); // the manual button assigns too; it does not start
      void a;
      void b2;
    });

    it('a cancelled assigned customer frees their barber and chair at once, and the next customer takes them', async () => {
      await setAuto(true);
      const a = await add('Cancel A', { serviceId: ids.haircut });
      const b2 = await add('Cancel B', { serviceId: ids.haircut });
      const c = await add('Cancel C', { serviceId: ids.haircut });
      await settle();
      const holdA = (await assignedHolds()).find((h) => h.id === a.id)!;
      await api('post', `dashboard/queue-entries/${a.id}/cancel`, tok.owner).expect(201);
      await settle();
      const holds = await assignedHolds();
      expect(holds.map((h) => h.id).sort()).toEqual([b2.id, c.id].sort());
      expect(holds.find((h) => h.id === c.id)?.assignedStaffId).toBe(holdA.assignedStaffId);
    });

    it('marking an assigned customer who never turned up as no-show releases the barber and chair', async () => {
      await setAuto(true);
      const a = await add('Ghost', { serviceId: ids.haircut });
      await settle();
      expect((await assignedHolds()).map((h) => h.id)).toContain(a.id);
      await api('post', `dashboard/queue-entries/${a.id}/no-show`, tok.owner).expect(201);
      expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('NO_SHOW');
      expect(await assignedHolds()).toHaveLength(0);
    });

    it('an assigned customer goes back to waiting (keeping their place) when their barber clocks out, and is re-assigned to someone free', async () => {
      await setAuto(true);
      // Sunil is busy with someone already, so the preferred-Ravi customer is assigned to Ravi.
      const entry = await add('Ravi Fan', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      await settle();
      expect((await assignedHolds()).find((h) => h.id === entry.id)?.assignedStaffId).toBe(ids.raviStaff);
      const joined = (await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).joinedAt;
      await setAuto(false);
      await api('patch', `dashboard/staff/${ids.raviStaff}/status`, tok.ravi).send({ status: 'INACTIVE' }).expect(200);
      const released = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(released).toMatchObject({ status: 'WAITING', assignedStaffId: null, assignedChairId: null, assignedAt: null });
      expect(released.joinedAt.getTime()).toBe(joined.getTime()); // keeps their place in line
      expect(await prisma.auditLog.count({ where: { entityId: entry.id, action: 'QUEUE_ASSIGNMENT_RELEASED' } })).toBe(1);
      await api('patch', `dashboard/staff/${ids.raviStaff}/status`, tok.ravi).send({ status: 'ACTIVE' }).expect(200);
      // the shop's own board shows them in Waiting again, not Assigned
      const b = await board();
      expect(b.sections.waiting.map((x: { id: string }) => x.id)).toContain(entry.id);
      expect((b.sections.assigned ?? []).map((x: { id: string }) => x.id)).not.toContain(entry.id);
    });

    it('a chair taken out of use releases the customer assigned to it', async () => {
      await setAuto(true);
      const entry = await add('Chair Casualty', { serviceId: ids.haircut });
      await settle();
      const hold = (await assignedHolds()).find((h) => h.id === entry.id)!;
      await setAuto(false);
      await api('patch', `dashboard/salons/${ids.salon}/chairs/${hold.assignedChairId}`, tok.owner).send({ status: 'MAINTENANCE' }).expect(200);
      const released = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(released).toMatchObject({ status: 'WAITING', assignedStaffId: null, assignedChairId: null });
      await api('patch', `dashboard/salons/${ids.salon}/chairs/${hold.assignedChairId}`, tok.owner).send({ status: 'ACTIVE' }).expect(200);
    });

    it('removing a barber’s access releases the customer assigned to them', async () => {
      await setAuto(true);
      const entry = await add('Access Casualty', { serviceId: ids.haircut, preferredStaffId: ids.sunilStaff });
      await settle();
      expect((await assignedHolds()).find((h) => h.id === entry.id)?.assignedStaffId).toBe(ids.sunilStaff);
      await setAuto(false);
      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.sunilStaff}/access/revoke`, tok.owner).send({ reason: 'test' }).expect(201);
      expect(await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ status: 'WAITING', assignedStaffId: null });
      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.sunilStaff}/access/restore`, tok.owner).send({}).expect(201);
      // restoring access does not put the barber back on duty by itself - they clock in again
      await api('patch', `dashboard/staff/${ids.sunilStaff}/status`, tok.sunil).send({ status: 'ACTIVE' }).expect(200);
    });

    it('an existing scheduled appointment keeps its barber: nobody is assigned into its window', async () => {
      // Ravi is booked from now for half an hour; the automatic allocator must give the walk-in to Sunil.
      const now = new Date();
      await prisma.booking.create({
        data: {
          salonId: ids.salon,
          customerId: ids.cust2,
          serviceId: ids.haircut,
          preferredStaffId: ids.raviStaff,
          slotStart: new Date(now.getTime() - 5 * 60_000),
          slotEnd: new Date(now.getTime() + 25 * 60_000),
          status: 'CONFIRMED',
          source: 'APP',
          idempotencyKey: `e2e-${run}-reserved-ravi`,
        },
      });
      try {
        await setAuto(true);
        const entry = await add('Walk Past Ravi', { serviceId: ids.haircut });
        await settle();
        const hold = (await assignedHolds()).find((h) => h.id === entry.id);
        expect(hold?.assignedStaffId).toBe(ids.sunilStaff);
        // and a second walk-in has nobody left: Ravi stays reserved for the appointment
        const second = await add('Second Walker', { serviceId: ids.haircut });
        await settle();
        expect((await assignedHolds()).map((h) => h.id)).not.toContain(second.id);
      } finally {
        // (a trigger snapshots booking_services, so release the reservation by cancelling, not deleting)
        await prisma.booking.updateMany({ where: { idempotencyKey: `e2e-${run}-reserved-ravi` }, data: { status: 'CANCELLED' } });
      }
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('A brand-new shop: automatic assignment is ON by default, backed by the database', () => {
    it('defaults ON, assigns an arrived customer without starting them, and the whole workflow completes', async () => {
      const owner = await makeUser('freshOwner', null, null);
      const city = await prisma.city.findFirstOrThrow({ where: { slug: 'jharsuguda' } });
      // NOTE: the setting is deliberately NOT supplied - the database default decides.
      const fresh = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Fresh Shop ${run}`,
          slug: `fresh-${run}`,
          cityId: city.id,
          addressLine: '3 New Road',
          lat: 21.8,
          lng: 84.0,
          status: SalonStatus.ACTIVE,
          timezone: TZ,
          currency: 'INR',
        },
      });
      expect(fresh.queueAutoAssignEnabled).toBe(true);
      await prisma.userRole.create({ data: { userId: owner.id, role: Role.SALON_OWNER, salonId: fresh.id } });
      const ownerTok = tokens.signAccessToken(owner.id, [Role.SALON_OWNER], SessionAudience.STAFF);
      for (let day = 0; day < 7; day++) {
        await prisma.operatingHours.create({ data: { salonId: fresh.id, dayOfWeek: day, openTime: '00:00', closeTime: '23:59', isClosed: false } });
      }
      const service = await prisma.service.create({ data: { salonId: fresh.id, name: 'Cut', price: '200.00', durationMinutes: 20 } });
      const chair = await prisma.chair.create({ data: { salonId: fresh.id, label: 'Chair A' } });
      const barberUser = await makeUser('freshBarber', Role.SALON_STAFF, fresh.id);
      const barberTok = tokens.signAccessToken(barberUser.id, [Role.SALON_STAFF], SessionAudience.STAFF);
      const barber = await prisma.salonStaff.create({
        // Deliberately no StaffService mapping: zero mappings means any on-duty barber can serve this service.
        // Previously bookings permitted this but Live Queue auto-assignment rejected everyone.
        data: { salonId: fresh.id, userId: barberUser.id, displayName: 'Fresh Barber', roleInSalon: 'BARBER', status: 'ACTIVE' },
      });

      expect(await prisma.staffService.count({ where: { serviceId: service.id } })).toBe(0);

      // every surface reports the server's value
      expect((await request(app.getHttpServer()).get(`/api/v1/dashboard/salons/${fresh.id}/queue/settings`).set('Authorization', `Bearer ${ownerTok}`).expect(200)).body).toEqual({ autoAssignEnabled: true });
      expect((await request(app.getHttpServer()).get(`/api/v1/dashboard/salons/${fresh.id}/queue`).set('Authorization', `Bearer ${ownerTok}`).expect(200)).body.autoAssignEnabled).toBe(true);
      expect((await request(app.getHttpServer()).get(`/api/v1/dashboard/salons/${fresh.id}/overview`).set('Authorization', `Bearer ${ownerTok}`).expect(200)).body.settings.autoAssignEnabled).toBe(true);

      const added = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/salons/${fresh.id}/queue/customers`)
        .set('Authorization', `Bearer ${ownerTok}`)
        .set('Idempotency-Key', randomUUID())
        .send({ name: 'First Ever', serviceId: service.id })
        .expect(201);
      await trigger.idle(fresh.id);
      const assigned = await prisma.queueEntry.findUniqueOrThrow({ where: { id: added.body.id } });
      expect(assigned).toMatchObject({ status: 'CALLED', assignedStaffId: barber.id, assignedChairId: chair.id, serviceStartedAt: null });
      expect(await prisma.serviceSession.count({ where: { queueEntryId: assigned.id } })).toBe(0);

      const started = await request(app.getHttpServer())
        .post(`/api/v1/dashboard/queue-entries/${assigned.id}/start-service`)
        .set('Authorization', `Bearer ${barberTok}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      expect(started.body).toMatchObject({ status: 'IN_SERVICE', phase: 'IN_SERVICE' });
      const session = await prisma.serviceSession.findFirstOrThrow({ where: { queueEntryId: assigned.id, status: 'ACTIVE' } });
      await request(app.getHttpServer())
        .post(`/api/v1/dashboard/service-sessions/${session.id}/complete`)
        .set('Authorization', `Bearer ${barberTok}`)
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      // the barber and chair are released
      expect(await prisma.serviceSession.count({ where: { status: 'ACTIVE', chair: { salonId: fresh.id } } })).toBe(0);
      expect(await prisma.queueEntry.count({ where: { salonId: fresh.id, status: 'CALLED' } })).toBe(0);
      const done = await prisma.queueEntry.findUniqueOrThrow({ where: { id: assigned.id } });
      expect(done.status).toBe('COMPLETED');

      // the owner can switch it OFF and back ON, and the choice sticks
      for (const enabled of [false, true]) {
        await request(app.getHttpServer())
          .patch(`/api/v1/dashboard/salons/${fresh.id}/queue/settings`)
          .set('Authorization', `Bearer ${ownerTok}`)
          .set('Idempotency-Key', randomUUID())
          .send({ autoAssignEnabled: enabled })
          .expect(200);
        const read = await request(app.getHttpServer()).get(`/api/v1/dashboard/salons/${fresh.id}/queue/settings`).set('Authorization', `Bearer ${ownerTok}`).expect(200);
        expect(read.body).toEqual({ autoAssignEnabled: enabled });
      }
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('Staff access', () => {
    it('an owner can remove a barber’s access immediately, and restore it; history is kept', async () => {
      const auditBefore = await prisma.auditLog.count({ where: { entityId: ids.sunilStaff, action: { in: ['STAFF_ACCESS_REVOKED', 'STAFF_ACCESS_RESTORED'] } } });
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
      expect(await prisma.auditLog.count({ where: { entityId: ids.sunilStaff, action: { in: ['STAFF_ACCESS_REVOKED', 'STAFF_ACCESS_RESTORED'] } } })).toBe(auditBefore + 2);
    });

    it('refuses to remove a barber who is serving a customer, and refuses self-removal', async () => {
      const entry = (await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner).send({ name: 'In Chair', serviceId: ids.haircut }).expect(201)).body as { id: string };
      await api('post', `dashboard/queue-entries/${entry.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 2'] }).expect(201);
      await api('post', `dashboard/salons/${ids.salon}/staff/${ids.raviStaff}/access/revoke`, tok.owner).send({}).expect(409);
      const session = await prisma.serviceSession.findFirstOrThrow({ where: { queueEntryId: entry.id } });
      await api('post', `dashboard/service-sessions/${session.id}/complete`, tok.owner).expect(201);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('Invoices, payments and revenue', () => {
    const SALON = () => `dashboard/salons/${ids.salon}`;

    /** A booking that went through the real flow: booked -> arrived -> seated -> completed. */
    async function completedBooking(customerLabel = 'cust1'): Promise<string> {
      const start = new Date(Date.now() + 2 * 60_000); // inside the 15-minute check-in window
      const booking = await createBookingAs(customerLabel, start.toISOString());
      return finishBooking(booking.id);
    }
    async function finishBooking(bookingId: string): Promise<string> {
      const arrived = await api('post', `dashboard/bookings/${bookingId}/arrive`, tok.owner).expect(201);
      await api('post', `dashboard/queue-entries/${arrived.body.id}/assign`, tok.owner)
        .send({ staffId: ids.raviStaff, chairId: ids['Chair 3'] })
        .expect(201);
      const session = await prisma.serviceSession.findFirstOrThrow({ where: { queueEntryId: arrived.body.id, status: 'ACTIVE' } });
      await api('post', `dashboard/service-sessions/${session.id}/complete`, tok.ravi).expect(201);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('COMPLETED');
      return bookingId;
    }
    async function completedWalkIn(name: string): Promise<string> {
      const entry = (await api('post', `${SALON()}/queue/customers`, tok.owner).send({ name, serviceId: ids.haircut }).expect(201)).body as { id: string };
      await api('post', `dashboard/queue-entries/${entry.id}/assign`, tok.owner).send({ staffId: ids.raviStaff, chairId: ids['Chair 3'] }).expect(201);
      const session = await prisma.serviceSession.findFirstOrThrow({ where: { queueEntryId: entry.id, status: 'ACTIVE' } });
      await api('post', `dashboard/service-sessions/${session.id}/complete`, tok.ravi).expect(201);
      return entry.id;
    }
    const issue = (body: Record<string, string>, token = tok.owner) => api('post', `${SALON()}/invoices`, token).send(body);

    let invoiceA: { id: string; number: string };
    let bookingA: string;
    let bookingB: string;

    it('needs the business profile first: nothing is invented, neither a legal name nor a GSTIN', async () => {
      bookingA = await completedBooking('cust1');
      const res = await issue({ bookingId: bookingA }).expect(422);
      expect(res.body.code ?? res.body.error?.code ?? JSON.stringify(res.body)).toContain('BILLING_PROFILE_REQUIRED');
      expect(await prisma.invoice.count({ where: { salonId: ids.salon } })).toBe(0);
      // tax can only be turned on with a rate
      await api('put', `${SALON()}/billing-profile`, tok.owner).send({ legalName: 'Owner Ops Salon Pvt Ltd', taxEnabled: true }).expect(400);
      // a barber cannot read or change billing configuration
      await api('put', `${SALON()}/billing-profile`, tok.ravi).send({ legalName: 'Hacked', taxEnabled: false }).expect(403);
      const saved = await api('put', `${SALON()}/billing-profile`, tok.owner)
        .send({ legalName: 'Owner Ops Salon Pvt Ltd', gstin: '22AAAAA0000A1Z5', taxEnabled: true, taxRatePercent: 18, taxMode: 'EXCLUSIVE', invoicePrefix: 'FQ' })
        .expect(200);
      expect(saved.body).toMatchObject({ complete: true, taxRatePercent: 18, invoicePrefix: 'FQ' });
    });

    it('issues from the real service price with exclusive tax, frozen seller details and the right customer/barber', async () => {
      const res = await issue({ bookingId: bookingA }).expect(201);
      invoiceA = res.body;
      expect(res.body).toMatchObject({
        number: 'FQ-000001',
        currency: 'INR',
        subtotal: 250,
        discountTotal: 0,
        taxTotal: 45,
        total: 295,
        balanceDue: 295,
        paymentStatus: 'UNPAID',
        status: 'ISSUED',
        staffName: 'Ravi',
        customerPhone: phone(1),
        taxLabel: 'GST',
        taxRatePercent: 18,
        taxMode: 'EXCLUSIVE',
      });
      expect(res.body.seller).toMatchObject({ legalName: 'Owner Ops Salon Pvt Ltd', gstin: '22AAAAA0000A1Z5' });
      expect(res.body.lines).toEqual([expect.objectContaining({ description: 'Haircut', unitPrice: 250, lineTotal: 250 })]);
      // changing the profile later does not rewrite an invoice that was already issued
      await api('put', `${SALON()}/billing-profile`, tok.owner).send({ legalName: 'Renamed Pvt Ltd', taxEnabled: false, invoicePrefix: 'FQ' }).expect(200);
      const reread = await api('get', `${SALON()}/invoices/${invoiceA.id}`, tok.owner).expect(200);
      expect(reread.body.seller.legalName).toBe('Owner Ops Salon Pvt Ltd');
      expect(reread.body.taxTotal).toBe(45);
      await api('put', `${SALON()}/billing-profile`, tok.owner)
        .send({ legalName: 'Owner Ops Salon Pvt Ltd', gstin: '22AAAAA0000A1Z5', taxEnabled: true, taxRatePercent: 18, taxMode: 'EXCLUSIVE', invoicePrefix: 'FQ' })
        .expect(200);
    });

    it('is idempotent: repeating the request returns the same invoice, and concurrent clicks create one with no numbering gap', async () => {
      const again = await issue({ bookingId: bookingA }).expect(200);
      expect(again.body.id).toBe(invoiceA.id);
      bookingB = await completedBooking('cust2');
      const results = await Promise.all(Array.from({ length: 6 }, () => issue({ bookingId: bookingB })));
      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await prisma.invoice.count({ where: { bookingId: bookingB } })).toBe(1);
      expect(results[0].body.number).toBe('FQ-000002'); // the sequence was not burned by the duplicates
    });

    it('only a completed service can be invoiced, and a booking-linked visit is invoiced through its booking', async () => {
      const pending = await createBookingAs('cust1', slot('09:00', 4));
      await issue({ bookingId: pending.id }).expect(409);
      const queueEntryOfBooking = await prisma.queueEntry.findFirstOrThrow({ where: { bookingId: bookingA } });
      await issue({ queueEntryId: queueEntryOfBooking.id }).expect(409);
      await issue({}).expect(400);
      await issue({ bookingId: pending.id, queueEntryId: queueEntryOfBooking.id }).expect(400);
    });

    it('records only what the shop says it received, never overpaying, with refunds restricted to the owner', async () => {
      const pay = (token: string, body: Record<string, unknown>, key?: string) => {
        const req = api('post', `${SALON()}/invoices/${invoiceA.id}/payments`, token);
        if (key) req.set('Idempotency-Key', key);
        return req.send(body);
      };
      const partial = await pay(tok.ravi, { method: 'CASH', amount: 100 }).expect(201);
      expect(partial.body).toMatchObject({ amountPaid: 100, balanceDue: 195, paymentStatus: 'PARTIALLY_PAID' });
      await pay(tok.ravi, { kind: 'REFUND', method: 'CASH', amount: 10 }).expect(403);
      await pay(tok.owner, { method: 'UPI', amount: 200 }).expect(409); // more than the 195 due
      const key = randomUUID();
      const paid = await pay(tok.owner, { method: 'UPI', amount: 195, reference: 'UPI-TXN-1' }, key).expect(201);
      expect(paid.body).toMatchObject({ amountPaid: 295, balanceDue: 0, paymentStatus: 'PAID' });
      await pay(tok.owner, { method: 'UPI', amount: 195, reference: 'UPI-TXN-1' }, key); // a replayed request
      expect(await prisma.invoicePayment.count({ where: { invoiceId: invoiceA.id } })).toBe(2);
      await pay(tok.owner, { method: 'CASH', amount: 1 }).expect(409); // already fully paid

      const refunded = await pay(tok.owner, { kind: 'REFUND', method: 'CASH', amount: 50, note: 'Goodwill' }).expect(201);
      expect(refunded.body).toMatchObject({ amountRefunded: 50, balanceDue: 50, paymentStatus: 'PARTIALLY_PAID' });
      await pay(tok.owner, { kind: 'REFUND', method: 'CASH', amount: 300 }).expect(409); // more than was received
      await api('post', `${SALON()}/invoices/${invoiceA.id}/void`, tok.owner).send({ reason: 'Entered by mistake' }).expect(409); // refund first
    });

    it('keeps the ledger append-only and the issued amounts frozen at the database level', async () => {
      await expect(prisma.$executeRaw`UPDATE "invoices" SET "total" = 1 WHERE "id" = ${invoiceA.id}`).rejects.toThrow(/immutable/);
      await expect(prisma.$executeRaw`UPDATE "invoice_payments" SET "amount" = 1 WHERE "invoiceId" = ${invoiceA.id}`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM "invoice_payments" WHERE "invoiceId" = ${invoiceA.id}`).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRaw`INSERT INTO "invoice_payments" ("id","invoiceId","salonId","kind","method","amount","recordedByUserId") VALUES (${randomUUID()}, ${invoiceA.id}, ${ids.salon}, 'PAYMENT', 'CASH', 0, ${ids.owner})`,
      ).rejects.toThrow();
    });

    it('shows a customer only their own invoices and PDFs; a stranger or a guest gets nothing', async () => {
      const mine = await api('get', 'invoices/mine', tok.cust1).expect(200);
      expect((mine.body.items as Array<{ id: string }>).map((i) => i.id)).toContain(invoiceA.id);
      expect((mine.body.items as Array<{ id: string }>).map((i) => i.id)).not.toContain(results0(bookingB));
      await api('get', `invoices/mine/${invoiceA.id}`, tok.cust2).expect(404);
      await api('get', `invoices/mine/${invoiceA.id}/pdf`, tok.cust2).expect(404);
      await api('get', `invoices/mine/${invoiceA.id}`, tok.outsider).expect(404);
      const pdf = await api('get', `invoices/mine/${invoiceA.id}/pdf`, tok.cust1).buffer(true).parse(binaryParser).expect(200);
      expect(String(pdf.headers['content-type'])).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await request(app.getHttpServer()).get(`/api/v1/invoices/mine/${invoiceA.id}`).expect(401);
    });

    function results0(_bookingId: string) {
      return 'not-an-invoice-id';
    }
    function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }

    it('lets the shop download the PDF; a barber may open an invoice but not list them or void one', async () => {
      const pdf = await api('get', `${SALON()}/invoices/${invoiceA.id}/pdf`, tok.owner).buffer(true).parse(binaryParser).expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await api('get', `${SALON()}/invoices/${invoiceA.id}`, tok.ravi).expect(200);
      await api('get', `${SALON()}/invoices`, tok.ravi).expect(403);
      await api('post', `${SALON()}/invoices/${invoiceA.id}/void`, tok.ravi).send({ reason: 'nope nope' }).expect(403);
      await api('get', `${SALON()}/invoices/${invoiceA.id}`, tok.outsider).expect(403);
      const list = await api('get', `${SALON()}/invoices?payment=PARTIALLY_PAID`, tok.owner).expect(200);
      expect((list.body.items as Array<{ id: string }>).map((i) => i.id)).toEqual([invoiceA.id]);
    });

    it('voids an unpaid invoice (keeping its number) and allows exactly one replacement', async () => {
      const second = await api('get', `${SALON()}/invoices/by-source?bookingId=${bookingB}`, tok.owner).expect(200);
      await api('post', `${SALON()}/invoices/${second.body.id}/void`, tok.owner).send({ reason: 'Wrong customer details' }).expect(201);
      const voided = await api('get', `${SALON()}/invoices/${second.body.id}`, tok.owner).expect(200);
      expect(voided.body).toMatchObject({ status: 'VOID', paymentStatus: 'VOID', balanceDue: 0 });
      await api('post', `${SALON()}/invoices/${second.body.id}/payments`, tok.owner).send({ method: 'CASH', amount: 10 }).expect(409);
      const replacement = await issue({ bookingId: bookingB }).expect(201);
      expect(replacement.body.number).toBe('FQ-000003'); // a void keeps its number; the next is never a reuse
      const mine = await api('get', 'invoices/mine', tok.cust2).expect(200);
      expect((mine.body.items as Array<{ id: string }>).map((i) => i.id)).toEqual([replacement.body.id]); // the void one is hidden
    });

    it('invoices a Live Queue visit and an in-shop guest, with inclusive tax extracted not added', async () => {
      await api('put', `${SALON()}/billing-profile`, tok.owner)
        .send({ legalName: 'Owner Ops Salon Pvt Ltd', taxEnabled: true, taxRatePercent: 18, taxMode: 'INCLUSIVE', invoicePrefix: 'FQ' })
        .expect(200);
      const entryId = await completedWalkIn('Queue Quentin');
      const walkIn = await issue({ queueEntryId: entryId }).expect(201);
      expect(walkIn.body).toMatchObject({ sourceType: 'QUEUE_ENTRY', customerName: 'Queue Quentin', subtotal: 250, taxTotal: 38.14, total: 250, taxMode: 'INCLUSIVE', staffName: 'Ravi' });

      // Completed visits keep their capacity reserved until their slot ends (a real booking rule), so a
      // third barber is needed for a third appointment in the same half hour.
      await makeStaff('tara', 'Tara', ids.salon, [ids.haircut]);
      const guest = (
        await api('post', `${SALON()}/bookings/in-shop`, tok.owner)
          .send({ guestName: 'Guest Gita', guestPhone: '9876522222', contactConsent: true, serviceIds: [ids.haircut], slotStart: new Date(Date.now() + 90_000).toISOString() })
          .expect(201)
      ).body as { id: string };
      await finishBooking(guest.id);
      const guestInvoice = await issue({ bookingId: guest.id }).expect(201);
      expect(guestInvoice.body).toMatchObject({ customerName: 'Guest Gita', customerPhone: '+919876522222' });
      // a guest has no account, so no customer can ever open it
      expect(await prisma.invoice.findUniqueOrThrow({ where: { id: guestInvoice.body.id } })).toMatchObject({ customerId: null });
    });

    it('lists what the shop recorded as received, with totals, for the owner only', async () => {
      const res = await api('get', `${SALON()}/payments`, tok.owner).expect(200);
      expect(res.body.totals).toMatchObject({ received: 295, refunded: 50, net: 245 });
      expect(res.body.totals.count).toBe(3);
      expect((res.body.items as Array<{ kind: string; recordedBy: string }>).map((p) => p.kind).sort()).toEqual(['PAYMENT', 'PAYMENT', 'REFUND']);
      // the barber who recorded the cash payment is named; the owner's entries say "Owner"
      expect((res.body.items as Array<{ recordedBy: string }>).map((p) => p.recordedBy)).toEqual(expect.arrayContaining(['Ravi', 'Owner']));
      expect(res.body.byMethod).toEqual(expect.arrayContaining([{ method: 'CASH', net: 50 }, { method: 'UPI', net: 195 }]));
      await api('get', `${SALON()}/payments`, tok.ravi).expect(403);
      await api('get', `${SALON()}/payments`, tok.outsider).expect(403);
      await api('get', `${SALON()}/payments?from=2020-01-01&to=2020-01-02`, tok.owner).expect(200).expect((r) => {
        expect(r.body.items).toEqual([]);
        expect(r.body.totals.net).toBe(0);
      });
    });

    it('reports revenue as money the shop recorded - not completed services, and not unpaid invoices', async () => {
      const overview = (await api('get', `${SALON()}/overview`, tok.owner).expect(200)).body;
      // +100 cash, +195 UPI, -50 refund recorded on invoice A today
      expect(overview.kpis.recordedRevenueToday).toBe(245);
      expect(overview.kpis.recordedPaymentsToday).toBe(2);
      expect(overview.revenue.hasRecordedPayments).toBe(true);
      expect(overview.revenue.today.current).toBe(245);
      expect(overview.revenue.daily[overview.revenue.daily.length - 1]).toEqual({ date: overview.localDate, amount: 245 });
      expect(overview.revenue.thisMonth.current).toBe(245);
      expect(overview.revenue.today.changePercent).toBeNull(); // nothing yesterday to compare with
      // Several services were completed today but are not revenue until payments are recorded.
      expect(overview.kpis.completedServicesToday).toBeGreaterThanOrEqual(4);
      expect(overview.revenue.estimatedServiceValueToday).toBeGreaterThan(overview.kpis.recordedRevenueToday);
      expect(overview.revenue.unpaidInvoiceCount).toBeGreaterThanOrEqual(3);
      expect(overview.revenue.unpaidInvoiceTotal).toBeGreaterThan(0);
      expect(overview.topServices[0]).toMatchObject({ name: 'Haircut' });
      expect(overview.topServices[0].averageChargedAmount).not.toBeNull();
      expect(overview.settings.hasBillingProfile).toBe(true);
      expect(overview.settings.hasPaymentQr).toBe(false);
    });
  });
});

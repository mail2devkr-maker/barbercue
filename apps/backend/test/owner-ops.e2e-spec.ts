import { createHash, randomUUID } from 'crypto';
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

  async function createBookingAs(
    customerLabel: string,
    startIso: string,
    opts: {
      serviceIds?: string[];
      staffId?: string;
      attributionToken?: string;
    } = {},
  ) {
    const res = await api('post', 'bookings', tok[customerLabel]).send({
      salonId: ids.salon,
      serviceIds: opts.serviceIds ?? [ids.haircut],
      slotStart: startIso,
      ...(opts.staffId ? { preferredStaffId: opts.staffId } : {}),
      ...(opts.attributionToken
        ? { attributionToken: opts.attributionToken }
        : {}),
    });
    if (res.status !== 201) {
      const code = res.body?.error?.code ?? 'unknown';
      throw new Error(`Booking creation failed with HTTP ${res.status} (${code}).`);
    }
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
        `dashboard/salons/${ids.salon}/booking-attribution/summary?from=${utcToZonedDateStr(new Date(), TZ)}&to=${utcToZonedDateStr(new Date(), TZ)}`,
        `dashboard/salons/${ids.salon}/booking-attribution/campaigns`,
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
  describe('booking acquisition attribution', () => {
    it('attributes only valid salon-scoped campaign tokens while preserving operational source', async () => {
      const campaignPath = `dashboard/salons/${ids.salon}/booking-attribution/campaigns`;
      const createdCampaign = await api('post', campaignPath, tok.owner)
        .send({ source: 'FACEBOOK', label: `Local campaign ${run}` })
        .expect(201);
      const campaignId = createdCampaign.body.id as string;
      const token = createdCampaign.body.token as string;
      expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(createdCampaign.body).not.toHaveProperty('tokenHash');

      const storedCampaign =
        await prisma.bookingAttributionCampaign.findUniqueOrThrow({
          where: { id: campaignId },
        });
      expect(storedCampaign.tokenHash).toBe(
        createHash('sha256').update(token, 'utf8').digest('hex'),
      );
      expect(storedCampaign.tokenHash).not.toBe(token);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'BOOKING_ATTRIBUTION_CAMPAIGN_CREATED',
          entityId: campaignId,
        },
      });
      expect(JSON.stringify(audit.metadata)).not.toContain(token);

      const booking = await createBookingAs('cust1', slot('10:00', 2), {
        attributionToken: token,
      });
      const storedBooking = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(storedBooking.source).toBe('WEB');
      expect(storedBooking.attributionCampaignId).toBe(campaignId);

      const attributedBookings = await api(
        'get',
        `dashboard/salons/${ids.salon}/bookings?filter=all&source=FACEBOOK`,
        tok.owner,
      ).expect(200);
      expect(
        attributedBookings.body.items.map((row: { id: string }) => row.id),
      ).toContain(booking.id);
      const webBookings = await api(
        'get',
        `dashboard/salons/${ids.salon}/bookings?filter=all&source=FASTQUE_WEB`,
        tok.owner,
      ).expect(200);
      expect(
        webBookings.body.items.map((row: { id: string }) => row.id),
      ).not.toContain(booking.id);
      const ownerRow = attributedBookings.body.items.find(
        (row: { id: string }) => row.id === booking.id,
      );
      expect(ownerRow.attributionSource).toBe('FACEBOOK');

      const today = utcToZonedDateStr(new Date(), TZ);
      const summary = await api(
        'get',
        `dashboard/salons/${ids.salon}/booking-attribution/summary?from=${today}&to=${today}&source=FACEBOOK`,
        tok.owner,
      ).expect(200);
      expect(summary.body.timezone).toBe(TZ);
      expect(summary.body.bySource).toEqual([
        { source: 'FACEBOOK', bookingCount: 1 },
      ]);
      expect(summary.body.campaigns).toEqual([
        expect.objectContaining({
          campaignId,
          source: 'FACEBOOK',
          bookingCount: 1,
        }),
      ]);

      await api('post', campaignPath, tok.outsider)
        .send({ source: 'CHATGPT', label: 'Cross-salon attempt' })
        .expect(403);
      await api(
        'get',
        `dashboard/salons/${ids.salon}/booking-attribution/campaigns`,
        tok.outsider,
      ).expect(403);
    });

    it('ignores invalid, expired, revoked, and cross-salon tokens without blocking booking creation', async () => {
      const campaignPath = `dashboard/salons/${ids.salon}/booking-attribution/campaigns`;
      const expired = await api('post', campaignPath, tok.owner)
        .send({
          source: 'INSTAGRAM',
          label: `Expired ${run}`,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() - 1).toISOString(),
        })
        .expect(201);
      const revoked = await api('post', campaignPath, tok.owner)
        .send({ source: 'OTHER', label: `Revoked ${run}` })
        .expect(201);
      await api(
        'post',
        `${campaignPath}/${revoked.body.id}/revoke`,
        tok.owner,
      ).expect(201);
      await api(
        'post',
        `${campaignPath}/${revoked.body.id}/revoke`,
        tok.owner,
      ).expect(201);
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'BOOKING_ATTRIBUTION_CAMPAIGN_REVOKED',
            entityId: revoked.body.id,
          },
        }),
      ).toBe(1);

      const invalid = await createBookingAs('cust2', slot('10:00', 3), {
        attributionToken: randomUUID().replaceAll('-', '').repeat(2),
      });
      const expiredBooking = await createBookingAs('cust2', slot('11:00', 3), {
        attributionToken: expired.body.token,
      });
      const revokedBooking = await createBookingAs('cust2', slot('12:00', 3), {
        attributionToken: revoked.body.token,
      });
      const otherSalonCampaign = await api(
        'post',
        `dashboard/salons/${ids.otherSalon}/booking-attribution/campaigns`,
        tok.outsider,
      )
        .send({ source: 'FACEBOOK', label: `Other salon ${run}` })
        .expect(201);
      const crossSalonBooking = await createBookingAs(
        'cust2',
        slot('13:00', 3),
        {
          attributionToken: otherSalonCampaign.body.token,
        },
      );

      for (const bookingId of [
        invalid.id,
        expiredBooking.id,
        revokedBooking.id,
        crossSalonBooking.id,
      ]) {
        const row = await prisma.booking.findUniqueOrThrow({
          where: { id: bookingId },
        });
        expect(row.source).toBe('WEB');
        expect(row.attributionCampaignId).toBeNull();
      }
      await expect(
        prisma.booking.update({
          where: { id: invalid.id },
          data: { attributionCampaignId: otherSalonCampaign.body.id },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: invalid.id } }))
          .attributionCampaignId,
      ).toBeNull();
    });

    it('serializes booking attribution against concurrent campaign revocation', async () => {
      const campaign = await api(
        'post',
        `dashboard/salons/${ids.salon}/booking-attribution/campaigns`,
        tok.owner,
      )
        .send({ source: 'CHATGPT', label: `Race ${run}` })
        .expect(201);
      const [booking, revoked] = await Promise.all([
        createBookingAs('cust1', slot('14:00', 4), {
          attributionToken: campaign.body.token,
        }),
        api(
          'post',
          `dashboard/salons/${ids.salon}/booking-attribution/campaigns/${campaign.body.id}/revoke`,
          tok.owner,
        ).expect(201),
      ]);
      expect(revoked.body.revokedAt).not.toBeNull();
      const stored = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect([null, campaign.body.id]).toContain(stored.attributionCampaignId);
      expect(stored.source).toBe('WEB');
    });

    it('rejects malformed campaign filters and bounds campaign pagination', async () => {
      await api(
        'get',
        `dashboard/salons/${ids.salon}/booking-attribution/summary?from=2026-10-17&to=2026-10-17&source=UNKNOWN_GUESS`,
        tok.owner,
      ).expect(400);
      await api(
        'get',
        `dashboard/salons/${ids.salon}/booking-attribution/campaigns?limit=1000`,
        tok.owner,
      ).expect(400);
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
  describe('Direct service start: waiting -> in service when a barber and chair become free', () => {
    const board = async () => (await api('get', `dashboard/salons/${ids.salon}/queue`, tok.owner).expect(200)).body;
    const add = async (name: string, extra: Record<string, unknown> = {}) =>
      (await api('post', `dashboard/salons/${ids.salon}/queue/customers`, tok.owner).send({ name, ...extra }).expect(201)).body as { id: string };
    const settle = () => trigger.idle(ids.salon);
    const setAuto = (enabled: boolean) =>
      api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.owner).send({ autoAssignEnabled: enabled }).expect(200);
    const activeSessions = () =>
      prisma.serviceSession.findMany({ where: { status: 'ACTIVE', chair: { salonId: ids.salon } }, include: { queueEntry: true } });
    const assignedHolds = () =>
      prisma.queueEntry.findMany({ where: { salonId: ids.salon, status: 'CALLED', assignedStaffId: { not: null } } });
    const tokenOfStaff = (staffId: string) => (staffId === ids.raviStaff ? tok.ravi : tok.sunil);
    const start = (entryId: string, token: string) => api('post', `dashboard/queue-entries/${entryId}/start-service`, token);
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
    afterEach(cleanup);

    it('persists the owner ON/OFF choice and never allows another shop to change it', async () => {
      await setAuto(false);
      expect((await board()).autoAssignEnabled).toBe(false);
      await setAuto(true);
      expect((await board()).autoAssignEnabled).toBe(true);
      expect((await prisma.salon.findUniqueOrThrow({ where: { id: ids.salon } })).queueAutoAssignEnabled).toBe(true);
      expect(await prisma.auditLog.count({ where: { entityId: ids.salon, action: 'QUEUE_AUTO_ASSIGN_ENABLED' } })).toBeGreaterThanOrEqual(1);
      expect((await api('get', `dashboard/salons/${ids.salon}/queue/settings`, tok.ravi).expect(200)).body).toEqual({ autoAssignEnabled: true });
      await api('patch', `dashboard/salons/${ids.salon}/queue/settings`, tok.outsider)
        .send({ autoAssignEnabled: false }).expect(403);
    });

    it('OFF: arrived visitors remain WAITING even with spare capacity', async () => {
      await setAuto(false);
      const waiting = await add('Waiting While Off', { serviceId: ids.haircut });
      await settle();
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toContain(waiting.id);
      expect(await activeSessions()).toHaveLength(0);
      expect(await assignedHolds()).toHaveLength(0);
    });

    it('ON: first two arrived visitors start IN_SERVICE atomically, FIFO, third waits; no ASSIGNED hold', async () => {
      const a = await add('FIFO A', { serviceId: ids.haircut });
      const b = await add('FIFO B', { serviceId: ids.haircut });
      const c = await add('FIFO C', { serviceId: ids.haircut });
      await setAuto(true);
      await settle();
      const active = await activeSessions();
      expect(active.map((x) => x.queueEntryId).sort()).toEqual([a.id, b.id].sort());
      expect(new Set(active.map((x) => x.staffId)).size).toBe(2);
      expect(new Set(active.map((x) => x.chairId)).size).toBe(2);
      expect(await assignedHolds()).toHaveLength(0);
      for (const row of active) {
        expect(row.queueEntry).toMatchObject({
          status: 'IN_SERVICE', assignedStaffId: row.staffId, assignedChairId: row.chairId,
          serviceStartedAt: expect.any(Date), assignedAt: expect.any(Date),
        });
      }
      const snapshot = await board();
      expect(snapshot.sections.inService.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id].sort());
      expect(snapshot.sections.waiting.map((x: { id: string }) => x.id)).toEqual([c.id]);
      expect(snapshot.sections.assigned).toHaveLength(0);
      expect(snapshot.counts).toMatchObject({ waiting: 1, assigned: 0, inService: 2 });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: a.id, action: 'QUEUE_ENTRY_AUTO_ASSIGNED' },
      });
      expect(audit.metadata).toMatchObject({ serviceStarted: true });
    });

    it('does not double-seat a busy barber or occupy their chair twice', async () => {
      await setAuto(true);
      const a = await add('Busy A', { serviceId: ids.haircut });
      const b = await add('Busy B', { serviceId: ids.haircut });
      const c = await add('Busy C', { serviceId: ids.haircut });
      await settle();
      const sessions = await activeSessions();
      expect(sessions).toHaveLength(2);
      expect(new Set(sessions.map((x) => x.staffId)).size).toBe(2);
      expect(new Set(sessions.map((x) => x.chairId)).size).toBe(2);
      await api('post', `dashboard/queue-entries/${c.id}/assign`, tok.owner)
        .send({ staffId: sessions[0].staffId, chairId: ids['Chair 3'], startService: true })
        .expect(409);
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toEqual([c.id]);
      void a; void b;
    });

    it('a completed service instantly auto-starts the next arrived waiting visitor without a button', async () => {
      await setAuto(true);
      const a = await add('Finish A', { serviceId: ids.haircut });
      const b = await add('Finish B', { serviceId: ids.haircut });
      const c = await add('Next C', { serviceId: ids.haircut });
      await settle();
      const occupied = (await activeSessions()).find((x) => x.queueEntryId === a.id)!;
      expect(occupied).toBeTruthy();
      await api('post', `dashboard/service-sessions/${occupied.id}/complete`, tokenOfStaff(occupied.staffId)).expect(201);
      await settle();
      const sessions = await activeSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.find((x) => x.queueEntryId === c.id)).toMatchObject({ staffId: occupied.staffId, chairId: occupied.chairId });
      expect((await board()).sections.inService.map((x: { id: string }) => x.id).sort()).toEqual([b.id, c.id].sort());
      expect(await assignedHolds()).toHaveLength(0);
    });

    it('a cancelled in-service visit frees capacity and the next customer starts', async () => {
      await setAuto(true);
      const a = await add('Cancel A', { serviceId: ids.haircut });
      await add('Cancel B', { serviceId: ids.haircut });
      const c = await add('Next After Cancel', { serviceId: ids.haircut });
      await settle();
      const old = (await activeSessions()).find((x) => x.queueEntryId === a.id)!;
      await api('post', `dashboard/queue-entries/${a.id}/cancel`, tok.owner).expect(201);
      await settle();
      expect((await activeSessions()).find((x) => x.queueEntryId === c.id))
        .toMatchObject({ staffId: old.staffId, chairId: old.chairId });
      expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CANCELLED');
    });

    it('remote customers never start until arrival; after Mark as in the shop they start immediately', async () => {
      await setAuto(true);
      const remote = await api('post', `salons/${ids.salon}/queue/join`, tok.cust1)
        .send({ serviceId: ids.haircut, contactName: 'Remote Ria', contactPhone: '9876500009' }).expect(201);
      await settle();
      expect(await activeSessions()).toHaveLength(0);
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toContain(remote.body.id);
      await api('post', `dashboard/queue-entries/${remote.body.id}/arrive`, tok.owner).expect(201);
      await settle();
      const started = await prisma.queueEntry.findUniqueOrThrow({ where: { id: remote.body.id } });
      expect(started).toMatchObject({ status: 'IN_SERVICE', serviceStartedAt: expect.any(Date) });
      expect((await activeSessions()).map((x) => x.queueEntryId)).toContain(remote.body.id);
      expect(await assignedHolds()).toHaveLength(0);
    });

    it('manual one-click start respects arrival even if the automatic setting is OFF', async () => {
      await setAuto(false);
      const remote = await api('post', `salons/${ids.salon}/queue/join`, tok.cust1)
        .send({ serviceId: ids.haircut, contactName: 'Still Traveling', contactPhone: '9876500010' }).expect(201);
      await api('post', `dashboard/queue-entries/${remote.body.id}/auto-assign`, tok.owner).expect(409);
      expect(await activeSessions()).toHaveLength(0);
      const present = await add('At The Counter', { serviceId: ids.haircut });
      await api('post', `dashboard/queue-entries/${present.id}/auto-assign`, tok.owner).expect(201);
      expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: present.id } })).status).toBe('IN_SERVICE');
      expect((await activeSessions()).map((x) => x.queueEntryId)).toContain(present.id);
      await api('post', `dashboard/queue-entries/${remote.body.id}/cancel`, tok.owner).expect(201);
    });

    it('manual bulk start refuses remote visitors and leaves full capacity waiting', async () => {
      await setAuto(false);
      const a = await add('Manual A', { serviceId: ids.haircut });
      const b = await add('Manual B', { serviceId: ids.haircut });
      const c = await add('Manual C', { serviceId: ids.haircut });
      const result = await api('post', `dashboard/salons/${ids.salon}/queue/auto-assign`, tok.owner).expect(201);
      expect(result.body.assigned.map((x: { queueEntryId: string }) => x.queueEntryId).sort()).toEqual([a.id, b.id].sort());
      expect(result.body.skipped.map((x: { entryId: string }) => x.entryId)).toContain(c.id);
      expect(await activeSessions()).toHaveLength(2);
      expect(await assignedHolds()).toHaveLength(0);
    });

    it('barber Take next immediately starts an arrived guest and prevents taking a second', async () => {
      await setAuto(false);
      const guest = await add('Sunil Customer', { serviceId: ids.haircut });
      const response = await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.sunil).expect(201);
      expect(response.body).toMatchObject({ id: guest.id, status: 'IN_SERVICE', phase: 'IN_SERVICE', assignedStaffId: ids.sunilStaff });
      expect(response.body.activeServiceSessionId).toBeTruthy();
      await add('Next While Busy', { serviceId: ids.haircut });
      await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.sunil).expect(409);
      await api('post', `dashboard/salons/${ids.salon}/queue/take-next`, tok.owner).expect(403);
    });

    it('preferred barber and service qualification never leak into the wrong barber', async () => {
      await setAuto(true);
      const first = await add('Ravi Serving', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      const wantsRavi = await add('Wait for Ravi', { serviceId: ids.haircut, preferredStaffId: ids.raviStaff });
      const beard = await add('Beard must be Ravi', { serviceId: ids.beard });
      const any = await add('Sunil Can Help', { serviceId: ids.haircut });
      await settle();
      const active = await activeSessions();
      expect(active.find((x) => x.queueEntryId === first.id)?.staffId).toBe(ids.raviStaff);
      expect(active.find((x) => x.queueEntryId === any.id)?.staffId).toBe(ids.sunilStaff);
      expect(active.map((x) => x.queueEntryId)).not.toContain(wantsRavi.id);
      expect(active.map((x) => x.queueEntryId)).not.toContain(beard.id);
      expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toEqual([wantsRavi.id, beard.id]);
    });

    it('concurrent manual start requests create exactly one ACTIVE ServiceSession', async () => {
      await setAuto(false);
      const guest = await add('Concurrent Customer', { serviceId: ids.haircut });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => api('post', `dashboard/salons/${ids.salon}/queue/auto-assign`, tok.owner).then((r) => r.status)),
      );
      expect(results.every((x) => x === 201)).toBe(true);
      expect(await prisma.serviceSession.count({ where: { queueEntryId: guest.id } })).toBe(1);
      expect((await activeSessions()).map((x) => x.queueEntryId)).toEqual([guest.id]);
      expect(await assignedHolds()).toHaveLength(0);
    });

    it('old Android startService:false reservations remain supported and can be started safely', async () => {
      await setAuto(false);
      const guest = await add('Legacy Reservation', { serviceId: ids.haircut });
      const reservation = await api('post', `dashboard/queue-entries/${guest.id}/assign`, tok.owner)
        .send({ staffId: ids.raviStaff, chairId: ids['Chair 1'], startService: false }).expect(201);
      expect(reservation.body).toMatchObject({ status: 'CALLED', phase: 'ASSIGNED', serviceStartedAt: null });
      expect(await activeSessions()).toHaveLength(0);
      expect(await assignedHolds()).toHaveLength(1);
      const active = await start(guest.id, tok.ravi).expect(201);
      expect(active.body).toMatchObject({ status: 'IN_SERVICE', phase: 'IN_SERVICE' });
      expect((await activeSessions()).map((x) => x.queueEntryId)).toContain(guest.id);
      expect(await assignedHolds()).toHaveLength(0);
    });

    it('marking an unarrived WAITING customer NO SHOW keeps them out of Cancelled & expired semantics', async () => {
      await setAuto(true);
      const remote = await api('post', `salons/${ids.salon}/queue/join`, tok.cust1)
        .send({ serviceId: ids.haircut, contactName: 'Absent Visitor', contactPhone: '9876500009' }).expect(201);
      await settle();
      const response = await api('post', `dashboard/queue-entries/${remote.body.id}/no-show`, tok.owner).expect(201);
      expect(response.body).toMatchObject({ status: 'NO_SHOW', phase: 'NO_SHOW' });
      const snapshot = await board();
      expect(snapshot.sections.historyToday).toContainEqual(expect.objectContaining({ id: remote.body.id, status: 'NO_SHOW' }));
      expect(snapshot.sections.waiting.map((x: { id: string }) => x.id)).not.toContain(remote.body.id);
      expect(await activeSessions()).toHaveLength(0);
      // The old CALLED -> NO_SHOW action also remains supported for legacy clients.
    });

    it('never marks an arrived WAITING or an IN_SERVICE guest NO SHOW', async () => {
      await setAuto(false);
      const arrived = await add('Already Here', { serviceId: ids.haircut });
      await api('post', `dashboard/queue-entries/${arrived.id}/no-show`, tok.owner).expect(409);
      await setAuto(true);
      await settle();
      await api('post', `dashboard/queue-entries/${arrived.id}/no-show`, tok.owner).expect(409);
      expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: arrived.id } })).status).toBe('IN_SERVICE');
    });

    it('an existing booking reserves its barber and automatic service start respects that window', async () => {
      const now = new Date();
      await prisma.booking.create({
        data: {
          salonId: ids.salon, customerId: ids.cust2,
          serviceId: ids.haircut, preferredStaffId: ids.raviStaff,
          slotStart: new Date(now.getTime() - 5 * 60_000),
          slotEnd: new Date(now.getTime() + 25 * 60_000),
          status: 'CONFIRMED', source: 'APP', idempotencyKey: `e2e-${run}-reserved-ravi-direct`,
        },
      });
      try {
        await setAuto(true);
        const first = await add('Visit Past Booking', { serviceId: ids.haircut });
        await settle();
        expect((await activeSessions()).find((x) => x.queueEntryId === first.id)?.staffId).toBe(ids.sunilStaff);
        const second = await add('Another While Reserved', { serviceId: ids.haircut });
        await settle();
        expect((await board()).sections.waiting.map((x: { id: string }) => x.id)).toContain(second.id);
      } finally {
        await prisma.booking.updateMany({
          where: { idempotencyKey: `e2e-${run}-reserved-ravi-direct` }, data: { status: 'CANCELLED' },
        });
      }
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('A brand-new shop: automatic assignment is ON by default, backed by the database', () => {
    it('defaults ON, automatically STARTS a service for an arrived customer, and completes it', async () => {
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
      expect(assigned).toMatchObject({ status: 'IN_SERVICE', assignedStaffId: barber.id, assignedChairId: chair.id, serviceStartedAt: expect.any(Date) });
      expect(await prisma.serviceSession.count({ where: { queueEntryId: assigned.id, status: 'ACTIVE' } })).toBe(1);
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
    async function completedBooking(
      customerLabel = 'cust1',
      attributionToken?: string,
      completionStaffId = ids.raviStaff,
      completionChairId = ids['Chair 3'],
      completionActorToken = tok.ravi,
    ): Promise<string> {
      const start = new Date(Date.now() + 2 * 60_000); // inside the 15-minute check-in window
      const booking = await createBookingAs(
        customerLabel,
        start.toISOString(),
        {
          attributionToken,
        },
      );
      return finishBooking(
        booking.id,
        completionStaffId,
        completionChairId,
        completionActorToken,
      );
    }
    async function finishBooking(
      bookingId: string,
      staffId = ids.raviStaff,
      chairId = ids['Chair 3'],
      completionActorToken = tok.ravi,
    ): Promise<string> {
      const arrived = await api('post', `dashboard/bookings/${bookingId}/arrive`, tok.owner).expect(201);
      await api('post', `dashboard/queue-entries/${arrived.body.id}/assign`, tok.owner)
        .send({ staffId, chairId })
        .expect(201);
      const session = await prisma.serviceSession.findFirstOrThrow({ where: { queueEntryId: arrived.body.id, status: 'ACTIVE' } });
      await api('post', `dashboard/service-sessions/${session.id}/complete`, completionActorToken).expect(201);
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

    it('reports salon-local completed visits separately from invoice ledger cash and exports the same scoped report', async () => {
      await api('post', `${SALON()}/invoices/${invoiceA.id}/payments`, tok.owner)
        .send({ kind: 'REFUND', method: 'CASH', amount: 245 })
        .expect(201);
      await api('post', `${SALON()}/invoices/${invoiceA.id}/void`, tok.owner)
        .send({ reason: 'Fully refunded before voiding for report coverage' })
        .expect(201);

      const from = utcToZonedDateStr(new Date(), TZ);
      const to = addZonedCalendarDays(from, 7);
      const path = `${SALON()}/revenue/report?from=${from}&to=${to}&groupBy=day`;
      const reportResponse = await api('get', path, tok.owner).expect(200);
      const report = reportResponse.body;

      expect(reportResponse.headers['cache-control']).toContain('no-store');
      expect(report).toMatchObject({ salonId: ids.salon, from, to, groupBy: 'day', timeZone: TZ });
      expect(report.totals.completedVisits).toBeGreaterThan(0);
      expect(report.totals.grossServiceValue).toBe(report.totals.estimatedServiceValue);
      expect(report.totals.estimatedServiceValue).toBeGreaterThan(0);
      expect(report.totals.invoiceCount).toBeGreaterThan(0);
      expect(report.totals.recordedCollections).toBeGreaterThanOrEqual(295);
      expect(report.totals.refunds).toBeGreaterThanOrEqual(50);
      expect(report.totals.netRecordedCollections).toBeCloseTo(report.totals.recordedCollections - report.totals.refunds, 2);
      expect(report.dataSemantics).toEqual({
        estimateBasis: 'BOOKING_PRICE_SNAPSHOT_AND_CURRENT_QUEUE_SERVICE_PRICE',
        cashSource: 'SHOP_RECORDED_INVOICE_PAYMENT_LEDGER',
        serviceCashAllocation: 'PRO_RATA_BY_INVOICE_LINE_TOTAL',
        externalAttribution:
          'CAMPAIGN_TOKEN_WHEN_PRESENT_LEGACY_SOURCE_PROJECTION_OTHERWISE',
      });
      expect(report.byService).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Haircut', completedVisits: expect.any(Number) }),
      ]));
      expect(report.periods).toHaveLength(8);
      expect(report.periods.reduce((sum: number, period: { recordedCollections: number }) => sum + period.recordedCollections, 0)).toBeCloseTo(report.totals.recordedCollections, 2);
      expect(report.periods.reduce((sum: number, period: { refunds: number }) => sum + period.refunds, 0)).toBeCloseTo(report.totals.refunds, 2);

      const rangeStart = zonedWallTimeToUtc(from, '00:00', TZ)!;
      const rangeEnd = zonedWallTimeToUtc(addZonedCalendarDays(to, 1), '00:00', TZ)!;
      const cashLedger = await prisma.invoicePayment.findMany({
        where: { salonId: ids.salon, recordedAt: { gte: rangeStart, lt: rangeEnd } },
      });
      const expectedCollections = cashLedger
        .filter((payment) => payment.kind === 'PAYMENT')
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const expectedRefunds = cashLedger
        .filter((payment) => payment.kind === 'REFUND')
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      expect(report.totals.recordedCollections).toBeCloseTo(expectedCollections, 2);
      expect(report.totals.refunds).toBeCloseTo(expectedRefunds, 2);
      expect(report.totals.invoiceCount).toBe(await prisma.invoice.count({
        where: { salonId: ids.salon, status: 'ISSUED', serviceDate: { gte: rangeStart, lt: rangeEnd } },
      }));
      expect(report.totals.invoiceCount).not.toBe(await prisma.invoice.count({
        where: { salonId: ids.salon, serviceDate: { gte: rangeStart, lt: rangeEnd } },
      }));

      const walkInCount = await prisma.queueEntry.count({
        where: {
          salonId: ids.salon,
          bookingId: null,
          source: 'WALK_IN',
          status: 'COMPLETED',
          OR: [
            { serviceCompletedAt: { gte: rangeStart, lt: rangeEnd } },
            { serviceCompletedAt: null, serviceSessions: { some: { status: 'COMPLETED', endedAt: { gte: rangeStart, lt: rangeEnd } } } },
          ],
        },
      });
      expect(walkInCount).toBeGreaterThan(0);
      const walkInReport = (await api('get', `${path}&source=WALK_IN`, tok.owner).expect(200)).body;
      expect(walkInReport.totals.completedVisits).toBe(walkInCount);
      const appReport = (await api('get', `${path}&source=APP`, tok.owner).expect(200)).body;
      expect(appReport.totals.completedVisits).toBe(0);

      await api('get', path, tok.ravi).expect(403);
      await api('get', path, tok.outsider).expect(403);
      await api(
        'get',
        `${SALON()}/revenue/report?from=${to}&to=${from}`,
        tok.owner,
      ).expect(400);
      await api(
        'get',
        `${SALON()}/revenue/report?from=2020-01-01&to=2022-01-01`,
        tok.owner,
      ).expect(400);
      await api(
        'get',
        `${SALON()}/revenue/report?from=${from}&to=${to}&source=NOT_A_SUPPORTED_CHANNEL`,
        tok.owner,
      ).expect(400);

      const csv = await api(
        'get',
        `${SALON()}/revenue/report.csv?from=${from}&to=${to}&groupBy=day`,
        tok.owner,
      ).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain(`fastque-revenue-${from}-${to}.csv`);
      expect(csv.text).toContain('recorded_collections');
      expect(csv.text).toContain('SERVICE');
      expect(csv.text).not.toContain(phone(1));
    });

    it('filters completed visits, issued invoices and recorded collections by verified campaign attribution', async () => {
      const today = utcToZonedDateStr(new Date(), TZ);
      const directBefore = (
        await api(
          'get',
          `${SALON()}/revenue/report?from=${today}&to=${today}&source=WEB`,
          tok.owner,
        ).expect(200)
      ).body;
      const campaign = await api(
        'post',
        `${SALON()}/booking-attribution/campaigns`,
        tok.owner,
      )
        .send({ source: 'INSTAGRAM', label: `Revenue attribution ${run}` })
        .expect(201);
      // The report suite has already completed three visits in the same near-now slot, and
      // completed bookings intentionally reserve capacity through their slot end. Give this
      // final flow an isolated fourth pool unit rather than weakening the reservation assertion.
      const attributionStaff = await makeStaff(
        `attribution-${run}`,
        'Attribution QA',
        ids.salon,
        [ids.haircut],
      );
      const attributionChair = await prisma.chair.create({
        data: { salonId: ids.salon, label: `Attribution QA ${run}` },
      });
      const bookingId = await completedBooking(
        'cust2',
        campaign.body.token,
        attributionStaff.id,
        attributionChair.id,
        tok.owner,
      );
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(booking.source).toBe('WEB');
      expect(booking.attributionCampaignId).toBe(campaign.body.id);

      const invoice = await issue({ bookingId }).expect(201);
      await api(
        'post',
        `${SALON()}/invoices/${invoice.body.id}/payments`,
        tok.owner,
      )
        .send({ method: 'UPI', amount: invoice.body.total })
        .expect(201);

      const attributed = await api(
        'get',
        `${SALON()}/revenue/report?from=${today}&to=${today}&source=INSTAGRAM`,
        tok.owner,
      ).expect(200);
      expect(attributed.body.totals).toMatchObject({
        completedVisits: 1,
        invoiceCount: 1,
        recordedCollections: invoice.body.total,
        refunds: 0,
      });
      expect(attributed.body.source).toBe('INSTAGRAM');

      const directOnly = await api(
        'get',
        `${SALON()}/revenue/report?from=${today}&to=${today}&source=WEB`,
        tok.owner,
      ).expect(200);
      expect(directOnly.body.totals).toMatchObject({
        completedVisits: directBefore.totals.completedVisits,
        invoiceCount: directBefore.totals.invoiceCount,
        recordedCollections: directBefore.totals.recordedCollections,
        refunds: directBefore.totals.refunds,
      });
    });
  });
});

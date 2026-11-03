import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BookingStatus, QueueEntrySource, QueueEntryStatus } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * All-time unique customers served, against a known synthetic dataset on a disposable local
 * PostgreSQL. Totals are asserted as a change from the baseline so other suites' rows do not matter.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

maybe('admin unique customers served (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().replace(/-/g, '').slice(0, 8);
  const digits = String(parseInt(run.slice(0, 6), 16) % 100_000).padStart(5, '0');
  const local = (n: number) => `9${digits}000${n}`;
  const auth: Record<string, string> = {};
  let baseline: { unique: number; unidentifiedVisits: number };
  let salonA: string;
  let salonB: string;
  let serviceA: string;
  let serviceB: string;
  let ownerId: string;
  let token = 0;

  const get = (path: string, bearer?: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1/${path}`);
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req;
  };

  const account = (label: string, phone?: string, deletedAt?: Date) =>
    prisma.user.create({
      data: {
        email: `served-${run}-${label}@example.test`,
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
        phone,
        deletedAt,
      },
    });

  async function adminToken(label: string, role: Role, audience: SessionAudience) {
    const user = await account(label);
    await prisma.userRole.create({ data: { userId: user.id, role, salonId: null } });
    auth[label] = tokens.signAccessToken(user.id, [role], audience);
    return user;
  }

  const booking = (
    salonId: string,
    status: BookingStatus,
    who: { customerId?: string; guestPhone?: string },
  ) => {
    const start = new Date(Date.now() - 86_400_000 * (++token + 1));
    return prisma.booking.create({
      data: {
        salonId,
        serviceId: salonId === salonA ? serviceA : serviceB,
        slotStart: start,
        slotEnd: new Date(start.getTime() + 1_800_000),
        source: who.customerId ? 'WEB' : 'IN_SHOP',
        idempotencyKey: `served-${run}-${token}`,
        status,
        ...who,
        ...(who.guestPhone
          ? { guestName: `Synthetic Guest ${run}`, createdByUserId: ownerId }
          : {}),
      },
    });
  };

  const queueEntry = (
    salonId: string,
    status: QueueEntryStatus,
    who: { customerId?: string; contactPhone?: string; bookingId?: string },
    source: QueueEntrySource = QueueEntrySource.WALK_IN,
  ) =>
    prisma.queueEntry.create({
      data: {
        salonId,
        source,
        status,
        tokenNumber: ++token,
        ...who,
        ...(who.contactPhone ? { contactName: `Synthetic Guest ${run}` } : {}),
      },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    await adminToken('platform', Role.PLATFORM_ADMIN, SessionAudience.ADMIN);
    await adminToken('cofounder', Role.CO_FOUNDER, SessionAudience.ADMIN);
    await adminToken('viewer', Role.PLATFORM_VIEWER, SessionAudience.ADMIN);
    await adminToken('hr', Role.HR_ADMIN, SessionAudience.ADMIN);
    await adminToken('customer', Role.CUSTOMER, SessionAudience.CUSTOMER);

    const overview = await get(
      'admin/analytics/overview?from=2026-10-01&to=2026-10-31',
      auth.platform,
    ).expect(200);
    baseline = overview.body.customersServed;

    const owner = await account('owner');
    ownerId = owner.id;
    const city = await prisma.city.create({
      data: {
        name: `Served City ${run}`,
        slug: `served-city-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    for (const label of ['a', 'b']) {
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Served Salon ${label} ${run}`,
          slug: `served-salon-${label}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic address',
        },
      });
      const service = await prisma.service.create({
        data: {
          salonId: salon.id,
          name: 'Synthetic cut',
          durationMinutes: 30,
          price: 100,
        },
      });
      if (label === 'a') {
        salonA = salon.id;
        serviceA = service.id;
      } else {
        salonB = salon.id;
        serviceB = service.id;
      }
    }

    const alice = await account('alice', `+91${local(1)}`);
    const carol = await account('carol');
    const bob = await account('bob');
    await account('gone', `+91${local(4)}`, new Date());

    // Alice: account appointment, account walk-in, and a guest visit under her phone (local format).
    await booking(salonA, BookingStatus.COMPLETED, { customerId: alice.id });
    await queueEntry(salonA, QueueEntryStatus.COMPLETED, { customerId: alice.id });
    await booking(salonB, BookingStatus.COMPLETED, { guestPhone: `0${local(1)}` });
    // A guest seen twice in two shops, with two phone spellings.
    await queueEntry(salonA, QueueEntryStatus.COMPLETED, {
      contactPhone: `+91 ${local(2).slice(0, 5)} ${local(2).slice(5)}`,
    });
    await booking(salonB, BookingStatus.COMPLETED, { guestPhone: local(2) });
    // Two walk-ins that cannot be told apart: no phone at all, and a phone too short to be one.
    await queueEntry(salonA, QueueEntryStatus.COMPLETED, {});
    await queueEntry(salonA, QueueEntryStatus.COMPLETED, { contactPhone: '12345' });
    // Not served: a cancelled appointment and a walk-in still waiting.
    await booking(salonA, BookingStatus.CANCELLED, { customerId: bob.id });
    await queueEntry(salonA, QueueEntryStatus.WAITING, { contactPhone: local(3) });
    // One appointment served through the queue is one visit, not two.
    const served = await booking(salonA, BookingStatus.COMPLETED, { customerId: carol.id });
    await queueEntry(
      salonA,
      QueueEntryStatus.COMPLETED,
      { customerId: carol.id, bookingId: served.id },
      QueueEntrySource.APPOINTMENT,
    );
    // A deleted account's phone no longer identifies that account: this is a guest.
    await queueEntry(salonB, QueueEntryStatus.COMPLETED, { contactPhone: local(4) });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('counts each person once and reports unidentified visits separately', async () => {
    const res = await get(
      'admin/analytics/overview?from=2026-10-01&to=2026-10-31',
      auth.platform,
    ).expect(200);
    expect(res.body.customersServed).toEqual({
      unique: baseline.unique + 4, // Alice, the guest, Carol, the deleted account's phone
      unidentifiedVisits: baseline.unidentifiedVisits + 2,
    });
  });

  it('lists one masked row per customer with exact visit counts', async () => {
    const res = await get('admin/analytics/customers-served', auth.platform).expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.total).toBe(baseline.unique + 4);
    const byPhone = (n: number, type: string) =>
      res.body.customers.filter(
        (c: { maskedPhone: string | null; type: string; lastSalon: string }) =>
          c.type === type &&
          c.lastSalon.endsWith(run) &&
          c.maskedPhone?.endsWith(`0${n}`),
      );

    const alice = byPhone(1, 'REGISTERED');
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({
      completedVisits: 3,
      appointmentsCompleted: 2,
      walkInsServed: 1,
      salonsVisited: 2,
    });
    const guest = byPhone(2, 'GUEST');
    expect(guest).toHaveLength(1);
    expect(guest[0]).toMatchObject({ completedVisits: 2, salonsVisited: 2 });
    expect(byPhone(4, 'GUEST')).toHaveLength(1);
    expect(byPhone(3, 'GUEST')).toHaveLength(0);

    const body = JSON.stringify(res.body);
    for (const n of [1, 2, 4]) expect(body).not.toContain(local(n));
    expect(body).not.toContain(`Synthetic Guest ${run}`);
    expect(body).not.toContain('@example.test');
  });

  it('lets the viewer see the total but not the customer list', async () => {
    const overview = await get(
      'admin/analytics/overview?from=2026-10-01&to=2026-10-31',
      auth.viewer,
    ).expect(200);
    expect(overview.body.customersServed.unique).toBe(baseline.unique + 4);
    await get('admin/analytics/customers-served', auth.viewer).expect(403);
  });

  it('allows the list only for roles that may export the customer report', async () => {
    await get('admin/analytics/customers-served').expect(401);
    await get('admin/analytics/customers-served', auth.customer).expect(403);
    await get('admin/analytics/customers-served', auth.hr).expect(403);
    await get('admin/analytics/customers-served', auth.cofounder).expect(200);
  });

  it('records every download in the audit log without customer data', async () => {
    const before = await prisma.auditLog.count({
      where: { action: 'ADMIN_DATA_EXPORT', entityType: 'AdminExport' },
    });
    const res = await get('admin/analytics/customers-served', auth.platform).expect(200);
    const rows = await prisma.auditLog.findMany({
      where: { action: 'ADMIN_DATA_EXPORT', entityType: 'AdminExport' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'ADMIN_DATA_EXPORT', entityType: 'AdminExport' },
      }),
    ).toBe(before + 1);
    expect(rows[0].metadata).toMatchObject({
      category: 'CUSTOMERS_SERVED',
      outcome: 'SUCCEEDED',
      rows: res.body.customers.length,
    });
    expect(JSON.stringify(rows[0].metadata)).not.toContain(local(1));
  });
});

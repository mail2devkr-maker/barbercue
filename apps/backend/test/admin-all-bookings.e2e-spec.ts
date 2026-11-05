import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
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
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Admin "All Bookings" on a DISPOSABLE database: paging, filters, privacy and audience. */
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

maybe('Admin all bookings (e2e, disposable database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const get = (who: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/admin/bookings${query}`)
      .set('Authorization', `Bearer ${tok[who]}`);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const city = await prisma.city.create({
      data: {
        name: `AB ${run}`,
        slug: `ab-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    const user = async (
      label: string,
      roles: Role[],
      audience: SessionAudience,
    ) => {
      const u = await prisma.user.create({
        data: {
          email: `ab-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      for (const role of roles)
        await prisma.userRole.create({
          data: { userId: u.id, role, salonId: null },
        });
      tok[label] = tokens.signAccessToken(u.id, roles, audience);
      return u.id;
    };
    await user('admin', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await user('cofounder', [Role.CO_FOUNDER], SessionAudience.ADMIN);
    await user('cofounderStaff', [Role.CO_FOUNDER], SessionAudience.STAFF);
    await user('hr', [Role.HR_ADMIN], SessionAudience.ADMIN);
    const customer = await user(
      'customer',
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );
    const owner = await user('owner', [], SessionAudience.STAFF);
    const s = await prisma.salon.create({
      data: {
        ownerUserId: owner,
        name: `AllBook Shop ${run}`,
        slug: `ab-shop-${run}`,
        cityId: city.id,
        addressLine: 'Synthetic',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        status: SalonStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: owner, role: Role.SALON_OWNER, salonId: s.id },
    });
    tok.owner = tokens.signAccessToken(
      owner,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );
    ids.shop = s.id;
    ids.publicId = s.publicId;
    const svc = await prisma.service.create({
      data: {
        salonId: s.id,
        name: `AB Cut ${run}`,
        price: 200,
        durationMinutes: 30,
      },
    });
    // 55 bookings on 2030-01-10 (IST), one cancelled guest booking on 2030-01-11.
    const base = Date.parse('2030-01-10T04:30:00.000Z'); // 10:00 IST
    for (let i = 0; i < 55; i++) {
      await prisma.booking.create({
        data: {
          salonId: s.id,
          serviceId: svc.id,
          customerId: customer,
          slotStart: new Date(base + i * 60_000),
          slotEnd: new Date(base + i * 60_000 + 30 * 60_000),
          status: BookingStatus.CONFIRMED,
          source: BookingSource.WEB,
          idempotencyKey: `ab-${run}-${i}`,
          internalNote: `Secret note ${run}`,
        },
      });
    }
    await prisma.booking.create({
      data: {
        salonId: s.id,
        serviceId: svc.id,
        slotStart: new Date('2030-01-11T06:30:00.000Z'),
        slotEnd: new Date('2030-01-11T07:00:00.000Z'),
        status: BookingStatus.CANCELLED,
        source: BookingSource.IN_SHOP,
        idempotencyKey: `ab-${run}-guest`,
        guestName: `Guest Person ${run}`,
        createdByUserId: owner,
        guestPhone: '+919888877777',
        cancellationReason: `Private reason ${run}`,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('pages newest appointment first through every booking of the shop, without duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `?shop=${encodeURIComponent(`AllBook Shop ${run}`)}${cursor ? `&cursor=${cursor}` : ''}`;
      const body = (await get('admin', q).expect(200)).body;
      for (const row of body.items) seen.push(row.id);
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 5);
    expect(seen).toHaveLength(56);
    expect(new Set(seen).size).toBe(56);
    expect(pages).toBe(2);
    const first = (await get('admin', `?shop=${ids.publicId}`).expect(200)).body
      .items[0];
    expect(first).toMatchObject({
      status: 'CANCELLED',
      guest: true,
      shop: { id: ids.shop },
    });
  });

  it('filters by status and by IST appointment day', async () => {
    const cancelled = (
      await get('admin', `?shop=${ids.publicId}&status=CANCELLED`).expect(200)
    ).body.items;
    expect(cancelled).toHaveLength(1);
    const day = (
      await get(
        'admin',
        `?shop=${ids.publicId}&from=2030-01-11&to=2030-01-11`,
      ).expect(200)
    ).body.items;
    expect(day.map((r: { status: string }) => r.status)).toEqual(['CANCELLED']);
    expect((await get('admin', '?from=2030-1-1')).status).toBe(400);
    expect((await get('admin', '?cursor=not-a-cursor')).status).toBe(400);
  });

  it('never returns customer or guest details, notes or reasons', async () => {
    const raw = JSON.stringify(
      (await get('admin', `?shop=${ids.publicId}`).expect(200)).body,
    );
    for (const secret of [
      'Guest Person',
      '9888877777',
      'Secret note',
      'Private reason',
      `ab-${run}-customer`,
    ])
      expect(raw).not.toContain(secret);
    expect(raw).not.toMatch(
      /customerId|guestName|guestPhone|internalNote|cancellationReason|email/,
    );
  });

  it('Super Admin and Co-Founder (admin session) only', async () => {
    await get('cofounder').expect(200);
    for (const who of ['cofounderStaff', 'hr', 'owner', 'customer'])
      expect((await get(who)).status).toBe(403);
    expect(
      (await request(app.getHttpServer()).get('/api/v1/admin/bookings')).status,
    ).toBe(401);
  });
});

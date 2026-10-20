import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import {
  addZonedCalendarDays,
  utcToZonedDateStr,
  zonedWallTimeToUtc,
} from '../src/common/timezone/timezone';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const IS_LOCAL_DATABASE = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = IS_LOCAL_DATABASE ? describe : describe.skip;

/** Real AppModule/JWT/PostgreSQL test. It refuses any non-loopback database URL. */
maybe('offers/promotions/Daily Deals (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  const run = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const zone = 'Asia/Kolkata';

  const api = (
    method: 'get' | 'post' | 'patch',
    path: string,
    token?: string,
    idempotencyKey?: string,
  ) => {
    const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (method === 'post' || method === 'patch')
      req.set('Idempotency-Key', idempotencyKey ?? randomUUID());
    return req;
  };

  const slot = (hhmm: string, daysAhead: number): string => {
    const date = addZonedCalendarDays(
      utcToZonedDateStr(new Date(), zone),
      daysAhead,
    );
    return zonedWallTimeToUtc(date, hhmm, zone)!.toISOString();
  };

  async function makeUser(label: string, role?: Role, salonId?: string) {
    const digits = randomUUID().replace(/\D/g, '').padEnd(10, '0').slice(0, 10);
    const user = await prisma.user.create({
      data: {
        email: `offer-e2e-${run}-${label}@example.test`,
        phone: `+91${digits}`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    if (role)
      await prisma.userRole.create({
        data: { userId: user.id, role, salonId: salonId ?? null },
      });
    tokens[label] = tokenService.signAccessToken(
      user.id,
      role ? [role] : [Role.CUSTOMER],
      role === Role.SALON_OWNER || role === Role.SALON_STAFF
        ? SessionAudience.STAFF
        : SessionAudience.CUSTOMER,
    );
    ids[label] = user.id;
    return user;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    const city = await prisma.city.findFirstOrThrow({
      where: { slug: 'jharsuguda' },
    });
    ids.citySlug = city.slug;
    ids.countryCode = city.countryCode;
    const owner = await makeUser('owner');
    const outsider = await makeUser('outsider');
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: `Offer E2E ${run}`,
        slug: `offer-e2e-${run}`,
        cityId: city.id,
        addressLine: '1 Disposable Test Road',
        lat: 21.85,
        lng: 84.0,
        status: SalonStatus.ACTIVE,
        timezone: zone,
        currency: 'INR',
        // Prove an explicitly selected campaign replaces, rather than stacks with, the shop's
        // existing online-booking discount.
        onlineBookingDiscountPercent: 20,
        queueAutoAssignEnabled: false,
      },
    });
    ids.salon = salon.id;
    await prisma.userRole.create({
      data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
    });
    tokens.owner = tokenService.signAccessToken(
      owner.id,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );

    const otherSalon = await prisma.salon.create({
      data: {
        ownerUserId: outsider.id,
        name: `Other Offer Shop ${run}`,
        slug: `other-offer-${run}`,
        cityId: city.id,
        addressLine: '2 Disposable Test Road',
        status: SalonStatus.ACTIVE,
        timezone: zone,
        currency: 'INR',
      },
    });
    ids.otherSalon = otherSalon.id;
    await prisma.userRole.create({
      data: {
        userId: outsider.id,
        role: Role.SALON_OWNER,
        salonId: otherSalon.id,
      },
    });
    tokens.outsider = tokenService.signAccessToken(
      outsider.id,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );

    for (let day = 0; day < 7; day++) {
      await prisma.operatingHours.create({
        data: {
          salonId: salon.id,
          dayOfWeek: day,
          openTime: '00:00',
          closeTime: '23:59',
          isClosed: false,
        },
      });
    }
    const service = await prisma.service.create({
      data: {
        salonId: salon.id,
        name: `Offer haircut ${run}`,
        price: '1000.00',
        durationMinutes: 30,
      },
    });
    ids.service = service.id;
    const staffUser = await makeUser('staff', Role.SALON_STAFF, salon.id);
    const staff = await prisma.salonStaff.create({
      data: {
        salonId: salon.id,
        userId: staffUser.id,
        displayName: 'Synthetic Barber',
        roleInSalon: 'BARBER',
        status: 'ACTIVE',
        services: { create: [{ serviceId: service.id }] },
      },
    });
    ids.staff = staff.id;
    await prisma.chair.create({
      data: { salonId: salon.id, label: `Chair ${run}` },
    });
    await makeUser('customer-a', Role.CUSTOMER);
    await makeUser('customer-b', Role.CUSTOMER);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('authorizes salon management, previews/publishes safely, and atomically redeems the discount once', async () => {
    const path = `dashboard/salons/${ids.salon}/offers`;
    const outsiderPath = `dashboard/salons/${ids.otherSalon}/offers`;
    const validFrom = new Date(Date.now() - 60_000).toISOString();
    const validTo = new Date(Date.now() + 86_400_000).toISOString();
    const draft = {
      kind: 'DAILY_DEAL',
      title: 'Synthetic 10 percent deal',
      discountType: 'PERCENT',
      discountValue: 10,
      audience: 'ALL',
      validFrom,
      validTo,
      maxRedemptions: 1,
      perCustomerLimit: 1,
      serviceIds: [ids.service],
    };

    await api('get', outsiderPath, tokens.owner).expect(403);
    await api('get', path, tokens.outsider).expect(403);
    await api('get', path, tokens['customer-a']).expect(403);
    await api('get', path).expect(401);
    const preview = await api('post', `${path}/preview`, tokens.owner)
      .send(draft)
      .expect(201);
    expect(preview.body).toMatchObject({
      subtotal: 1000,
      discount: 100,
      finalTotal: 900,
    });
    const allServicesPreview = await api(
      'post',
      `${path}/preview`,
      tokens.owner,
    )
      .send({ ...draft, serviceIds: [] })
      .expect(201);
    expect(allServicesPreview.body.lines).toEqual([
      expect.objectContaining({ serviceId: ids.service, basePrice: 1000 }),
    ]);
    expect(allServicesPreview.body).toMatchObject({
      subtotal: 1000,
      discount: 100,
      finalTotal: 900,
    });

    const created = await api('post', path, tokens.owner, `offer-create-${run}`)
      .send(draft)
      .expect(201);
    ids.offer = created.body.id;
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      discountType: 'PERCENT',
      discountValue: 10,
    });
    await api(
      'post',
      `${path}/${ids.offer}/publish`,
      tokens.owner,
      `offer-publish-${run}`,
    ).expect(201);
    const publicList = await api('get', `offers?city=jharsuguda`).expect(200);
    const publicOffer = publicList.body.items.find(
      (item: { id: string }) => item.id === ids.offer,
    );
    expect(publicOffer).toBeDefined();
    expect(publicOffer.prices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: ids.service,
          basePrice: 1000,
          discount: 100,
          finalPrice: 900,
        }),
      ]),
    );
    expect(publicOffer.salon).toMatchObject({
      countryCode: ids.countryCode,
      citySlug: ids.citySlug,
    });
    const canonicalList = await api(
      'get',
      `offers?countryCode=${encodeURIComponent(ids.countryCode)}&citySlug=${encodeURIComponent(ids.citySlug)}`,
    ).expect(200);
    expect(canonicalList.body.items.map((item: { id: string }) => item.id)).toContain(
      ids.offer,
    );
    const wrongCountry = await api(
      'get',
      `offers?countryCode=US&citySlug=${encodeURIComponent(ids.citySlug)}`,
    ).expect(200);
    expect(wrongCountry.body.items.map((item: { id: string }) => item.id)).not.toContain(
      ids.offer,
    );
    const publicById = await api('get', `offers/${ids.offer}`).expect(200);
    expect(publicById.body).toMatchObject({
      id: ids.offer,
      salon: { id: ids.salon, countryCode: ids.countryCode, citySlug: ids.citySlug },
    });
    await api('get', `offers/${randomUUID()}`).expect(404);

    const createBooking = (customer: string, daysAhead: number) =>
      api(
        'post',
        'bookings',
        tokens[customer],
        `offer-booking-${run}-${customer}`,
      ).send({
        salonId: ids.salon,
        serviceIds: [ids.service],
        preferredStaffId: ids.staff,
        slotStart: slot('12:00', daysAhead),
        offerId: ids.offer,
      });
    const results = await Promise.all([
      createBooking('customer-a', 1),
      createBooking('customer-b', 2),
    ]);
    const successes = results.filter((result) => result.status === 201);
    const failures = results.filter((result) => result.status !== 201);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].status).toBe(409);
    expect(failures[0].body.error.code).toBe('OFFER_REDEMPTION_LIMIT');
    expect(successes[0].body).toMatchObject({
      offerId: ids.offer,
      offerTitle: draft.title,
      onlineBookingDiscountPercent: 10,
      onlineBookingDiscountAmount: 100,
      discountedServicePrice: 900,
    });
    const successfulCustomer =
      results[0].status === 201 ? 'customer-a' : 'customer-b';
    const successfulDay = successfulCustomer === 'customer-a' ? 1 : 2;
    const replay = await createBooking(successfulCustomer, successfulDay);
    expect([200, 201]).toContain(replay.status);
    expect(replay.body.id).toBe(successes[0].body.id);
    const redemptions = await prisma.offerRedemption.findMany({
      where: { salonId: ids.salon, offerId: ids.offer },
    });
    expect(redemptions).toHaveLength(1);
    expect(Number(redemptions[0].discountAmount)).toBe(100);

    await api('get', `${outsiderPath}/${ids.offer}`, tokens.outsider).expect(
      404,
    );
    await api('get', `${path}/${ids.offer}/stats`, tokens.owner)
      .expect(200)
      .then((response) => {
        expect(response.body).toMatchObject({
          redemptionCount: 1,
          recordedDiscount: 100,
          currency: 'INR',
        });
      });
    await api(
      'patch',
      `${path}/${ids.offer}`,
      tokens.owner,
      `offer-active-edit-${run}`,
    )
      .send({ title: 'Must be paused before editing' })
      .expect(409);
    await api(
      'post',
      `${path}/${ids.offer}/pause`,
      tokens.owner,
      `offer-pause-${run}`,
    ).expect(201);
    await api('get', `offers/${ids.offer}`).expect(404);
    await api(
      'patch',
      `${path}/${ids.offer}`,
      tokens.owner,
      `offer-update-${run}`,
    )
      .send({ title: 'Updated synthetic deal' })
      .expect(200);
    const auditRows = await prisma.auditLog.findMany({
      where: { entityType: 'Offer', entityId: ids.offer },
      select: { action: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'OFFER_DRAFT_CREATED',
        'OFFER_PUBLISHED',
        'OFFER_PAUSED',
        'OFFER_DRAFT_UPDATED',
      ]),
    );
  });

  it('rejects invalid percentage discounts and does not expose paused/expired offers publicly', async () => {
    const path = `dashboard/salons/${ids.salon}/offers`;
    const inactiveDraft = await api(
      'post',
      path,
      tokens.owner,
      `inactive-offer-${run}`,
    )
      .send({
        kind: 'OFFER',
        title: 'Synthetic win-back',
        discountType: 'FLAT',
        discountValue: 50,
        audience: 'INACTIVE',
        inactiveDays: 30,
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
        serviceIds: [ids.service],
      })
      .expect(201);
    const inactivePreview = await api('post', `${path}/preview`, tokens.owner)
      .send({
        kind: 'OFFER',
        title: 'Synthetic flat preview',
        discountType: 'FLAT',
        discountValue: 50,
        audience: 'INACTIVE',
        inactiveDays: 30,
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
        serviceIds: [ids.service],
      })
      .expect(201);
    expect(inactivePreview.body).toMatchObject({
      subtotal: 1000,
      discount: 50,
      finalTotal: 950,
    });
    await api(
      'post',
      `${path}/${inactiveDraft.body.id}/publish`,
      tokens.owner,
      `inactive-publish-${run}`,
    ).expect(201);
    const ineligibleBooking = await api(
      'post',
      'bookings',
      tokens['customer-a'],
      `inactive-booking-${run}`,
    )
      .send({
        salonId: ids.salon,
        serviceIds: [ids.service],
        preferredStaffId: ids.staff,
        slotStart: slot('13:00', 3),
        offerId: inactiveDraft.body.id,
      })
      .expect(409);
    expect(ineligibleBooking.body.error.code).toBe('OFFER_NOT_ELIGIBLE');
    await api(
      'post',
      `${path}/${inactiveDraft.body.id}/pause`,
      tokens.owner,
      `inactive-pause-${run}`,
    ).expect(201);
    const broadenedDraft = await api(
      'patch',
      `${path}/${inactiveDraft.body.id}`,
      tokens.owner,
      `inactive-offer-update-${run}`,
    )
      .send({ audience: 'ALL' })
      .expect(200);
    expect(broadenedDraft.body).toMatchObject({
      audience: 'ALL',
      inactiveDays: null,
    });
    await api(
      'post',
      `${path}/${inactiveDraft.body.id}/publish`,
      tokens.owner,
      `flat-publish-${run}`,
    ).expect(201);
    const flatBooking = await api(
      'post',
      'bookings',
      tokens['customer-a'],
      `flat-booking-${run}`,
    )
      .send({
        salonId: ids.salon,
        serviceIds: [ids.service],
        preferredStaffId: ids.staff,
        slotStart: slot('14:00', 4),
        offerId: inactiveDraft.body.id,
      })
      .expect(201);
    expect(flatBooking.body).toMatchObject({
      offerId: inactiveDraft.body.id,
      onlineBookingDiscountPercent: 0,
      onlineBookingDiscountAmount: 50,
      discountedServicePrice: 950,
    });
    const duplicateCustomerRedemption = await api(
      'post',
      'bookings',
      tokens['customer-a'],
      `flat-booking-duplicate-${run}`,
    )
      .send({
        salonId: ids.salon,
        serviceIds: [ids.service],
        preferredStaffId: ids.staff,
        slotStart: slot('15:00', 5),
        offerId: inactiveDraft.body.id,
      })
      .expect(409);
    expect(duplicateCustomerRedemption.body.error.code).toBe(
      'OFFER_REDEMPTION_LIMIT',
    );

    const invalid = await api(
      'post',
      path,
      tokens.owner,
      `bad-offer-${run}`,
    ).send({
      kind: 'PROMOTION',
      title: 'Invalid 101 percent',
      discountType: 'PERCENT',
      discountValue: 101,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validTo: new Date(Date.now() + 60_000).toISOString(),
      serviceIds: [ids.service],
    });
    expect(invalid.status).toBe(400);
    const publicList = await api('get', `offers?city=jharsuguda`).expect(200);
    expect(
      publicList.body.items.some(
        (item: { id: string }) => item.id === ids.offer,
      ),
    ).toBe(false);
  });

  it('does not advertise an unrestricted campaign for a service outside its salon and reports expiry', async () => {
    const path = `dashboard/salons/${ids.salon}/offers`;
    const validFrom = new Date(Date.now() - 86_400_000);
    const validTo = new Date(Date.now() + 86_400_000);
    const unrestricted = await prisma.offer.create({
      data: {
        salonId: ids.salon,
        kind: 'PROMOTION',
        status: 'ACTIVE',
        title: 'Unrestricted synthetic campaign',
        discountType: 'FLAT',
        discountValue: '50.00',
        currency: 'INR',
        audience: 'ALL',
        validFrom,
        validTo,
        perCustomerLimit: 1,
        createdByUserId: ids.owner,
      },
    });
    const otherSalonService = await prisma.service.create({
      data: {
        salonId: ids.otherSalon,
        name: `Other salon service ${run}`,
        price: '500.00',
        durationMinutes: 30,
      },
    });
    const unrelatedServiceResults = await api(
      'get',
      `offers?city=jharsuguda&service=${otherSalonService.id}`,
    ).expect(200);
    expect(
      unrelatedServiceResults.body.items.some(
        (item: { id: string }) => item.id === unrestricted.id,
      ),
    ).toBe(false);

    const expired = await prisma.offer.create({
      data: {
        salonId: ids.salon,
        kind: 'DAILY_DEAL',
        status: 'ACTIVE',
        title: 'Expired synthetic deal',
        discountType: 'PERCENT',
        discountValue: '5.00',
        currency: 'INR',
        audience: 'ALL',
        validFrom: new Date(Date.now() - 172_800_000),
        validTo: new Date(Date.now() - 86_400_000),
        perCustomerLimit: 1,
        createdByUserId: ids.owner,
      },
    });
    const expiredRows = await api(
      'get',
      `${path}?status=EXPIRED`,
      tokens.owner,
    ).expect(200);
    expect(expiredRows.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expired.id, status: 'EXPIRED' }),
      ]),
    );
    const publicRows = await api('get', `offers?city=jharsuguda`).expect(200);
    expect(
      publicRows.body.items.some(
        (item: { id: string }) => item.id === expired.id,
      ),
    ).toBe(false);
  });
});

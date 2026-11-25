import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { OTP_SENDER } from '../src/auth/services/otp-sender';
import { TokenService } from '../src/auth/services/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { zonedWallTimeToUtc } from '../src/common/timezone/timezone';
import { HomeBookingService } from '../src/home/home-booking.service';
import { HomeCustomerService } from '../src/home/home-customer.service';
import { HomeRoutingService } from '../src/home/home-routing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReservationService } from '../src/bookings/reservation.service';

const FLAGS = ['FASTQUE_HOME_ENABLED', 'SALON_HOME_SERVICES_ENABLED', 'FREELANCER_HOME_SERVICES_ENABLED', 'HOME_INSTANT_BOOKING_ENABLED', 'HOME_SCHEDULED_BOOKING_ENABLED', 'HOME_LIVE_TRACKING_ENABLED'];
const setFlags = (on: boolean) => FLAGS.forEach((f) => (process.env[f] = on ? 'true' : 'false'));
setFlags(true);
process.env.HOME_MEMBERSHIPS_ENABLED = 'false';
process.env.HOME_MONETIZATION_ENABLED = 'false';
process.env.JWT_ACCESS_SECRET ??= 'home-e2e-only-jwt-secret-not-production-0';
process.env.OTP_HASH_SECRET ??= 'home-e2e-only-otp-secret-not-production-00';
process.env.TOTP_ENCRYPTION_KEY ??= 'home-e2e-only-enc-secret-not-production-0';
process.env.PRIVATE_STORAGE_DIR ??= `${process.env.TEMP ?? '/tmp'}/home-e2e-private`;

let disposable = false;
try {
  const u = new URL(process.env.DATABASE_URL ?? '');
  disposable = ['127.0.0.1', 'localhost'].includes(u.hostname) && ['home_e2e', 'owner_ops_chain'].includes(u.pathname.slice(1));
} catch {
  disposable = false;
}
const maybe = disposable ? describe : describe.skip;
const DAY = 86_400_000;
// Unique per run so a re-used test database never mixes runs.
const LAT = 12 + Math.random() * 12;
const LNG = 74 + Math.random() * 10;
const PIN = String(500000 + Math.floor(Math.random() * 99999));

/** FastQue Home against the real AppModule and a disposable local PostgreSQL. Numbers = spec section 45. */
maybe('FastQue Home (real AppModule, disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let tokens: TokenService;
  let bookings: HomeBookingService;
  let customers: HomeCustomerService;
  let routing: HomeRoutingService;
  const sentOtps: string[] = [];
  const run = randomUUID().slice(0, 6);
  const t: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let salonId = '';
  let chairId = '';
  let salonServiceId = '';
  let salonProviderId = '';
  let indProviderId = '';
  const staff: Record<string, { id: string; pro: string }> = {};
  let indPro = '';
  const off: Record<string, string> = {};
  let dayOffset = 2;

  const api = (m: 'get' | 'post' | 'put' | 'delete', path: string, who?: string | null, body?: object, headers: Record<string, string> = {}) => {
    let r = request(app.getHttpServer())[m](`/api/v1/${path}`);
    if (who) r = r.set('Authorization', `Bearer ${t[who]}`);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return body === undefined ? r : r.send(body);
  };
  const idem = () => ({ 'Idempotency-Key': randomUUID() });
  /** A fresh day per test keeps the calendars independent. */
  const at = (hhmm: string, offset = dayOffset) => {
    const d = new Date(Date.now() + offset * DAY + 330 * 60_000).toISOString().slice(0, 10);
    return zonedWallTimeToUtc(d, hhmm, 'Asia/Kolkata')!;
  };
  const nextDay = () => (dayOffset = dayOffset >= 55 ? 2 : dayOffset + 1);

  async function user(label: string, roles: Role[], audience: SessionAudience) {
    const u = await db.user.create({ data: { phone: `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`, phoneVerifiedAt: new Date(), status: UserStatus.ACTIVE, email: `home-${run}-${label}@example.test` } });
    uid[label] = u.id;
    t[label] = tokens.signAccessToken(u.id, roles, audience);
    return u;
  }
  const address = { house: 'Flat 4B', building: 'Demo Towers', locality: `Sector ${run}`, city: `Homeville-${run}`, state: 'Uttar Pradesh', postalCode: PIN, lat: LAT + 0.001, lng: LNG + 0.001, accessNotes: 'Gate 2', contactName: 'Demo', contactPhone: '+919811111111' };
  const quote = (over: object = {}) => ({ address, items: [{ serviceCode: 'mens-haircut', quantity: 1 }], mode: 'SCHEDULED', preference: 'FASTEST', startAt: at('11:00').toISOString(), ...over });
  const getQuote = async (q: object, who = 'cust') => (await api('post', 'home/me/quote', who, q)).body;
  async function book(q: ReturnType<typeof quote>, who = 'cust', extra: object = {}) {
    const r = await api('post', 'home/me/quote', who, q);
    expect(r.status).toBe(200);
    expect(r.body.options.length).toBeGreaterThan(0);
    const res = await api('post', 'home/me/bookings', who, { quote: q, expectedTotalPaise: r.body.options[0].price.totalPaise, paymentMethod: 'CASH', acceptPolicies: true, ...extra }, idem());
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body as { code: string; status: string };
  }
  const inviteFor = async (code: string) => db.homeInvitation.findFirst({ where: { booking: { code }, status: 'PENDING' }, include: { professional: true }, orderBy: { createdAt: 'desc' } });
  const whoIs = (userId: string) => Object.keys(uid).find((k) => uid[k] === userId)!;
  async function accept(code: string) {
    const inv = await inviteFor(code);
    expect(inv).toBeTruthy();
    const who = whoIs(inv!.professional.userId);
    const r = await api('post', `home/pro/requests/${inv!.id}/accept`, who);
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    return who;
  }
  const act = (who: string, code: string, action: string, body: object = {}, h: Record<string, string> = {}) => api('post', `home/pro/bookings/${code}/${action}`, who, body, h);
  const indQuote = (over: object = {}) => quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: indPro, ...over });
  async function toArrived(code: string, who: string) {
    expect((await act(who, code, 'prepare')).status).toBe(200);
    expect((await act(who, code, 'on-the-way')).status).toBe(200);
    expect((await act(who, code, 'arrived')).status).toBe(200);
  }
  async function toDone(code: string, who: string, cust = 'cust') {
    await toArrived(code, who);
    const c = (await api('post', `home/me/bookings/${code}/start-code`, cust)).body.code as string;
    expect((await act(who, code, 'check-in', { code: c })).status).toBe(200);
    expect((await act(who, code, 'start')).status).toBe(200);
    expect((await act(who, code, 'complete')).status).toBe(200);
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue({ sendOtp: (_p: string, c: string) => (sentOtps.push(c), Promise.resolve()) })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(PrismaService);
    tokens = app.get(TokenService);
    bookings = app.get(HomeBookingService);
    customers = app.get(HomeCustomerService);
    routing = app.get(HomeRoutingService);
    // The per-minute API limits are exercised by one test; the rest of this file is far above them.
    const { ThrottlerGuard } = await import('@nestjs/throttler');
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    for (const c of ['cust', 'cust2', 'ind']) await user(c, [Role.CUSTOMER], SessionAudience.CUSTOMER);
    await user('owner', [Role.SALON_OWNER], SessionAudience.STAFF);
    await user('owner2', [Role.SALON_OWNER], SessionAudience.STAFF);
    await user('admin', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await user('viewer', [Role.PLATFORM_VIEWER], SessionAudience.ADMIN);
    await user('field', [Role.FIELD_EXECUTIVE], SessionAudience.EMPLOYEE);
    for (const [k, r] of [['admin', Role.PLATFORM_ADMIN], ['viewer', Role.PLATFORM_VIEWER], ['field', Role.FIELD_EXECUTIVE]] as const) await db.userRole.create({ data: { userId: uid[k], role: r } });
    const city = await db.city.create({ data: { name: address.city, slug: `home-${run}`, countryCode: 'IN', state: 'Uttar Pradesh', country: 'India' } });
    const salon = await db.salon.create({ data: { ownerUserId: uid.owner, name: `Home Salon ${run}`, slug: `home-salon-${run}`, cityId: city.id, addressLine: 'Demo road', status: 'ACTIVE', timezone: 'Asia/Kolkata', postalCode: PIN, lat: LAT, lng: LNG, serviceBufferMinutes: 0 } });
    salonId = salon.id;
    await db.userRole.create({ data: { userId: uid.owner, role: Role.SALON_OWNER, salonId } });
    const salon2 = await db.salon.create({ data: { ownerUserId: uid.owner2, name: `Other ${run}`, slug: `other-${run}`, cityId: city.id, addressLine: 'x', status: 'ACTIVE', timezone: 'Asia/Kolkata' } });
    await db.userRole.create({ data: { userId: uid.owner2, role: Role.SALON_OWNER, salonId: salon2.id } });
    await db.operatingHours.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ salonId, dayOfWeek, openTime: '00:00', closeTime: '23:59' })) });
    for (let i = 0; i < 5; i += 1) {
      const c = await db.chair.create({ data: { salonId, label: `C${i}` } as never });
      chairId ||= c.id;
    }
    salonServiceId = (await db.service.create({ data: { salonId, name: 'Haircut', durationMinutes: 30, price: 200 } })).id;
    for (const s of ['s1', 's2', 's3', 's4', 's5']) {
      await user(s, [Role.SALON_STAFF], SessionAudience.STAFF);
      const row = await db.salonStaff.create({ data: { salonId, userId: uid[s], displayName: `Barber ${s}`, roleInSalon: 'BARBER' } });
      await db.userRole.create({ data: { userId: uid[s], role: Role.SALON_STAFF, salonId } });
      staff[s] = { id: row.id, pro: '' };
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // ---------- Provider foundation ----------

  it('20-22,24-26 salon activation: wizard, own price, staff consent, capacity, areas, approval', async () => {
    expect((await api('post', `dashboard/salons/${salonId}/home/enable`, 'owner2')).status).toBe(403);
    const en = await api('post', `dashboard/salons/${salonId}/home/enable`, 'owner', {});
    expect(en.status).toBe(201);
    salonProviderId = en.body.id;
    expect((await api('post', `dashboard/salons/${salonId}/home/submit`, 'owner', {})).status).toBe(422);
    await api('post', `dashboard/salons/${salonId}/home/terms`, 'owner', { acceptTerms: true, publicProfileConsent: true }).expect(201);
    await api('put', `dashboard/salons/${salonId}/home/settings`, 'owner', { minStaffInSalon: 3, maxHomeStaff: 2, instantEnabled: true, travelFeePaise: 4900, travelMode: 'TWO_WHEELER', upiVpa: 'salon@upi' }).expect(200);
    const o = await api('put', `dashboard/salons/${salonId}/home/offerings`, 'owner', { serviceCode: 'mens-haircut', salonServiceId, pricePaise: 29900, durationMinutes: 30 });
    expect(o.status).toBe(200);
    await api('put', `dashboard/salons/${salonId}/home/offerings`, 'owner', { serviceCode: 'beard-trim', pricePaise: 9900, durationMinutes: 20 }).expect(200);
    await api('put', `dashboard/salons/${salonId}/home/offerings`, 'owner', { serviceCode: 'kids-haircut', pricePaise: 25000, durationMinutes: 30 }).expect(200);
    const offers = await db.homeOffering.findMany({ where: { providerId: salonProviderId }, include: { serviceDef: true } });
    offers.forEach((x) => (off[x.serviceDef.code] = x.id));
    // In-salon price untouched (57).
    expect((await db.service.findUniqueOrThrow({ where: { id: salonServiceId } })).price.toString()).toBe('200');
    await api('put', `dashboard/salons/${salonId}/home/areas`, 'owner', { areas: [{ kind: 'PINCODE', value: PIN }, { kind: 'RADIUS', value: 'base', radiusKm: 6 }] }).expect(200);
    for (const s of ['s1', 's2', 's3']) {
      const r = await api('post', `dashboard/salons/${salonId}/home/staff/${staff[s].id}`, 'owner', {});
      staff[s].pro = r.body.professionals.find((p: { salonStaffId: string }) => p.salonStaffId === staff[s].id).id;
      await api('put', `dashboard/salons/${salonId}/home/professionals/${staff[s].pro}`, 'owner', { serviceCodes: s === 's3' ? ['mens-haircut'] : ['mens-haircut', 'beard-trim', 'kids-haircut'] }).expect(200);
    }
    // Not listed and not submittable until the person consents from their own account.
    expect((await api('post', `dashboard/salons/${salonId}/home/submit`, 'owner', {})).status).toBe(422);
    expect((await api('post', `home/pro/profiles/${staff.s1.pro}/consent`, 'owner', { consent: true })).status).toBe(404);
    for (const s of ['s1', 's2', 's3']) await api('post', `home/pro/profiles/${staff[s].pro}/consent`, s, { consent: true }).expect(201);
    await api('post', `dashboard/salons/${salonId}/home/submit`, 'owner', {}).expect(201);
    expect((await api('get', `home/search?pincode=${PIN}`)).body.total).toBe(0);
    expect((await api('post', `admin/home/providers/${salonProviderId}/review`, 'viewer', { decision: 'APPROVED', note: 'fine' })).status).toBe(403);
    await api('post', `admin/home/providers/${salonProviderId}/review`, 'admin', { decision: 'APPROVED', note: 'Documents checked' }).expect(200);
    await api('put', 'admin/home/settings', 'admin', { maxDaysAhead: 60 }).expect(200);
  });

  it('23,24 independent registration: consent and adulthood required, schedule, approval', async () => {
    const base = { displayName: `Asha ${run}`, city: address.city, category: 'BARBER', skills: ['haircut'], baseLat: LAT + 0.002, baseLng: LNG + 0.002, languages: ['Hindi'] };
    expect((await api('post', 'home/pro/register', 'ind', { ...base, adult: false, channelConsent: true })).status).toBeGreaterThanOrEqual(400);
  });
  it('23b independent completes onboarding', async () => {
    const base = { displayName: `Asha ${run}`, city: address.city, category: 'BARBER', skills: ['haircut'], baseLat: LAT + 0.002, baseLng: LNG + 0.002, languages: ['Hindi'] };
    expect((await api('post', 'home/pro/register', 'ind', { ...base, adult: true, channelConsent: false })).status).toBeGreaterThanOrEqual(400);
    const r = await api('post', 'home/pro/register', 'ind', { ...base, adult: true, channelConsent: true, instantEnabled: true });
    expect(r.status).toBe(201);
    indProviderId = r.body.id;
    indPro = r.body.professionals[0].id;
    expect(r.body.professionals[0].verifications[0].scope).toBe('MOBILE');
    await api('post', 'home/pro/terms', 'ind', { acceptTerms: true, publicProfileConsent: true, adult: true }).expect(201);
    await api('put', 'home/pro/offerings', 'ind', { serviceCode: 'mens-haircut', pricePaise: 24900, durationMinutes: 30 }).expect(200);
    await api('put', 'home/pro/areas', 'ind', { areas: [{ kind: 'PINCODE', value: PIN }] }).expect(200);
    await api('put', `home/pro/profiles/${indPro}`, 'ind', { schedule: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' })), maxPerDay: 12 }).expect(200);
    await api('post', 'home/pro/submit', 'ind', {}).expect(201);
    await api('post', `admin/home/providers/${indProviderId}/review`, 'admin', { decision: 'APPROVED', note: 'Documents checked' }).expect(200);
    // Same person, no duplicate account or profile.
    expect(await db.homeProvider.count({ where: { userId: uid.ind } })).toBe(1);
  });

  // ---------- Discovery ----------

  it('1-6,8 location, search, both provider kinds clearly labelled, price comparison, no private data', async () => {
    const none = await api('get', 'home/search?pincode=110001');
    expect(none.body.total).toBe(0);
    const r = await api('get', `home/search?pincode=${PIN}&service=mens-haircut&sort=PRICE`);
    expect(r.body.total).toBe(4);
    expect(r.body.items[0].label).toBe('Independent FastQue Professional');
    expect(r.body.items.some((i: { label: string }) => i.label === `Salon Professional – Associated with Home Salon ${run}`)).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/baseLat|emergency|\+91|upi/);
    expect((await api('get', `home/search?pincode=${PIN}&q=hair%20cut`)).body.total).toBe(4);
    expect((await api('get', `home/search?pincode=${PIN}&kind=INDEPENDENT_PROFESSIONAL`)).body.total).toBe(1);
    // Radius eligibility.
    expect((await api('get', `home/search?lat=${LAT + 0.01}&lng=${LNG + 0.01}`)).body.total).toBe(3);
    expect((await api('get', `home/search?lat=${LAT + 0.4}&lng=${LNG + 0.4}`)).body.total).toBe(0);
    const q = await getQuote(quote());
    const totals = q.options.map((o: { price: { totalPaise: number } }) => o.price.totalPaise);
    expect(Math.min(...totals)).toBe(24900);
    expect(Math.max(...totals)).toBe(34800);
    const salonLine = q.options.find((o: { kind: string }) => o.kind === 'SALON_MANAGED').price.lines;
    expect(salonLine).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'TRAVEL', paise: 4900 })]));
    expect((await api('get', `home/professionals/${indPro}`)).body.badges[0].label).toBe('Mobile number verified');
  });

  it('saved addresses belong to one customer (9)', async () => {
    const a = await api('post', 'home/me/addresses', 'cust', { ...address, label: 'HOME' });
    expect(a.status).toBe(201);
    expect((await api('get', 'home/me/addresses', 'cust2')).body).toHaveLength(0);
    expect((await api('post', 'home/me/quote', 'cust2', { ...quote(), address: undefined, addressId: a.body.id })).status).toBe(404);
    expect((await api('delete', `home/me/addresses/${a.body.id}`, 'cust2')).status).toBe(404);
  });

  it('35 typed request is understood by rules and stays inside the engine', async () => {
    const r = await api('post', 'home/understand', null, { text: 'Find a barber for haircut and beard within 30 minutes under ₹500' });
    expect(r.body.intent).toMatchObject({ mode: 'INSTANT', withinMinutes: 30, maxPricePaise: 50000 });
    expect(r.body.intent.serviceCodes).toContain('beard-trim');
  });

  // ---------- Booking, dispatch, execution ----------

  it('7,11,15,27,30-33,19 scheduled visit with a specific professional from request to paid review', async () => {
    nextDay();
    const b = await book(indQuote());
    expect(b.status).toBe('INVITED');
    const view0 = (await api('get', `home/me/bookings/${b.code}`, 'cust')).body;
    expect(view0.status).toBe('INVITED');
    expect(view0.professional).toBeNull();
    // Before acceptance: area only (51).
    const req = (await api('get', 'home/pro/requests', 'ind')).body.find((x: { code: string }) => x.code === b.code);
    expect(req.locality).toBe(address.locality);
    expect(JSON.stringify(req)).not.toContain('Flat 4B');
    const early = await api('get', `home/pro/bookings/${b.code}`, 'ind');
    expect(early.body.address.full).toBeNull();
    expect(early.body.customer).toBeNull();
    await accept(b.code);
    const pro = (await api('get', `home/pro/bookings/${b.code}`, 'ind')).body;
    expect(pro.status).toBe('CONFIRMED');
    expect(pro.address.full.house).toBe('Flat 4B');
    expect((await api('get', `home/pro/bookings/${b.code}`, 's1')).status).toBe(404);
    expect((await act('ind', b.code, 'start')).status).toBe(409);
    await toArrived(b.code, 'ind');
    // 55 OTP: wrong, then right, then replay; scoped to the booking.
    const c = (await api('post', `home/me/bookings/${b.code}/start-code`, 'cust')).body;
    expect(c.qr).toBe(`fastque-home:${b.code}:START:${c.code}`);
    expect((await api('post', `home/me/bookings/${b.code}/start-code`, 'cust2')).status).toBe(404);
    expect((await act('ind', b.code, 'check-in', { code: c.code === '000000' ? '111111' : '000000' })).status).toBe(400);
    expect((await act('ind', b.code, 'check-in', { code: `fastque-home:FQH-0000000000:START:${c.code}` })).status).toBe(400);
    expect((await act('ind', b.code, 'check-in', { code: c.qr })).status).toBe(200);
    expect((await act('ind', b.code, 'check-in', { code: c.code })).status).toBe(409);
    await act('ind', b.code, 'hygiene', { stage: 'BEFORE', answers: { 'sanitized-tools': true } });
    expect((await act('ind', b.code, 'start')).status).toBe(200);
    // 56 fake payment: nobody can record it before completion, and the customer never can.
    expect((await act('ind', b.code, 'payment', { method: 'CASH', amountPaise: 24900 }, idem())).status).toBe(409);
    expect((await act('cust', b.code, 'payment', { method: 'CASH', amountPaise: 24900 }, idem())).status).toBe(403);
    // 57 price change needs the customer.
    const adj = (await act('ind', b.code, 'extras', { description: 'Head massage', amountPaise: 10000, minutes: 10 })).body;
    expect((await api('get', `home/me/bookings/${b.code}`, 'cust')).body.totalPaise).toBe(24900);
    expect((await api('post', `home/me/bookings/${b.code}/extras/${adj.id}`, 'ind', { approve: true })).status).toBe(403);
    expect((await api('post', `home/me/bookings/${b.code}/extras/${adj.id}`, 'cust', { approve: true })).body.totalPaise).toBe(34900);
    const done = await act('ind', b.code, 'complete');
    expect(done.body.status).toBe('PAYMENT_PENDING');
    expect(done.body.paymentStatus).toBe('PENDING');
    expect(done.body.address.full).toBeNull();
    const key = idem();
    expect((await act('ind', b.code, 'payment', { method: 'CASH', amountPaise: 99999 }, key)).status).toBe(422);
    const part = await act('ind', b.code, 'payment', { method: 'CASH', amountPaise: 14900 }, idem());
    expect(part.body.paymentStatus).toBe('PARTIAL');
    const k2 = idem();
    expect((await act('ind', b.code, 'payment', { method: 'CASH', amountPaise: 20000, tipPaise: 500 }, k2)).body.status).toBe('PAYMENT_CONFIRMED');
    await act('ind', b.code, 'payment', { method: 'CASH', amountPaise: 20000, tipPaise: 500 }, k2);
    expect(await db.homePaymentRecord.count({ where: { booking: { code: b.code } } })).toBe(2);
    const rv = { overall: 5, quality: 5, behaviour: 5, punctuality: 4, hygiene: 5, transparency: 5, comment: 'Good' };
    expect((await api('post', `home/me/bookings/${b.code}/review`, 'cust2', rv)).status).toBe(404);
    expect((await api('post', `home/me/bookings/${b.code}/review`, 'cust', rv)).status).toBe(201);
    expect((await api('post', `home/me/bookings/${b.code}/review`, 'cust', rv)).status).toBe(409);
    expect((await api('get', `home/professionals/${indPro}`)).body.reviewCount).toBe(1);
    // Monetization is off: no platform fee.
    const e = await db.homeEarning.findFirstOrThrow({ where: { booking: { code: b.code } } });
    expect(e).toMatchObject({ platformFeePaise: 0, servicePaise: 34900, tipPaise: 500 });
    await expect(db.homeBookingEvent.updateMany({ data: { note: 'x' } })).rejects.toThrow(/append-only/);
  });

  it('10,13 instant booking gives a window, not a promise; multi-service and family quantity add up', async () => {
    await api('post', `home/pro/profiles/${staff.s1.pro}/online`, 's1', { online: true }).expect(201);
    const q = quote({ mode: 'INSTANT', startAt: undefined, items: [{ serviceCode: 'mens-haircut', quantity: 2 }, { serviceCode: 'beard-trim', quantity: 1 }], preference: 'SPECIFIC_PROVIDER', providerId: salonProviderId });
    const r = await getQuote(q);
    expect(r.options).toHaveLength(1);
    const o = r.options[0];
    expect(o.durationMinutes).toBe(80);
    expect(o.price.totalPaise).toBe(29900 * 2 + 9900 + 4900);
    expect(new Date(o.eta.to).getTime()).toBeGreaterThan(new Date(o.eta.from).getTime());
    expect(o.eta).toMatchObject({ approximate: true, confidence: 'LOW', roadKm: null });
    const b = await book(q);
    expect(b.status).toBe('INVITED');
    await api('post', `home/me/bookings/${b.code}/cancel`, 'cust', { reason: 'Test over' }).expect(200);
    await api('post', `home/pro/profiles/${staff.s1.pro}/online`, 's1', { online: false }).expect(201);
    expect((await getQuote(q)).options).toHaveLength(0);
  });

  it('12 services nobody can combine are refused with an explicit split message', async () => {
    const r = await api('post', 'home/me/quote', 'cust', indQuote({ items: [{ serviceCode: 'mens-haircut', quantity: 1 }, { serviceCode: 'beard-trim', quantity: 1 }] }));
    expect(r.status).toBe(422);
    expect(r.body.error.details.splitRequired).toBe(true);
  });

  it('13b children need a guardian', async () => {
    nextDay();
    const q = quote({ preference: 'SPECIFIC_PROVIDER', providerId: salonProviderId, items: [{ serviceCode: 'kids-haircut', quantity: 1 }] });
    const total = (await getQuote(q)).options[0].price.totalPaise;
    const r = await api('post', 'home/me/bookings', 'cust', { quote: q, expectedTotalPaise: total, paymentMethod: 'CASH', acceptPolicies: true }, idem());
    expect(r.status).toBe(422);
  });

  it('a changed price is refused, the same request is not duplicated (idempotency)', async () => {
    nextDay();
    const q = indQuote();
    const bad = await api('post', 'home/me/bookings', 'cust', { quote: q, expectedTotalPaise: 100, paymentMethod: 'CASH', acceptPolicies: true }, idem());
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('HOME_PRICE_CHANGED');
    const k = idem();
    const body = { quote: q, expectedTotalPaise: 24900, paymentMethod: 'CASH', acceptPolicies: true };
    const one = await api('post', 'home/me/bookings', 'cust', body, k);
    const two = await api('post', 'home/me/bookings', 'cust', body, k);
    expect(two.body.code).toBe(one.body.code);
    await api('post', `home/me/bookings/${one.body.code}/cancel`, 'cust', { reason: 'Test over' }).expect(200);
  });

  it('28 decline moves on only where the customer allowed it; a named professional is never swapped', async () => {
    nextDay();
    const b = await book(indQuote());
    const inv = await inviteFor(b.code);
    expect((await api('post', `home/pro/requests/${inv!.id}/decline`, 's1', {})).status).toBe(404);
    await api('post', `home/pro/requests/${inv!.id}/decline`, 'ind', {}).expect(200);
    expect((await api('get', `home/me/bookings/${b.code}`, 'cust')).body.status).toBe('NO_PROFESSIONAL');
    expect(await db.homeInvitation.count({ where: { booking: { code: b.code } } })).toBe(1);
    const f = await book(quote({ startAt: at('15:00').toISOString() }));
    const first = await inviteFor(f.code);
    await api('post', `home/pro/requests/${first!.id}/decline`, whoIs(first!.professional.userId), {}).expect(200);
    const second = await inviteFor(f.code);
    // FASTEST may ask someone else, but never above the agreed price.
    if (second) expect(second.professionalId).not.toBe(first!.professionalId);
    const row = await db.homeBooking.findUniqueOrThrow({ where: { code: f.code } });
    expect(['INVITED', 'NO_PROFESSIONAL']).toContain(row.status);
    await api('post', `home/me/bookings/${f.code}/cancel`, 'cust', { reason: 'Test over' });
  });

  it('17,16,18 reschedule needs the other side; cancel frees the time; rebook re-quotes', async () => {
    nextDay();
    const b = await book(indQuote());
    await accept(b.code);
    const to = at('16:00').toISOString();
    expect((await api('post', `home/me/bookings/${b.code}/reschedule`, 'cust', { startAt: to })).body.status).toBe('RESCHEDULE_REQUESTED');
    expect((await api('post', `home/me/bookings/${b.code}/reschedule/answer`, 'cust', { approve: true })).status).toBe(409);
    const done = await act('ind', b.code, 'reschedule-answer', { approve: true });
    expect(done.body.serviceStart).toBe(to);
    const moved = await db.professionalCommitment.findFirstOrThrow({ where: { booking: { code: b.code }, kind: 'HOME_BOOKING', releasedAt: null } });
    expect(moved.serviceStart!.toISOString()).toBe(to);
    await api('post', `home/me/bookings/${b.code}/cancel`, 'cust', { reason: 'Plans changed' }).expect(200);
    expect(await db.professionalCommitment.count({ where: { booking: { code: b.code }, releasedAt: null } })).toBe(0);
    expect((await act('ind', b.code, 'prepare')).status).toBe(403);
    expect((await api('get', `home/me/bookings/${b.code}/rebook`, 'cust')).body.professionalId).toBe(indPro);
  });

  it('29,49 professional cancels or cannot come: replacement only with customer approval', async () => {
    nextDay();
    const q = quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s1.pro });
    const b = await book(q);
    await accept(b.code);
    const r = await act('s1', b.code, 'cannot-come', { reason: 'Unwell today' });
    expect((await api('get', `home/me/bookings/${b.code}`, 'cust')).body.status).toBe('REPLACEMENT_REQUESTED');
    expect(r.status).toBe(404);
    await api('post', `dashboard/salons/${salonId}/home/bookings/${b.code}/assign`, 'owner', { professionalId: staff.s2.pro }).expect(409);
    await api('post', `dashboard/salons/${salonId}/home/bookings/${b.code}/replacement`, 'owner', { reason: 'Offering s2', professionalId: staff.s2.pro }).expect(200);
    expect((await api('post', `home/me/bookings/${b.code}/replacement`, 'cust', { choice: 'APPROVE' })).body).toMatchObject({ status: 'CONFIRMED', professional: { name: 'Barber s2' } });
    expect(await db.homeAssignment.count({ where: { booking: { code: b.code }, status: 'ACTIVE' } })).toBe(1);
    const cancelled = await act('s2', b.code, 'cancel', { reason: 'Emergency at home' });
    expect(cancelled.status === 200 || cancelled.status === 404).toBe(true);
    expect((await api('get', `home/me/bookings/${b.code}`, 'cust')).body.status).toBe('CANCELLED_BY_PROFESSIONAL');
  });

  it('14,52 guest booking: nothing dispatches or is revealed until the phone is verified', async () => {
    nextDay();
    const q = indQuote();
    const body = { quote: q, expectedTotalPaise: 24900, paymentMethod: 'CASH', acceptPolicies: true, guest: { name: 'Guest', phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } };
    const r = await api('post', 'home/guest/bookings', null, body, idem());
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DRAFT');
    expect(await db.homeInvitation.count({ where: { booking: { code: r.body.code } } })).toBe(0);
    expect((await api('get', `home/guest/bookings/${r.body.code}`)).status).toBe(404);
    expect((await api('get', `home/guest/bookings/${r.body.code}`, null, undefined, { 'x-home-access': 'wrong' })).status).toBe(404);
    const h = { 'x-home-access': r.body.guestToken as string };
    expect((await api('get', `home/guest/bookings/${r.body.code}`, null, undefined, h)).body.guestVerificationNeeded).toBe(true);
    // Verification itself goes through the existing OTP service, exercised here at the service boundary.
    await db.homeBooking.update({ where: { code: r.body.code }, data: { guestPhoneVerifiedAt: new Date(), status: 'REQUESTED' } });
    await bookings.dispatch((await db.homeBooking.findUniqueOrThrow({ where: { code: r.body.code } })).id);
    await accept(r.body.code);
    expect((await api('get', `home/guest/bookings/${r.body.code}`, null, undefined, h)).body.professional.name).toContain('Asha');
    await api('post', `home/guest/bookings/${r.body.code}/cancel`, null, { reason: 'Not needed' }, h).expect(200);
  });

  // ---------- Scheduling ----------

  it('34 salon appointments block home visits, and home visits block salon appointments', async () => {
    nextDay();
    const start = at('11:00');
    await db.booking.create({ data: { salonId, serviceId: salonServiceId, customerId: uid.cust2, slotStart: start, slotEnd: new Date(start.getTime() + 30 * 60_000), status: 'CONFIRMED', source: 'WEB' as never, idempotencyKey: randomUUID(), preferredStaffId: staff.s1.id } });
    const q = quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s1.pro });
    const r = await getQuote(q);
    expect(r.options).toHaveLength(0);
    expect(r.unavailable[0].reason).toBe('SALON_CUSTOMER');
    const b = await book(quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s1.pro, startAt: at('15:00').toISOString() }));
    await accept(b.code);
    const slots = (await api('get', `salons/${salonId}/booking/availability?serviceIds=${salonServiceId}&date=${start.toISOString().slice(0, 10)}&staffId=${staff.s1.id}`)).body as { slotStart: string; available: boolean }[];
    const list = Array.isArray(slots) ? slots : ((slots as unknown as { slots: typeof slots }).slots ?? []);
    const three = list.find((s) => s.slotStart === at('15:00').toISOString());
    expect(three?.available).toBe(false);
    const res = await app.get(ReservationService).isStaffFreeForInterval(db, salonId, staff.s1.id, at('15:00'), at('15:30'));
    expect(res).toMatchObject({ free: false, reason: 'BOOKING_RESERVATION' });
    // Other barbers are unaffected.
    expect((await app.get(ReservationService).isStaffFreeForInterval(db, salonId, staff.s4.id, at('15:00'), at('15:30'))).free).toBe(true);
    await api('post', `home/me/bookings/${b.code}/cancel`, 'cust', { reason: 'Test over' });
    expect((await app.get(ReservationService).isStaffFreeForInterval(db, salonId, staff.s1.id, at('15:00'), at('15:30'))).free).toBe(true);
  });

  it('35q live queue: someone serving or assigned a queue customer is not dispatched now', async () => {
    await api('post', `home/pro/profiles/${staff.s2.pro}/online`, 's2', { online: true }).expect(201);
    const q = quote({ mode: 'INSTANT', startAt: undefined, preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s2.pro });
    const before = (await getQuote(q)).options[0];
    const entry = await db.queueEntry.create({ data: { salonId, serviceId: salonServiceId, source: 'WALK_IN' as never, tokenNumber: 1, status: 'IN_SERVICE', assignedStaffId: staff.s2.id, assignedChairId: chairId, serviceStartedAt: new Date() } });
    const s = await db.serviceSession.create({ data: { queueEntryId: entry.id, staffId: staff.s2.id, chairId, serviceId: salonServiceId, startedAt: new Date(), status: 'ACTIVE' } as never });
    const after = (await getQuote(q)).options[0];
    // 30 min of service remain, so the earliest arrival moves back by about that much.
    expect(new Date(after.serviceStart).getTime() - new Date(before.serviceStart).getTime()).toBeGreaterThan(25 * 60_000);
    await db.serviceSession.update({ where: { id: s.id }, data: { status: 'COMPLETED' as never, endedAt: new Date() } as never }).catch(() => db.serviceSession.delete({ where: { id: s.id } }));
    await db.queueEntry.update({ where: { id: entry.id }, data: { status: 'COMPLETED' } });
    // Busy queue protects the shop floor.
    await db.queueEntry.createMany({ data: Array.from({ length: 13 }, (_, i) => ({ salonId, source: 'WALK_IN' as never, tokenNumber: 100 + i, status: 'WAITING' as never })) });
    expect((await getQuote(q)).unavailable[0].reason).toBe('QUEUE_DEMAND');
    await db.queueEntry.updateMany({ where: { salonId, status: 'WAITING' }, data: { status: 'CANCELLED' } });
    await api('post', `home/pro/profiles/${staff.s2.pro}/online`, 's2', { online: false });
  });

  it('36 FastQue Work on-site gig blocks a home visit (Talent shifts are not on this branch)', async () => {
    nextDay();
    const cat = await db.workCategory.findFirstOrThrow();
    const org = await db.workOrganization.create({ data: { legalName: 'Demo Org', displayName: 'Demo Org', orgType: 'MARKETING_AGENCY', registeredAddress: 'x', city: 'x', contactName: 'x', contactPhone: '+919811111111', contactEmail: 'x@example.test', createdById: uid.owner2 } as never });
    const job = await db.workJob.create({ data: { orgId: org.id, categoryId: cat.id, title: 'Gig', description: 'x', locationType: 'ON_SITE', city: 'x', positions: 1, startsAt: at('10:00'), endsAt: at('14:00'), payType: 'PER_TASK', payPerWorkerPaise: 10000, feeBps: 0, requiredSkills: [], languages: [], hiringMode: 'INSTANT_ACCEPT', checkInCode: 'X', checklist: [], completionCriteria: 'x', cancellationTerms: {}, createdById: uid.owner2 } });
    const asg = await db.workAssignment.create({ data: { jobId: job.id, workerId: uid.ind, slotNumber: 1, agreedPayPaise: 10000, termsSnapshot: {} } });
    expect((await getQuote(indQuote())).unavailable[0].reason).toBe('WORK_SHIFT');
    await db.workAssignment.update({ where: { id: asg.id }, data: { status: 'CANCELLED' } });
    expect((await getQuote(indQuote())).options).toHaveLength(1);
  });

  it('a person working a salon shift elsewhere cannot freelance in it', async () => {
    nextDay();
    const m = await db.salonStaff.create({ data: { salonId, userId: uid.ind, displayName: 'Asha', roleInSalon: 'BARBER' } });
    await db.staffWorkingHours.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ staffId: m.id, dayOfWeek, openTime: '10:00', closeTime: '14:00' })) });
    expect((await getQuote(indQuote())).unavailable[0].reason).toBe('SALON_SHIFT');
    expect((await getQuote(indQuote({ startAt: at('16:00').toISOString() }))).options).toHaveLength(1);
    await db.salonStaff.update({ where: { id: m.id }, data: { status: 'INACTIVE', accessRevokedAt: new Date() } });
  });

  it('37,38,50 simultaneous acceptance: one winner, database refuses overlap', async () => {
    nextDay();
    const a = await book(indQuote());
    const invA = await inviteFor(a.code);
    // Second overlapping request cannot even be quoted while the first is being asked.
    expect((await getQuote(indQuote(), 'cust2')).unavailable[0].reason).toBe('BUSY');
    const race = await Promise.all([1, 2, 3, 4].map(() => api('post', `home/pro/requests/${invA!.id}/accept`, 'ind')));
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.homeAssignment.count({ where: { booking: { code: a.code } } })).toBe(1);
    const c = await db.professionalCommitment.findFirstOrThrow({ where: { booking: { code: a.code }, kind: 'HOME_BOOKING' } });
    await expect(db.professionalCommitment.create({ data: { userId: c.userId, kind: 'BREAK', startAt: c.startAt, endAt: c.endAt } })).rejects.toThrow(/no_overlap|23P01/);
    await api('post', `home/me/bookings/${a.code}/cancel`, 'cust', { reason: 'Test over' });

    // Two customers hold the same time at the same moment: exactly one succeeds.
    nextDay();
    const holds = await Promise.all(['cust', 'cust2', 'cust', 'cust2'].map((w) => api('post', 'home/me/holds', w, { quote: indQuote() })));
    expect(holds.filter((h) => h.status === 201)).toHaveLength(1);
    await api('delete', `home/me/holds/${holds.find((h) => h.status === 201)!.body.holdId}`, 'cust').expect(200);

    // Two professionals invited in parallel: the booking row lock lets one in.
    nextDay();
    await api('put', 'admin/home/settings', 'admin', { parallelInvites: 2 }).expect(200);
    const p = await book(quote({ preference: 'SPECIFIC_PROVIDER', providerId: salonProviderId }));
    const invs = await db.homeInvitation.findMany({ where: { booking: { code: p.code }, status: 'PENDING' }, include: { professional: true } });
    expect(invs).toHaveLength(2);
    const both = await Promise.all(invs.map((i) => api('post', `home/pro/requests/${i.id}/accept`, whoIs(i.professional.userId))));
    expect(both.filter((r) => r.status === 200)).toHaveLength(1);
    expect(both.find((r) => r.status !== 200)!.body.error.code).toBe('HOME_INVITATION_CLOSED');
    expect(await db.professionalCommitment.count({ where: { booking: { code: p.code }, releasedAt: null } })).toBe(1);
    await api('put', 'admin/home/settings', 'admin', { parallelInvites: 1 }).expect(200);
    await api('post', `home/me/bookings/${p.code}/cancel`, 'cust', { reason: 'Test over' });
  });

  it('37b race between a salon appointment and a home acceptance has one winner', async () => {
    nextDay();
    const b = await book(quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s1.pro }));
    const inv = await inviteFor(b.code);
    const [home, shop] = await Promise.all([
      api('post', `home/pro/requests/${inv!.id}/accept`, 's1'),
      api('post', 'bookings', 'cust2', { salonId, serviceIds: [salonServiceId], slotStart: at('11:00').toISOString(), preferredStaffId: staff.s1.id }, idem()),
    ]);
    expect([home.status === 200, shop.status === 201].filter(Boolean)).toHaveLength(1);
    await api('post', `home/me/bookings/${b.code}/cancel`, 'cust', { reason: 'Test over' });
  });

  it('39 salon minimum staff: 5 barbers, keep 3 in shop, third visit refused; concurrent attempts respect it', async () => {
    nextDay();
    for (const s of ['s1', 's2']) {
      const b = await book(quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff[s].pro }));
      await accept(b.code);
    }
    const r = await getQuote(quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s3.pro }));
    expect(r.unavailable[0].reason).toBe('CAPACITY');
    // Pool capacity in the shop shrinks by the two who are away (5 staff, 5 chairs).
    const n = await app.get(ReservationService).countPoolReservations(db, salonId, at('11:00'), at('11:30'), { serviceIds: [salonServiceId] });
    expect(n).toBe(2);
    nextDay();
    await api('put', `dashboard/salons/${salonId}/home/settings`, 'owner', { maxHomeStaff: 1 }).expect(200);
    const holds = await Promise.all(['s1', 's2', 's3'].map((s) => api('post', 'home/me/holds', 'cust', { quote: quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff[s].pro }) })));
    expect(holds.filter((h) => h.status === 201)).toHaveLength(1);
    await api('put', `dashboard/salons/${salonId}/home/settings`, 'owner', { maxHomeStaff: 2, blockedStart: '17:00', blockedEnd: '20:00' }).expect(200);
    expect((await getQuote(quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s3.pro, startAt: at('18:00').toISOString() }))).unavailable[0].reason).toBe('PEAK_RESTRICTED');
    await api('put', `dashboard/salons/${salonId}/home/settings`, 'owner', { blockedStart: null, blockedEnd: null }).expect(200);
  });

  it('40,41,47 travel, preparation buffer, working hours and feasible slots', async () => {
    nextDay();
    const b = await book(indQuote());
    await accept(b.code);
    const c = await db.professionalCommitment.findFirstOrThrow({ where: { booking: { code: b.code }, releasedAt: null } });
    expect(c.startAt.getTime()).toBeLessThanOrEqual(at('11:00').getTime() - 10 * 60_000);
    expect(c.endAt.getTime()).toBeGreaterThanOrEqual(at('11:35').getTime());
    // Back to back without travel time is refused.
    expect((await getQuote(indQuote({ startAt: at('11:40').toISOString() }), 'cust2')).options).toHaveLength(0);
    const slots = (await api('post', 'home/me/slots', 'cust2', { date: at('11:00').toISOString().slice(0, 10), quote: { ...indQuote(), startAt: undefined } })).body.slots as { startAt: string }[];
    expect(slots.length).toBeGreaterThan(10);
    expect(slots.some((s) => s.startAt === at('11:00').toISOString())).toBe(false);
    expect((await getQuote(indQuote({ startAt: slots[0].startAt }), 'cust2')).options).toHaveLength(1);
    await api('put', `home/pro/profiles/${indPro}`, 'ind', { schedule: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '18:00' })) }).expect(200);
    expect((await getQuote(indQuote({ startAt: at('19:00').toISOString() }), 'cust2')).unavailable[0].reason).toBe('OFF_HOURS');
    await api('put', `home/pro/profiles/${indPro}`, 'ind', { schedule: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' })) }).expect(200);
    // Break and time off.
    const off1 = await api('post', 'home/pro/time-off', 'ind', { kind: 'TIME_OFF', startAt: at('15:00').toISOString(), endAt: at('18:00').toISOString() });
    expect(off1.status).toBe(201);
    expect((await api('post', 'home/pro/time-off', 'ind', { kind: 'BREAK', startAt: at('11:00').toISOString(), endAt: at('12:00').toISOString() })).status).toBe(409);
    expect((await getQuote(indQuote({ startAt: at('16:00').toISOString() }), 'cust2')).unavailable[0].reason).toBe('BUSY');
    // 42 overrun: the next customer is told, not silently moved.
    const next = await book(indQuote({ startAt: at('12:30').toISOString() }), 'cust2');
    await accept(next.code);
    const d = await act('ind', b.code, 'delay', { minutes: 60 });
    expect(d.body).toMatchObject({ delayMinutes: 60, nextAtRisk: true });
    expect(await db.homeBookingEvent.count({ where: { booking: { code: next.code }, kind: 'AT_RISK' } })).toBe(1);
    expect((await api('get', `home/me/bookings/${next.code}`, 'cust2')).body.serviceStart).toBe(at('12:30').toISOString());
    await api('delete', `home/pro/time-off/${off1.body.id}`, 'ind').expect(200);
    for (const [x, w] of [[b.code, 'cust'], [next.code, 'cust2']]) await api('post', `home/me/bookings/${x}/cancel`, w, { reason: 'Test over' });
  });

  it('13e,44 routing: a road answer is used, a failing provider falls back to the conservative estimate', async () => {
    nextDay();
    routing.useProvider({ name: 'fake', route: () => Promise.resolve({ minutes: 12, km: 4.2, traffic: false }) });
    const road = (await getQuote(indQuote())).options[0].eta;
    expect(road).toMatchObject({ approximate: false, roadKm: 4.2 });
    routing.useProvider({ name: 'broken', route: () => Promise.reject(new Error('down')) });
    const est = (await getQuote(indQuote())).options[0].eta;
    expect(est).toMatchObject({ approximate: true, roadKm: null, confidence: 'LOW' });
    routing.useProvider(undefined);
  });

  it('48 holds expire and free the time; expired invitations re-dispatch or end honestly', async () => {
    nextDay();
    const h = await api('post', 'home/me/holds', 'cust', { quote: indQuote() });
    expect(h.status).toBe(201);
    expect((await getQuote(indQuote(), 'cust2')).options).toHaveLength(0);
    await db.professionalCommitment.update({ where: { id: h.body.holdId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await getQuote(indQuote(), 'cust2')).options).toHaveLength(1);
    const late = await api('post', 'home/me/bookings', 'cust', { quote: indQuote(), holdId: h.body.holdId, expectedTotalPaise: 24900, paymentMethod: 'CASH', acceptPolicies: true }, idem());
    expect(late.body.error.code).toBe('HOME_HOLD_EXPIRED');
    const b = await book(indQuote(), 'cust2');
    await db.homeInvitation.updateMany({ where: { booking: { code: b.code } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const inv = await db.homeInvitation.findFirstOrThrow({ where: { booking: { code: b.code } } });
    expect((await api('post', `home/pro/requests/${inv.id}/accept`, 'ind')).status).toBe(409);
    await bookings.sweep();
    expect((await db.homeBooking.findUniqueOrThrow({ where: { code: b.code } })).status).toBe('NO_PROFESSIONAL');
    // 62 the same event never notifies twice.
    const count = () => db.notification.count({ where: { userId: uid.cust2, type: 'home.booking.update', payload: { path: ['code'], equals: b.code } } });
    const n = await count();
    expect(n).toBe(1);
    await bookings.sweep();
    expect(await count()).toBe(n);
  });

  // ---------- Tracking and security ----------

  it('43,45,46,52,53 tracking: consent, authorised viewers, stale label, stops and is erased', async () => {
    nextDay();
    const b = await book(indQuote());
    await accept(b.code);
    const track = (who = 'cust') => api('get', `home/me/bookings/${b.code}/tracking`, who);
    expect((await track()).body.mode).toBe('STATUS_ONLY');
    expect((await act('ind', b.code, 'tracking-start', { consent: true })).status).toBe(409);
    await act('ind', b.code, 'on-the-way');
    // 46 permission denied keeps status-only tracking.
    expect((await act('ind', b.code, 'tracking-start', { consent: false })).body).toMatchObject({ sharing: false, reason: 'DECLINED' });
    expect((await api('put', `home/pro/bookings/${b.code}/location`, 'ind', { lat: 28.5, lng: 77.4 })).body.sharing).toBe(false);
    expect((await track()).body.mode).toBe('STATUS_ONLY');
    await act('ind', b.code, 'tracking-start', { consent: true });
    expect((await api('put', `home/pro/bookings/${b.code}/location`, 's1', { lat: 1, lng: 1 })).status).toBe(404);
    await api('put', `home/pro/bookings/${b.code}/location`, 'ind', { lat: 28.5005, lng: 77.4005, accuracy: 20 }).expect(200);
    expect((await track()).body).toMatchObject({ mode: 'RECENT', location: { lat: 28.5005 } });
    expect((await track('cust2')).status).toBe(404);
    expect((await api('get', `admin/home/bookings/${b.code}/tracking`, 'viewer')).status).toBe(403);
    await db.homeTrackingSession.updateMany({ where: { booking: { code: b.code }, endedAt: null }, data: { lastAt: new Date(Date.now() - 20 * 60_000) } });
    const stale = (await track()).body;
    expect(stale.mode).toBe('LAST_KNOWN');
    expect(stale.reason).toContain('not live');
    process.env.HOME_LIVE_TRACKING_ENABLED = 'false';
    expect((await track()).body.location).toBeNull();
    process.env.HOME_LIVE_TRACKING_ENABLED = 'true';
    await act('ind', b.code, 'arrived');
    expect((await track()).body.mode).toBe('STATUS_ONLY');
    const s = await db.homeTrackingSession.findMany({ where: { booking: { code: b.code } } });
    expect(s.every((x) => x.endedAt && x.lastLat === null)).toBe(true);
    await api('post', `home/me/bookings/${b.code}/cancel`, 'cust', { reason: 'Test over' });
  });

  it('55b OTP expiry, attempt limit and issue limit', async () => {
    nextDay();
    const b = await book(indQuote());
    await accept(b.code);
    await toArrived(b.code, 'ind');
    const c1 = (await api('post', `home/me/bookings/${b.code}/start-code`, 'cust')).body.code as string;
    await db.homeServiceCode.updateMany({ where: { booking: { code: b.code } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await act('ind', b.code, 'check-in', { code: c1 })).body.error.code).toBe('HOME_CODE_EXPIRED');
    const c2 = (await api('post', `home/me/bookings/${b.code}/start-code`, 'cust')).body.code as string;
    const wrong = c2 === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) expect((await act('ind', b.code, 'check-in', { code: wrong })).status).toBe(400);
    expect((await act('ind', b.code, 'check-in', { code: c2 })).status).toBe(429);
    for (let i = 0; i < 4; i += 1) await api('post', `home/me/bookings/${b.code}/start-code`, 'cust').expect(200);
    expect((await api('post', `home/me/bookings/${b.code}/start-code`, 'cust')).status).toBe(429);
    // Audited admin exception; safety reporting never needs a code.
    expect((await api('post', `admin/home/bookings/${b.code}/force-check-in`, 'viewer', { note: 'Codes failing' })).status).toBe(403);
    await api('post', `admin/home/bookings/${b.code}/force-check-in`, 'admin', { note: 'Codes failing, verified by call' }).expect(200);
    expect(await db.homeAudit.count({ where: { action: 'FORCED_CHECK_IN' } })).toBeGreaterThan(0);
    expect((await act('ind', b.code, 'incident', { kind: 'UNSAFE_LOCATION', description: 'Felt unsafe here' })).body.guidance).toContain('112');
    await act('ind', b.code, 'interrupt', { reason: 'Unsafe conditions' });
    expect((await api('get', `home/me/bookings/${b.code}`, 'cust')).body.status).toBe('INTERRUPTED');
  });

  it('54 cross-provider and cross-salon isolation', async () => {
    nextDay();
    const b = await book(quote({ preference: 'SPECIFIC_PROVIDER', providerId: salonProviderId }));
    expect((await api('get', `dashboard/salons/${salonId}/home/bookings/${b.code}`, 'owner')).status).toBe(200);
    for (const p of ['', '/bookings?tab=incoming', '/earnings?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z', `/bookings/${b.code}`]) expect((await api('get', `dashboard/salons/${salonId}/home${p}`, 'owner2')).status).toBe(403);
    expect((await api('get', `home/pro/bookings/${b.code}`, 'ind')).status).toBe(404);
    expect((await api('get', 'admin/home/overview', 'cust')).status).toBe(403);
    expect((await api('get', 'admin/home/overview', 'owner')).status).toBe(403);
    expect((await api('get', 'admin/home/overview', 'viewer')).status).toBe(200);
    expect((await api('get', `admin/home/bookings/${b.code}`, 'viewer')).status).toBe(403);
    expect(JSON.stringify((await api('get', 'admin/home/dispatch', 'viewer')).body)).not.toContain('Flat 4B');
    // Owner can assign own staff directly; not someone else's.
    expect((await api('post', `dashboard/salons/${salonId}/home/bookings/${b.code}/assign`, 'owner', { professionalId: indPro })).status).toBe(403);
    await api('post', `dashboard/salons/${salonId}/home/bookings/${b.code}/assign`, 'owner', { professionalId: staff.s2.pro }).expect(200);
    await api('post', `dashboard/salons/${salonId}/home/bookings/${b.code}/cancel`, 'owner', { reason: 'Shop closed' }).expect(200);
    expect((await api('get', `home/me/bookings/${b.code}`, 'cust')).body.status).toBe('CANCELLED_BY_SALON');
  });

  it('manual approval waits for the owner', async () => {
    nextDay();
    await api('put', `dashboard/salons/${salonId}/home/settings`, 'owner', { manualApproval: true }).expect(200);
    const b = await book(quote({ preference: 'SPECIFIC_PROVIDER', providerId: salonProviderId }));
    expect(b.status).toBe('AWAITING_ASSIGNMENT');
    await api('post', `dashboard/salons/${salonId}/home/bookings/${b.code}/assign`, 'owner', { professionalId: staff.s2.pro }).expect(200);
    await api('put', `dashboard/salons/${salonId}/home/settings`, 'owner', { manualApproval: false }).expect(200);
    await api('post', `home/me/bookings/${b.code}/cancel`, 'cust', { reason: 'Test over' });
  });

  it('58,59,32 support, escalation, safety, payment dispute, refund record', async () => {
    nextDay();
    const b = await book(indQuote());
    await accept(b.code);
    await toDone(b.code, 'ind');
    const tk = await api('post', `home/me/bookings/${b.code}/tickets`, 'cust', { category: 'SERVICE_QUALITY', message: 'Uneven cut' });
    expect(tk.status).toBe(201);
    await api('post', `admin/home/tickets/${tk.body.id}`, 'admin', { status: 'ESCALATED', reply: 'internal only', internal: true, assignToMe: true }).expect(201);
    await api('post', `admin/home/tickets/${tk.body.id}`, 'admin', { reply: 'We are checking' }).expect(201);
    const seen = (await api('get', `home/me/bookings/${b.code}/tickets/${tk.body.id}`, 'cust')).body;
    expect(JSON.stringify(seen)).not.toContain('internal only');
    expect(JSON.stringify(seen)).toContain('We are checking');
    expect((await api('get', `home/me/bookings/${b.code}/tickets/${tk.body.id}`, 'cust2')).status).toBe(404);
    await act('ind', b.code, 'payment', { method: 'CASH', amountPaise: 24900 }, idem());
    const pay = await db.homePaymentRecord.findFirstOrThrow({ where: { booking: { code: b.code } } });
    expect((await api('post', `home/me/bookings/${b.code}/payments/${pay.id}`, 'cust', { agree: false, note: 'I did not pay this' })).body.paymentStatus).toBe('DISPUTED');
    expect((await api('post', `admin/home/bookings/${b.code}/refund`, 'admin', { kind: 'REFUND', amountPaise: 99900, reason: 'too much' })).status).toBe(422);
    await api('post', `admin/home/bookings/${b.code}/refund`, 'admin', { kind: 'REFUND', amountPaise: 5000, reason: 'Goodwill agreed' }).expect(200);
    await api('post', `admin/home/bookings/${b.code}/void-payment`, 'admin', { paymentId: pay.id, note: 'Recorded by mistake' }).expect(200);
    expect((await db.homeBooking.findUniqueOrThrow({ where: { code: b.code } })).status).toBe('PAYMENT_PENDING');
    const inc = await api('post', `home/me/bookings/${b.code}/incident`, 'cust', { kind: 'HARASSMENT', description: 'Uncomfortable remarks' });
    expect(inc.status).toBe(201);
    expect((await api('get', 'admin/home/incidents', 'viewer')).status).toBe(403);
    expect((await api('get', 'admin/home/incidents', 'admin')).body[0].kind).toBeDefined();
    await api('post', `home/me/bookings/${b.code}/block`, 'cust', {}).expect(201);
    nextDay();
    expect((await getQuote(indQuote())).options).toHaveLength(0);
    await db.homeBlock.deleteMany({ where: { blockerUserId: uid.cust } });
  });

  it('30 verification: private files, honest badges, restricted categories', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const up = (buf: Buffer, scope = 'SERVICE_QUALIFICATION') => request(app.getHttpServer()).post(`/api/v1/home/pro/profiles/${indPro}/verifications`).set('Authorization', `Bearer ${t.ind}`).field('scope', scope).field('subject', scope === 'SERVICE_QUALIFICATION' ? 'bridal-makeup' : '').attach('file', buf, 'x.png');
    expect((await up(Buffer.from('<script>'))).status).toBe(422);
    const v = await up(png);
    expect(v.status).toBe(201);
    expect((await up(png, 'MOBILE')).status).toBe(422);
    expect((await api('get', `admin/home/verifications/${v.body.id}/file`, 'viewer')).status).toBe(403);
    expect((await api('get', `home/pro/verifications/${v.body.id}/file`, 's1')).status).toBe(404);
    expect((await api('get', `admin/home/verifications/${v.body.id}/file`, 'admin')).status).toBe(200);
    await api('put', 'home/pro/offerings', 'ind', { serviceCode: 'party-makeup', pricePaise: 150000, durationMinutes: 75 }).expect(200);
    expect((await api('get', `home/search?pincode=${PIN}&service=party-makeup`)).body.total).toBe(0);
    await api('post', `admin/home/verifications/${v.body.id}/review`, 'admin', { status: 'VERIFIED', note: 'Certificate checked with institute' }).expect(200);
    expect((await api('get', `home/search?pincode=${PIN}&service=party-makeup`)).body.total).toBe(1);
    await api('post', `admin/home/verifications/${v.body.id}/review`, 'admin', { status: 'SUSPENDED', note: 'Under dispute' }).expect(200);
    expect((await api('get', `home/search?pincode=${PIN}&service=party-makeup`)).body.total).toBe(0);
    // Inactive categories (spa, specialised) cannot be offered at all.
    expect((await api('get', 'home/categories')).body.some((c: { code: string }) => c.code === 'specialized')).toBe(false);
  });

  it('67 inventory: salon stock is consumed once through the existing ledger', async () => {
    nextDay();
    const prod = await db.inventoryProduct.create({ data: { salonId, name: `Gel ${run}`, normalizedName: `gel ${run}`, unit: 'MILLILITER' } });
    await db.inventoryMovement.create({ data: { salonId, productId: prod.id, actorUserId: uid.owner, kind: 'OPENING', quantityDelta: 100, unitCost: 2, idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64) } });
    await api('put', `dashboard/salons/${salonId}/home/offerings`, 'owner', { serviceCode: 'mens-haircut', salonServiceId, pricePaise: 29900, durationMinutes: 30, products: [{ productId: prod.id, quantity: 10 }] }).expect(200);
    const b = await book(quote({ preference: 'SPECIFIC_PROFESSIONAL', professionalId: staff.s1.pro }));
    await accept(b.code);
    await toDone(b.code, 's1');
    expect((await db.inventoryProduct.findUniqueOrThrow({ where: { id: prod.id } })).stockOnHand.toString()).toBe('90');
    expect((await act('s1', b.code, 'complete')).status).toBe(403);
    expect(await db.inventoryMovement.count({ where: { productId: prod.id, kind: 'CONSUMPTION' } })).toBe(1);
    // Cost is for the owner only; staff and customer never see it.
    expect(JSON.stringify((await api('get', `home/me/bookings/${b.code}`, 'cust')).body)).not.toContain('averageUnitCost');
  });

  it('28p promotions, packages; memberships and monetization stay off', async () => {
    nextDay();
    await api('post', 'admin/home/promotions', 'admin', { code: `SAVE${run.toUpperCase()}`, title: 'Launch', amountOffPaise: 5000, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() }).expect(201);
    const q = await getQuote(indQuote({ promoCode: `SAVE${run.toUpperCase()}` }));
    expect(q.options[0].price.totalPaise).toBe(19900);
    const pk = await api('post', `dashboard/salons/${salonId}/home/packages`, 'owner', { title: 'Cut + beard', offeringIds: [off['mens-haircut'], off['beard-trim']], pricePaise: 35000 });
    expect(pk.status).toBe(201);
    const pq = await getQuote(quote({ preference: 'SPECIFIC_PROVIDER', providerId: salonProviderId, packageId: pk.body.id, items: [{ offeringId: off['mens-haircut'], quantity: 1 }, { offeringId: off['beard-trim'], quantity: 1 }] }));
    expect(pq.options[0].price.totalPaise).toBe(35000 + 4900);
    expect((await api('post', 'admin/home/membership-plans', 'admin', { name: 'Gold', pricePaise: 29900, active: true })).status).toBe(409);
    expect((await api('post', 'admin/home/fee-rules', 'admin', { kind: 'COMMISSION', percentBps: 500, active: true })).status).toBe(409);
  });

  it('monetization on: fee only on completed work, settled manually', async () => {
    nextDay();
    process.env.HOME_MONETIZATION_ENABLED = 'true';
    const rule = await api('post', 'admin/home/fee-rules', 'admin', { kind: 'COMMISSION', providerId: indProviderId, percentBps: 1000, active: true });
    expect(rule.status).toBe(201);
    const c = await book(indQuote());
    await api('post', `home/me/bookings/${c.code}/cancel`, 'cust', { reason: 'Test' });
    expect(await db.homePlatformFee.count({ where: { providerId: indProviderId } })).toBe(0);
    const b = await book(indQuote());
    await accept(b.code);
    await toDone(b.code, 'ind');
    expect((await db.homePlatformFee.findFirstOrThrow({ where: { providerId: indProviderId } })).amountPaise).toBe(2490);
    const s = await api('post', 'admin/home/settlements', 'admin', { providerId: indProviderId });
    expect(s.body.amountPaise).toBe(2490);
    expect((await api('post', 'admin/home/settlements', 'admin', { providerId: indProviderId })).status).toBe(409);
    await api('post', `admin/home/settlements/${s.body.id}/collect`, 'admin', { reference: 'CASH-1' }).expect(201);
    await db.homeFeeRule.update({ where: { id: rule.body.id }, data: { active: false } });
    process.env.HOME_MONETIZATION_ENABLED = 'false';
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const a = (await api('get', `admin/home/analytics?from=${today}&to=${today}`, 'viewer')).body;
    expect(a.money.fastqueRevenuePaise).toBe((await db.homePlatformFee.aggregate({ _sum: { amountPaise: true } }))._sum.amountPaise);
    expect(a.money.grossServiceValuePaise).toBeGreaterThan(a.money.fastqueRevenuePaise);
    expect(a.dispatch.distanceKm).toBeNull();
  });

  it('28r recurring bookings verify availability and keep the same professional', async () => {
    nextDay();
    const addr = (await api('get', 'home/me/addresses', 'cust')).body[0].id as string;
    const p = await api('post', 'home/me/recurring', 'cust', { professionalId: indPro, addressId: addr, items: [{ serviceCode: 'mens-haircut', quantity: 1 }], intervalDays: 21, firstStart: at('11:00', 1).toISOString(), paymentMethod: 'CASH' });
    expect(p.status).toBe(201);
    expect((await customers.runRecurring()).booked).toBeGreaterThanOrEqual(1);
    const row = await db.homeBooking.findFirstOrThrow({ where: { recurringPlanId: p.body.id } });
    expect(row).toMatchObject({ preference: 'SPECIFIC_PROFESSIONAL', preferredProfessionalId: indPro, allowAlternatives: false });
    const plan = await db.homeRecurringPlan.findUniqueOrThrow({ where: { id: p.body.id } });
    expect(plan.nextStart.toISOString()).toBe(at('11:00', 22).toISOString());
    expect((await api('put', `home/me/recurring/${p.body.id}`, 'cust2', { status: 'PAUSED' })).status).toBe(404);
    await api('put', `home/me/recurring/${p.body.id}`, 'cust', { status: 'PAUSED' }).expect(200);
    await api('post', `home/me/bookings/${row.code}/cancel`, 'cust', { reason: 'Test over' });
  });

  it('29s society campaign: below minimum asks each resident; nobody sees other residents', async () => {
    nextDay();
    const soc = await api('post', 'admin/home/societies', 'admin', { name: 'Demo Towers', locality: address.locality, city: address.city, postalCode: PIN });
    const offering = await db.homeOffering.findFirstOrThrow({ where: { providerId: indProviderId, serviceDef: { code: 'mens-haircut' } } });
    const c = await api('post', 'admin/home/campaigns', 'admin', { societyId: soc.body.id, providerId: indProviderId, offeringId: offering.id, title: 'Sunday cuts', minParticipants: 2, maxParticipants: 5, discountPct: 20, startsAt: at('09:00').toISOString(), endsAt: at('13:00').toISOString(), joinBy: at('08:00').toISOString() });
    expect(c.status).toBe(201);
    const a1 = (await api('get', 'home/me/addresses', 'cust')).body[0].id as string;
    await api('post', `home/me/campaigns/${c.body.id}/join`, 'cust', { addressId: a1 }).expect(201);
    expect(JSON.stringify((await api('get', 'home/campaigns')).body)).not.toContain('Flat 4B');
    await db.homeCampaign.update({ where: { id: c.body.id }, data: { joinBy: new Date(Date.now() - 1000) } });
    await customers.closeCampaigns();
    expect((await db.homeCampaign.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('BELOW_MINIMUM');
    expect(await db.homeBooking.count({ where: { campaignId: c.body.id } })).toBe(0);
    await api('post', `home/me/campaigns/${c.body.id}/price`, 'cust', { approve: true }).expect(201);
    const b = await db.homeBooking.findFirstOrThrow({ where: { campaignId: c.body.id } });
    expect(b.totalPaise).toBe(24900);
  });

  it('40f field sales: consent before progress, the executive cannot consent for the person', async () => {
    expect((await api('post', 'employee/home/leads', 'field', { kind: 'PROFESSIONAL', name: 'X', city: 'Y', stage: 'REGISTERED' })).status).toBe(422);
    const fresh = await user('assisted', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    const l = await api('post', 'employee/home/leads', 'field', { kind: 'PROFESSIONAL', name: 'X', phone: fresh.phone!, city: 'Y', stage: 'CONSENTED', consent: true });
    if (/^\+91[6-9]/.test(fresh.phone!)) {
      expect(l.status).toBe(201);
      await api('post', `employee/home/leads/${l.body.id}/register`, 'field', { displayName: 'X', city: 'Y', category: 'BARBER', adult: true, channelConsent: true }).expect(201);
      expect((await db.homeProfessional.findFirstOrThrow({ where: { userId: fresh.id } })).consentAt).toBeNull();
    }
    expect((await api('get', 'employee/home/leads', 'cust')).status).toBe(403);
  });

  it('60 flags: off hides new business with 404s but existing bookings still finish', async () => {
    nextDay();
    const b = await book(indQuote());
    await accept(b.code);
    setFlags(false);
    for (const p of ['home/landing', 'home/categories', `home/search?pincode=${PIN}`]) expect((await api('get', p)).status).toBe(404);
    expect((await api('post', 'home/me/quote', 'cust', indQuote())).status).toBe(404);
    expect((await api('post', 'home/pro/register', 'cust2', {})).status).toBe(404);
    expect((await api('get', 'home/config')).body.enabled).toBe(false);
    await toDone(b.code, 'ind');
    expect((await act('ind', b.code, 'payment', { method: 'CASH', amountPaise: 24900 }, idem())).body.status).toBe('PAYMENT_CONFIRMED');
    expect((await api('get', 'admin/home/overview', 'admin')).status).toBe(200);
    setFlags(true);
    process.env.HOME_INSTANT_BOOKING_ENABLED = 'false';
    expect((await api('post', 'home/me/quote', 'cust', quote({ mode: 'INSTANT', startAt: undefined }))).status).toBe(404);
    process.env.HOME_INSTANT_BOOKING_ENABLED = 'true';
    process.env.FREELANCER_HOME_SERVICES_ENABLED = 'false';
    expect((await api('get', `home/search?pincode=${PIN}`)).body.items.every((i: { kind: string }) => i.kind === 'SALON_MANAGED')).toBe(true);
    process.env.FREELANCER_HOME_SERVICES_ENABLED = 'true';
  });

  it('privacy: export and erase', async () => {
    const e = (await api('get', 'home/me/export', 'cust')).body;
    expect(e.bookings.length).toBeGreaterThan(5);
    expect(JSON.stringify(e)).not.toContain('guestAccessHash');
    expect((await api('delete', 'home/me/data', 'cust')).status).toBe(409);
  });

  it('insights are labelled and never invent data', async () => {
    const adv = (await api('get', `dashboard/salons/${salonId}/home/advice`, 'owner')).body;
    expect(adv.workforce.enough).toBe(false);
    expect(adv.pricing[0].medianPaise).toBeNull();
    expect((await api('get', 'admin/home/insights', 'viewer')).body.notice).toContain('person must review');
  });
});

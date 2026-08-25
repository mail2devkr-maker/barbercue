/**
 * Phase 2.1 — seeds the admin account plus a full demo dataset (one salon, staff, chairs,
 * services, operating hours, customers, completed visits, reviews) so the API and future
 * dashboard work have real data to run against.
 *
 * Run with: npm run db:seed --workspace=@barbercue/backend
 * Requires ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD / TOTP_ENCRYPTION_KEY / DATABASE_URL in .env.
 *
 * Idempotent: the admin step never regenerates an existing TOTP secret (see seedAdmin). The demo
 * dataset is guarded by the salon's (cityId, slug) uniqueness — if the demo salon already exists,
 * the entire demo-data section is skipped so re-running this script is always safe and never
 * creates duplicate salons/bookings/reviews.
 *
 * Deliberately NOT seeded (out of this task's scope, not an oversight): a salon-specific
 * SalonPaymentPolicy or CancellationPolicy row for the demo salon. Both are optional-with-fallback
 * per DATABASE.md (no salon-specific row means NONE / platform-default behavior), so the demo
 * salon works correctly without them.
 *
 * Phase 3B fix: the platform-default CancellationPolicy row (salonId: null) itself IS seeded below
 * (seedPlatformDefaultCancellationPolicy) — DATABASE.md specifies this row must exist with exact
 * V1 default values, but it was never actually inserted until now. Booking cancellation has
 * nothing to fall back to without it.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  BookingSource,
  BookingStatus,
  ChairStatus,
  ChargeType,
  QueueEntrySource,
  QueueEntryStatus,
  Role,
  SalonStaffRole,
  SalonStatus,
  ServiceSessionStatus,
  UserStatus,
} from '@barbercue/shared';
import { PasswordService } from '../src/auth/services/password.service';
import { TotpService } from '../src/auth/services/totp.service';
import { CryptoService } from '../src/auth/services/crypto.service';

const prisma = new PrismaClient();
const passwordService = new PasswordService();
const totpService = new TotpService();
const cryptoService = new CryptoService();

const DEMO_PASSWORD = 'DemoPass123!';
const SALON_SLUG = 'barbercue-demo';
const CITY_SLUG = 'bengaluru';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function seedAdmin(): Promise<{ email: string }> {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be set (see .env.example).');
  }

  const existing = await prisma.user.findUnique({ where: { email }, include: { roles: true } });

  if (existing?.totpSecret) {
    log(`\n[admin] ${email} already seeded with 2FA configured — nothing to do.`);
    return { email };
  }

  const passwordHash = await passwordService.hash(password);
  const totpSecret = totpService.generateSecret();
  const encryptedSecret = cryptoService.encrypt(totpSecret);

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, twoFactorEnabled: true, totpSecret: encryptedSecret, status: UserStatus.ACTIVE },
      })
    : await prisma.user.create({
        data: {
          email,
          passwordHash,
          twoFactorEnabled: true,
          totpSecret: encryptedSecret,
          status: UserStatus.ACTIVE,
          roles: { create: { role: Role.PLATFORM_ADMIN } },
        },
      });

  if (existing && !existing.roles.some((r) => r.role === Role.PLATFORM_ADMIN)) {
    await prisma.userRole.create({ data: { userId: user.id, role: Role.PLATFORM_ADMIN } });
  }

  const otpAuthUri = totpService.buildOtpAuthUri(email, totpSecret);

  log(`
[admin] Account ready: ${email}

Scan this into an authenticator app (Google Authenticator, Authy, 1Password, etc.) — the raw
secret is shown only this once and is never logged or stored anywhere in plaintext again:

  Secret:   ${totpSecret}
  otpauth:// URI: ${otpAuthUri}
`);

  return { email };
}

async function upsertStaffUser(email: string, displayName: string): Promise<string> {
  const passwordHash = await passwordService.hash(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
  });
  return user.id;
}

interface DemoContext {
  salonId: string;
  serviceIds: Record<'haircut' | 'beardTrim' | 'combo' | 'spa', string>;
  staffIds: Record<'marcus' | 'devon' | 'ray', string>;
  chairIds: string[];
  customerIds: string[];
  customerPhones: string[];
}

async function seedDemoSalon(): Promise<DemoContext | null> {
  // find-then-create rather than upsert-by-slug: city slugs are unique per country now
  // (@@unique([countryCode, slug])), so `slug` alone is no longer a valid unique selector.
  const city =
    (await prisma.city.findFirst({
      where: { countryCode: 'IN', slug: CITY_SLUG },
    })) ??
    (await prisma.city.create({
      data: {
        name: 'Bengaluru',
        slug: CITY_SLUG,
        countryCode: 'IN',
        state: 'Karnataka',
        country: 'India',
      },
    }));

  const locality = await prisma.locality.upsert({
    where: { cityId_slug: { cityId: city.id, slug: 'indiranagar' } },
    update: {},
    create: { cityId: city.id, name: 'Indiranagar', slug: 'indiranagar' },
  });

  const existingSalon = await prisma.salon.findUnique({
    where: { cityId_slug: { cityId: city.id, slug: SALON_SLUG } },
  });
  if (existingSalon) {
    log(`\n[demo data] Salon "${SALON_SLUG}" already exists — skipping demo dataset (idempotent no-op).`);
    return null;
  }

  // --- Owner ---
  const ownerEmail = 'owner@barbercue-demo.com';
  const ownerPasswordHash = await passwordService.hash(DEMO_PASSWORD);
  const owner = await prisma.user.create({
    data: { email: ownerEmail, passwordHash: ownerPasswordHash, status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
  });

  // --- Salon ---
  const salon = await prisma.salon.create({
    data: {
      ownerUserId: owner.id,
      name: 'BarberCue Demo Salon',
      slug: SALON_SLUG,
      cityId: city.id,
      localityId: locality.id,
      addressLine: '100 Indiranagar 12th Main, Bengaluru',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      lat: 12.9716,
      lng: 77.6412,
      phone: '+918041234567',
      description: 'Demo salon seeded for development and testing — not a real business.',
      status: SalonStatus.ACTIVE,
    },
  });

  await prisma.userRole.create({ data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id } });

  // --- Staff (3) ---
  const staffDefs = [
    { key: 'marcus' as const, email: 'marcus@barbercue-demo.com', name: 'Marcus' },
    { key: 'devon' as const, email: 'devon@barbercue-demo.com', name: 'Devon' },
    { key: 'ray' as const, email: 'ray@barbercue-demo.com', name: 'Ray' },
  ];
  const staffIds = {} as DemoContext['staffIds'];
  const salonStaffIds: Record<string, string> = {};
  for (const def of staffDefs) {
    const userId = await upsertStaffUser(def.email, def.name);
    await prisma.userRole.create({ data: { userId, role: Role.SALON_STAFF, salonId: salon.id } });
    const salonStaff = await prisma.salonStaff.create({
      data: { salonId: salon.id, userId, displayName: def.name, roleInSalon: SalonStaffRole.BARBER, status: 'ACTIVE' },
    });
    staffIds[def.key] = salonStaff.id;
    salonStaffIds[def.key] = salonStaff.id;
  }

  // --- Chairs (4 — one more than staff, a real "more chairs than active barbers" case) ---
  const chairLabels = ['Chair 1', 'Chair 2', 'Chair 3', 'Chair 4'];
  const chairs = await Promise.all(
    chairLabels.map((label) => prisma.chair.create({ data: { salonId: salon.id, label, status: ChairStatus.ACTIVE } })),
  );
  const chairIds = chairs.map((c) => c.id);

  // --- Staff-chair assignments: 3 staff to 3 of the 4 chairs, chair 4 spare/overflow ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const shiftFrom = new Date(today);
  shiftFrom.setHours(9, 0, 0, 0);
  const shiftUntil = new Date(today);
  shiftUntil.setHours(20, 0, 0, 0);

  await Promise.all(
    [
      { staffId: staffIds.marcus, chairId: chairIds[0] },
      { staffId: staffIds.devon, chairId: chairIds[1] },
      { staffId: staffIds.ray, chairId: chairIds[2] },
    ].map((a) =>
      prisma.staffChairAssignment.create({
        data: { salonId: salon.id, staffId: a.staffId, chairId: a.chairId, shiftDate: today, assignedFrom: shiftFrom, assignedUntil: shiftUntil },
      }),
    ),
  );

  // --- Services ---
  const serviceDefs = [
    { key: 'haircut' as const, name: 'Haircut', durationMinutes: 30, price: '300.00', category: 'Hair' },
    { key: 'beardTrim' as const, name: 'Beard Trim', durationMinutes: 15, price: '150.00', category: 'Beard' },
    { key: 'combo' as const, name: 'Haircut + Beard', durationMinutes: 40, price: '400.00', category: 'Combo' },
    { key: 'spa' as const, name: 'Hair Spa', durationMinutes: 45, price: '600.00', category: 'Spa' },
  ];
  const serviceIds = {} as DemoContext['serviceIds'];
  for (const def of serviceDefs) {
    const service = await prisma.service.create({
      data: { salonId: salon.id, name: def.name, durationMinutes: def.durationMinutes, price: def.price, category: def.category, isActive: true },
    });
    serviceIds[def.key] = service.id;
  }

  // --- Operating hours (Mon–Sun; 0=Sunday..6=Saturday, JS Date.getDay() convention) ---
  const hours = [
    { dayOfWeek: 0, openTime: '10:00', closeTime: '18:00' }, // Sunday
    { dayOfWeek: 1, openTime: '09:00', closeTime: '20:00' },
    { dayOfWeek: 2, openTime: '09:00', closeTime: '20:00' },
    { dayOfWeek: 3, openTime: '09:00', closeTime: '20:00' },
    { dayOfWeek: 4, openTime: '09:00', closeTime: '20:00' },
    { dayOfWeek: 5, openTime: '09:00', closeTime: '20:00' },
    { dayOfWeek: 6, openTime: '09:00', closeTime: '20:00' },
  ];
  await Promise.all(
    hours.map((h) =>
      prisma.operatingHours.create({
        data: { salonId: salon.id, dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime, isClosed: false },
      }),
    ),
  );

  // --- Demo customers (5) ---
  const customerPhones = ['+919000000001', '+919000000002', '+919000000003', '+919000000004', '+919000000005'];
  const customerIds: string[] = [];
  for (const phone of customerPhones) {
    const customer = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, phoneVerifiedAt: new Date(), status: UserStatus.ACTIVE, roles: { create: { role: Role.CUSTOMER } } },
    });
    customerIds.push(customer.id);
  }

  return { salonId: salon.id, serviceIds, staffIds, chairIds, customerIds, customerPhones };
}

function minutesLater(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

async function seedVisitsAndReviews(ctx: DemoContext): Promise<void> {
  const { salonId, serviceIds, staffIds, chairIds, customerIds } = ctx;

  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const today = new Date();

  async function seedAppointmentVisit(opts: {
    idx: number;
    customerId: string;
    serviceKey: keyof DemoContext['serviceIds'];
    staffId: string;
    chairId: string;
    slotStart: Date;
    durationMinutes: number;
    tokenNumber: number;
    rating: number;
    comment: string;
  }): Promise<void> {
    const slotEnd = minutesLater(opts.slotStart, opts.durationMinutes);
    const booking = await prisma.booking.create({
      data: {
        salonId,
        customerId: opts.customerId,
        serviceId: serviceIds[opts.serviceKey],
        slotStart: opts.slotStart,
        slotEnd,
        status: BookingStatus.COMPLETED,
        source: BookingSource.APP,
        idempotencyKey: `seed-booking-${opts.idx}`,
      },
    });

    const queueEntry = await prisma.queueEntry.create({
      data: {
        salonId,
        bookingId: booking.id,
        customerId: opts.customerId,
        serviceId: serviceIds[opts.serviceKey],
        source: QueueEntrySource.APPOINTMENT,
        tokenNumber: opts.tokenNumber,
        status: QueueEntryStatus.COMPLETED,
        assignedStaffId: opts.staffId,
        assignedChairId: opts.chairId,
        joinedAt: opts.slotStart,
        calledAt: opts.slotStart,
        serviceStartedAt: opts.slotStart,
        serviceCompletedAt: slotEnd,
      },
    });

    await prisma.serviceSession.create({
      data: {
        queueEntryId: queueEntry.id,
        staffId: opts.staffId,
        chairId: opts.chairId,
        serviceId: serviceIds[opts.serviceKey],
        status: ServiceSessionStatus.COMPLETED,
        startedAt: opts.slotStart,
        endedAt: slotEnd,
      },
    });

    await prisma.review.create({
      data: {
        salonId,
        customerId: opts.customerId,
        bookingId: booking.id,
        rating: opts.rating,
        comment: opts.comment,
      },
    });
  }

  async function seedWalkInVisit(opts: {
    customerId: string;
    serviceKey: keyof DemoContext['serviceIds'];
    staffId: string;
    chairId: string;
    joinedAt: Date;
    durationMinutes: number;
    tokenNumber: number;
  }): Promise<void> {
    const completedAt = minutesLater(opts.joinedAt, opts.durationMinutes);
    const queueEntry = await prisma.queueEntry.create({
      data: {
        salonId,
        customerId: opts.customerId,
        serviceId: serviceIds[opts.serviceKey],
        source: QueueEntrySource.WALK_IN,
        tokenNumber: opts.tokenNumber,
        status: QueueEntryStatus.COMPLETED,
        assignedStaffId: opts.staffId,
        assignedChairId: opts.chairId,
        joinedAt: opts.joinedAt,
        calledAt: opts.joinedAt,
        serviceStartedAt: opts.joinedAt,
        serviceCompletedAt: completedAt,
      },
    });

    await prisma.serviceSession.create({
      data: {
        queueEntryId: queueEntry.id,
        staffId: opts.staffId,
        chairId: opts.chairId,
        serviceId: serviceIds[opts.serviceKey],
        status: ServiceSessionStatus.COMPLETED,
        startedAt: opts.joinedAt,
        endedAt: completedAt,
      },
    });
  }

  // Three completed appointments (each gets a review — reviews require a Booking)
  await seedAppointmentVisit({
    idx: 1,
    customerId: customerIds[0],
    serviceKey: 'haircut',
    staffId: staffIds.marcus,
    chairId: chairIds[0],
    slotStart: new Date(twoDaysAgo.setHours(10, 0, 0, 0)),
    durationMinutes: 30,
    tokenNumber: 1,
    rating: 5,
    comment: 'Great fade, quick and friendly service.',
  });

  await seedAppointmentVisit({
    idx: 2,
    customerId: customerIds[1],
    serviceKey: 'beardTrim',
    staffId: staffIds.devon,
    chairId: chairIds[1],
    slotStart: new Date(twoDaysAgo.setHours(11, 0, 0, 0)),
    durationMinutes: 15,
    tokenNumber: 2,
    rating: 4,
    comment: 'Neat beard trim, would come back.',
  });

  await seedAppointmentVisit({
    idx: 3,
    customerId: customerIds[2],
    serviceKey: 'combo',
    staffId: staffIds.ray,
    chairId: chairIds[2],
    slotStart: new Date(oneDayAgo.setHours(14, 0, 0, 0)),
    durationMinutes: 40,
    tokenNumber: 1,
    rating: 5,
    comment: 'Best haircut + beard combo in the area.',
  });

  // Two completed walk-ins (no booking, so no review — reviews require a Booking per DATABASE.md)
  await seedWalkInVisit({
    customerId: customerIds[3],
    serviceKey: 'spa',
    staffId: staffIds.marcus,
    chairId: chairIds[0],
    joinedAt: new Date(new Date(oneDayAgo).setHours(16, 0, 0, 0)),
    durationMinutes: 45,
    tokenNumber: 2,
  });

  await seedWalkInVisit({
    customerId: customerIds[4],
    serviceKey: 'haircut',
    staffId: staffIds.devon,
    chairId: chairIds[1],
    joinedAt: minutesLater(today, -120),
    durationMinutes: 30,
    tokenNumber: 1,
  });
}

/**
 * The single authoritative source for Premium plan price/credit values (PremiumPlansService
 * reads this table, never a hard-coded constant). Upsert-by-id so re-running the seed script
 * updates prices/credits in place rather than erroring or duplicating rows if these values
 * change later.
 */
async function seedPremiumPlans(): Promise<void> {
  const plans = [
    { id: 'basic', name: 'Basic', priceInr: '99.00', aiCreditsPerYear: 12, isPopular: false },
    { id: 'pro', name: 'Pro', priceInr: '299.00', aiCreditsPerYear: 48, isPopular: true },
    { id: 'max', name: 'Max', priceInr: '499.00', aiCreditsPerYear: 84, isPopular: false },
  ];
  for (const plan of plans) {
    await prisma.customerPremiumPlan.upsert({
      where: { id: plan.id },
      update: {
        name: plan.name,
        priceInr: plan.priceInr,
        aiCreditsPerYear: plan.aiCreditsPerYear,
        isPopular: plan.isPopular,
      },
      create: plan,
    });
  }
  log('\n[premium plans] basic/pro/max upserted.');
}

/**
 * DATABASE.md §CancellationPolicy: "V1 platform default (seeded row, salonId null)" with these
 * exact values. `salonId` is nullable-unique (Postgres allows multiple NULLs under a unique
 * constraint), so this can't be a Prisma `upsert` keyed on `salonId` — find-then-create instead,
 * and only ever do this once.
 */
async function seedPlatformDefaultCancellationPolicy(): Promise<void> {
  const existing = await prisma.cancellationPolicy.findFirst({ where: { salonId: null } });
  if (existing) {
    log('\n[cancellation policy] platform default row already exists — nothing to do.');
    return;
  }

  await prisma.cancellationPolicy.create({
    data: {
      salonId: null,
      freeCancellationWindowMinutes: 60,
      lateCancellationChargeType: ChargeType.PERCENTAGE,
      lateCancellationChargeValue: '50',
      noShowChargeType: ChargeType.PERCENTAGE,
      noShowChargeValue: '100',
      appointmentArrivalGraceMinutes: 10,
      queueCallResponseGraceMinutes: 3,
    },
  });
  log('\n[cancellation policy] seeded the platform default row (60 min free window, 50% late, 100% no-show).');
}

async function verify(): Promise<void> {
  const [
    admins,
    salons,
    staff,
    chairs,
    assignments,
    services,
    hours,
    customers,
    bookings,
    walkIns,
    sessions,
    reviews,
  ] = await Promise.all([
    prisma.userRole.count({ where: { role: Role.PLATFORM_ADMIN } }),
    prisma.salon.count({ where: { slug: SALON_SLUG } }),
    prisma.salonStaff.count(),
    prisma.chair.count(),
    prisma.staffChairAssignment.count(),
    prisma.service.count(),
    prisma.operatingHours.count(),
    prisma.userRole.count({ where: { role: Role.CUSTOMER } }),
    prisma.booking.count({ where: { status: BookingStatus.COMPLETED } }),
    prisma.queueEntry.count({ where: { source: QueueEntrySource.WALK_IN, status: QueueEntryStatus.COMPLETED } }),
    prisma.serviceSession.count({ where: { status: ServiceSessionStatus.COMPLETED } }),
    prisma.review.count(),
  ]);

  log(`
[verify] admin accounts (PLATFORM_ADMIN roles):     ${admins}
[verify] demo salons (slug="${SALON_SLUG}"):        ${salons}
[verify] salon staff rows:                          ${staff}
[verify] chairs:                                    ${chairs}
[verify] staff-chair assignments:                   ${assignments}
[verify] services:                                  ${services}
[verify] operating-hours rows:                       ${hours}
[verify] customer accounts (CUSTOMER roles):         ${customers}
[verify] completed bookings:                         ${bookings}
[verify] completed walk-in queue entries:            ${walkIns}
[verify] completed service sessions:                 ${sessions}
[verify] reviews:                                    ${reviews}
`);
}

async function main() {
  const { email: adminEmail } = await seedAdmin();
  await seedPremiumPlans();
  await seedPlatformDefaultCancellationPolicy();
  const ctx = await seedDemoSalon();
  if (ctx) {
    await seedVisitsAndReviews(ctx);
  }

  await verify();

  const finalCtx =
    ctx ??
    (await (async () => {
      // Demo salon already existed (idempotent re-run) — look up customer phones for the printout.
      const customers = await prisma.userRole.findMany({
        where: { role: Role.CUSTOMER },
        include: { user: true },
        take: 5,
      });
      return { customerPhones: customers.map((c) => c.user.phone).filter((p): p is string => !!p) };
    })());

  log(`
========================================================================
ADMIN LOGIN CREDENTIALS
  Email:    ${adminEmail}
  Password: (value of ADMIN_SEED_PASSWORD in apps/backend/.env — not re-printed here)
  2FA:      required — see the otpauth:// URI printed above on first seed

DEMO CUSTOMER PHONE NUMBERS (OTP login — check server console for the dev OTP code)
${finalCtx.customerPhones.map((p) => `  ${p}`).join('\n')}

DEMO OWNER / STAFF LOGIN (email + password, POST /api/v1/auth/staff/login)
  Owner:  owner@barbercue-demo.com / ${DEMO_PASSWORD}
  Marcus: marcus@barbercue-demo.com / ${DEMO_PASSWORD}
  Devon:  devon@barbercue-demo.com / ${DEMO_PASSWORD}
  Ray:    ray@barbercue-demo.com / ${DEMO_PASSWORD}
========================================================================
`);
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * TEMPORARY - physical-device certification data for the native arrival alert.
 *
 * Populates a DISPOSABLE staging database (never production) with one controlled test salon, an
 * owner, an assigned staff member, a second unassigned staff member, and on demand test appointments
 * shaped for the 12 arrival scenarios in NATIVE_ARRIVAL_ALERT.md. No real customer or financial data.
 *
 * Every command first runs assertCertificationDatabase: it refuses unless CERT_SEED_CONFIRM is typed
 * and the database contains nothing but certification rows, so it cannot run against production.
 *
 *   bootstrap-admin   fresh database only: the bare row migration 20260830215000 requires (no password)
 *   seed              salon + owner + assigned staff + other staff + policy; writes login credentials
 *                     to CERT_CREDENTIALS_FILE (never printed)
 *   appointment       a CONFIRMED appointment for a fresh test customer:
 *                       --in <minutes>          slot start relative to now (negative = already past)
 *                       --staff assigned|other|any   who the customer picked (default: assigned)
 *                       --multi                 two services instead of one
 *
 * Usage (from apps/backend, DATABASE_URL pointing at the certification database):
 *   CERT_SEED_CONFIRM=fastque-cert-temp npx ts-node --compiler-options {"module":"CommonJS"} prisma/seed-certification.ts <command> [flags]
 */
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  BookingSource,
  BookingStatus,
  ChargeType,
  Role,
  SalonStaffRole,
  SalonStatus,
  UserStatus,
} from '@barbercue/shared';
import { PasswordService } from '../src/auth/services/password.service';
import {
  CERT_EMAIL_DOMAIN,
  CERT_SALON_SLUG,
  MIGRATION_BOOTSTRAP_EMAIL,
  assertCertificationDatabase,
} from '../src/certification/certification-seed-guard';

const prisma = new PrismaClient();
const passwordService = new PasswordService();

const CITY_SLUG = 'bengaluru';
const email = (local: string): string => `${local}@${CERT_EMAIL_DOMAIN}`;

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function guard(): Promise<void> {
  const [salons, users] = await Promise.all([
    prisma.salon.findMany({ select: { slug: true }, take: 100 }),
    prisma.user.findMany({ select: { email: true, phone: true }, take: 1000 }),
  ]);
  assertCertificationDatabase(process.env.CERT_SEED_CONFIRM, {
    salonSlugs: salons.map((salon) => salon.slug),
    users,
  });
}

async function bootstrapAdmin(): Promise<void> {
  // Raw SQL on purpose: this runs while the migration history is only PARTLY applied (it stops at the
  // guard migration), so the generated Prisma client - which knows every later column - cannot be used.
  const inserted = await prisma.$executeRaw`
    INSERT INTO "users" ("id", "email", "status", "emailVerifiedAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${MIGRATION_BOOTSTRAP_EMAIL}, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("email") DO NOTHING`;
  log(
    inserted > 0
      ? 'bootstrap-admin: created the bare migration-guard row (no password, cannot sign in).'
      : 'bootstrap-admin: row already exists - nothing to do.',
  );
}

async function upsertLoginUser(local: string, password: string): Promise<string> {
  const passwordHash = await passwordService.hash(password);
  const user = await prisma.user.upsert({
    where: { email: email(local) },
    update: {},
    create: { email: email(local), passwordHash, status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
  });
  return user.id;
}

async function seed(): Promise<void> {
  const credentialsFile = process.env.CERT_CREDENTIALS_FILE;
  if (!credentialsFile) throw new Error('Set CERT_CREDENTIALS_FILE (a path outside the repository) for the generated logins.');

  const city =
    (await prisma.city.findFirst({ where: { countryCode: 'IN', slug: CITY_SLUG } })) ??
    (await prisma.city.create({
      data: { name: 'Bengaluru', slug: CITY_SLUG, countryCode: 'IN', state: 'Karnataka', country: 'India' },
    }));

  if (!(await prisma.cancellationPolicy.findFirst({ where: { salonId: null } }))) {
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
  }

  const existingSalon = await prisma.salon.findUnique({ where: { cityId_slug: { cityId: city.id, slug: CERT_SALON_SLUG } } });
  if (existingSalon) return log('seed: certification salon already exists - nothing to do (credentials unchanged).');

  const passwords = {
    owner: randomBytes(12).toString('base64url'),
    staffAssigned: randomBytes(12).toString('base64url'),
    staffOther: randomBytes(12).toString('base64url'),
  };
  const ownerId = await upsertLoginUser('cert-owner', passwords.owner);
  const staffAssignedUserId = await upsertLoginUser('cert-staff-assigned', passwords.staffAssigned);
  const staffOtherUserId = await upsertLoginUser('cert-staff-other', passwords.staffOther);

  const salon = await prisma.salon.create({
    data: {
      ownerUserId: ownerId,
      name: 'FastQue Certification Salon (test)',
      slug: CERT_SALON_SLUG,
      cityId: city.id,
      addressLine: 'Certification test address - not a real business',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      lat: 12.9716,
      lng: 77.6412,
      phone: '+910000000000',
      description: 'Temporary controlled salon for physical-device certification. Not a real business.',
      status: SalonStatus.ACTIVE,
    },
  });
  await prisma.userRole.create({ data: { userId: ownerId, role: Role.SALON_OWNER, salonId: salon.id } });

  for (const [userId, displayName] of [
    [staffAssignedUserId, 'Cert Barber A (assigned)'],
    [staffOtherUserId, 'Cert Barber B (other)'],
  ] as const) {
    await prisma.userRole.create({ data: { userId, role: Role.SALON_STAFF, salonId: salon.id } });
    await prisma.salonStaff.create({
      data: { salonId: salon.id, userId, displayName, roleInSalon: SalonStaffRole.BARBER, status: 'ACTIVE' },
    });
  }

  await prisma.service.createMany({
    data: [
      { salonId: salon.id, name: 'Cert Haircut', durationMinutes: 30, price: '100.00', category: 'Hair', isActive: true },
      { salonId: salon.id, name: 'Cert Beard Trim', durationMinutes: 15, price: '50.00', category: 'Beard', isActive: true },
    ],
  });
  await prisma.operatingHours.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      salonId: salon.id,
      dayOfWeek,
      openTime: '00:00',
      closeTime: '23:59',
      isClosed: false,
    })),
  });

  // Short grace + a small flat no-show charge so "Not arrived after grace" (scenario 12) is reachable in
  // minutes and its charge preview is visibly tiny and fictional.
  await prisma.cancellationPolicy.create({
    data: {
      salonId: salon.id,
      freeCancellationWindowMinutes: 60,
      lateCancellationChargeType: ChargeType.FLAT,
      lateCancellationChargeValue: '0',
      noShowChargeType: ChargeType.FLAT,
      noShowChargeValue: '50',
      appointmentArrivalGraceMinutes: 3,
      queueCallResponseGraceMinutes: 3,
    },
  });

  writeFileSync(
    credentialsFile,
    [
      'FastQue certification logins (TEMPORARY staging accounts - not production)',
      '',
      `Owner:            ${email('cert-owner')}   password: ${passwords.owner}`,
      `Staff (assigned): ${email('cert-staff-assigned')}   password: ${passwords.staffAssigned}`,
      `Staff (other):    ${email('cert-staff-other')}   password: ${passwords.staffOther}`,
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  );
  log('seed: created the certification salon, owner, assigned staff and other staff. Logins written to CERT_CREDENTIALS_FILE (not printed).');
}

async function appointment(): Promise<void> {
  const salon = await prisma.salon.findFirstOrThrow({ where: { slug: CERT_SALON_SLUG } });
  const services = await prisma.service.findMany({ where: { salonId: salon.id, isActive: true }, orderBy: { name: 'asc' } });
  const minutes = Number(flag('in') ?? '6');
  if (!Number.isFinite(minutes)) throw new Error('--in must be a number of minutes (negative = already past).');
  const staffChoice = flag('staff') ?? 'assigned';
  const staffRows = await prisma.salonStaff.findMany({ where: { salonId: salon.id }, orderBy: { displayName: 'asc' } });
  const preferredStaffId =
    staffChoice === 'any' ? null : (staffChoice === 'other' ? staffRows[1] : staffRows[0])?.id ?? null;
  const chosen = process.argv.includes('--multi') ? services : services.slice(0, 1);

  const suffix = randomBytes(4).toString('hex');
  const customer = await prisma.user.create({
    data: {
      email: email(`cert-customer-${suffix}`),
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      roles: { create: { role: Role.CUSTOMER } },
    },
  });
  const slotStart = new Date(Date.now() + minutes * 60_000);
  const totalMinutes = chosen.reduce((sum, service) => sum + service.durationMinutes, 0);
  const booking = await prisma.booking.create({
    data: {
      salonId: salon.id,
      customerId: customer.id,
      serviceId: chosen[0].id,
      slotStart,
      slotEnd: new Date(slotStart.getTime() + totalMinutes * 60_000),
      status: BookingStatus.CONFIRMED,
      source: BookingSource.APP,
      idempotencyKey: `cert-${Date.now()}-${suffix}`,
      preferredStaffId,
      services: {
        create: chosen.map((service, sortOrder) => ({
          serviceId: service.id,
          sortOrder,
          serviceName: service.name,
          durationMinutes: service.durationMinutes,
          price: service.price,
        })),
      },
    },
  });
  const alertAt = new Date(slotStart.getTime() - 5 * 60_000);
  log(
    [
      `appointment created: ${booking.id}`,
      `  slot start:  ${slotStart.toISOString()}`,
      `  staff:       ${staffChoice}`,
      `  services:    ${chosen.map((service) => service.name).join(' + ')}`,
      `  alert due:   ${alertAt.getTime() <= Date.now() ? 'now (next scheduler minute)' : alertAt.toISOString()}`,
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  await guard();
  if (command === 'bootstrap-admin') await bootstrapAdmin();
  else if (command === 'seed') await seed();
  else if (command === 'appointment') await appointment();
  else throw new Error('Usage: seed-certification.ts <bootstrap-admin|seed|appointment> [--in N] [--staff assigned|other|any] [--multi]');
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

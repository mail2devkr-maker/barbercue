/**
 * Ad-hoc test-data seed — creates 50 fully-functioning, publicly-visible shops ("Test Shop 1"
 * through "Test Shop 50") scattered 100m-5km from an existing real shop ("Handsome Center",
 * Hajipur, Bihar — 25.69971, 85.20942), so the owner can exercise search/discovery/booking/queue
 * flows against a realistic volume of shops instead of the current 2.
 *
 * ============================================================================================
 * PRODUCTION SAFETY GUARD — this script refuses to write anything unless the environment
 * variable ALLOW_TEST_SHOP_SEED is set to exactly "YES_I_UNDERSTAND". No default, no partial
 * match, no case-insensitive comparison. This check runs before any Prisma call whatsoever.
 * ============================================================================================
 *
 * Every shop gets: an owner account, 10 chairs, 10 barbers (with a staff-chair assignment for
 * today's shift, same convention as prisma/seed.ts's demo salon), a 5-item service menu, full
 * 7-day operating hours (matching Handsome Center's own 09:00-21:00), and a cover + 3 gallery
 * photos.
 *
 * Photos deliberately do NOT reuse apps/web/lib/editorial/manifest.ts's brand photography — that
 * manifest's own doc comment is explicit that those images must never be used to depict a specific
 * listed salon's premises (SalonImage.tsx's honest-empty-state contract exists precisely so a real
 * customer never mistakes stock photography for a real shop's actual storefront). Instead this uses
 * placehold.co-generated images with each shop's own name burned into the image text — visually
 * populated for UI testing, but nothing a customer could mistake for a real photo.
 *
 * IDENTIFICATION — every created row carries multiple independent, deterministic markers, all
 * defined once in prisma/test-shop-markers.ts (see delete-test-shops.ts's header for exactly
 * which ones deletion requires ALL of before it will touch a row):
 *   - Salon.slug matches ^test-shop-[1-9][0-9]*$ exactly (not just a "starts with" prefix)
 *   - Salon.description starts with the exact TEST_DATA_MARKER string
 *   - Salon.phone matches the exact synthetic pattern this script generates
 *   - Salon.cityId is the specific Hajipur city row this script resolves
 *   - owner/staff User.email matches an exact regex tying it to one specific candidate salon
 *   - every such User is additionally cross-checked as actually being that salon's owner or a
 *     SalonStaff row on that salon — an email pattern match alone is never sufficient
 *
 * IDEMPOTENCY — safe to re-run. Before writing anything, this reports how many of the 50 target
 * salons already exist. Any that do are left untouched and skipped (not duplicated); only the
 * missing ones (all 50 on a first run, a subset after an interrupted previous run) are created.
 *
 * CREDENTIALS — every owner/staff account gets its own cryptographically random password (never
 * a shared literal). Plaintext passwords are written ONLY to a local, gitignored file — never to
 * stdout/logs — so a CI log or terminal scrollback can never leak hundreds of production
 * credentials. See the printed file path after the script runs.
 *
 * Run with (from apps/backend):
 *   ALLOW_TEST_SHOP_SEED=YES_I_UNDERSTAND npm run seed:test-shops
 * Requires DATABASE_URL in the environment — point it at whichever database you want these 50
 * shops created in (this project's own package.json / railway env holds the production value;
 * nothing in this script hard-codes an environment).
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  ChairStatus,
  PhotoType,
  Role,
  SalonStaffRole,
  SalonStatus,
  StaffMemberStatus,
  UserStatus,
} from '@barbercue/shared';
import { PasswordService } from '../src/auth/services/password.service';
import { CITY_SLUG, EMAIL_DOMAIN, SALON_SLUG_PREFIX, TEST_DATA_MARKER, testShopPhone } from './test-shop-markers';

const REQUIRED_CONFIRMATION_VALUE = 'YES_I_UNDERSTAND';
const CONFIRMATION_ENV_VAR = 'ALLOW_TEST_SHOP_SEED';

const prisma = new PrismaClient();
const passwordService = new PasswordService();

const NUM_SHOPS = Number(process.env.SEED_TEST_SHOPS_COUNT ?? 50);
const CHAIRS_PER_SHOP = 10;
const BARBERS_PER_SHOP = 10;

// Handsome Center, Hajipur, Bihar (from its live public listing's JSON-LD).
const ORIGIN_LAT = 25.69971;
const ORIGIN_LNG = 85.20942;
const MIN_DISTANCE_M = 100;
const MAX_DISTANCE_M = 5000;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

/** A random point `minM`-`maxM` meters from (lat, lng), uniformly random bearing. */
function randomNearbyPoint(lat: number, lng: number, minM: number, maxM: number): { lat: number; lng: number } {
  const distance = minM + Math.random() * (maxM - minM);
  const bearing = Math.random() * 2 * Math.PI;
  const dLat = (distance * Math.cos(bearing)) / 111_320;
  const dLng = (distance * Math.sin(bearing)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

/** placehold.co image with the shop's own name burned into it — a placeholder, never mistaken for
 * a real photo, per the truth-boundary constraint in apps/web/lib/editorial/manifest.ts. */
function placeholderPhotoUrl(label: string, bg: string, fg: string, w = 900, h = 672): string {
  return `https://placehold.co/${w}x${h}/${bg}/${fg}?text=${encodeURIComponent(label)}&font=roboto`;
}

/** A random, URL-safe password — never a shared literal across accounts. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

const SERVICE_MENU = [
  { name: 'Haircut', durationMinutes: 30, price: '250.00', category: 'Hair' },
  { name: 'Beard Trim', durationMinutes: 15, price: '120.00', category: 'Beard' },
  { name: 'Haircut + Beard', durationMinutes: 40, price: '340.00', category: 'Combo' },
  { name: 'Hair Spa', durationMinutes: 45, price: '500.00', category: 'Spa' },
  { name: 'Head Massage', durationMinutes: 20, price: '180.00', category: 'Spa' },
];

// Matches Handsome Center's own published hours (09:00-21:00, every day).
const OPERATING_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  openTime: '09:00',
  closeTime: '21:00',
}));

interface CredentialRecord {
  role: 'owner' | 'staff';
  shopIndex: number;
  shopSlug: string;
  email: string;
  password: string;
}

async function findOrCreateCity(): Promise<{ id: string }> {
  const existing = await prisma.city.findFirst({ where: { countryCode: 'IN', slug: CITY_SLUG } });
  if (existing) return existing;
  // Shouldn't happen — Handsome Center already registered under this slug — but fall back safely.
  return prisma.city.create({
    data: { name: 'Hajipur', slug: CITY_SLUG, countryCode: 'IN', state: 'Bihar', country: 'India' },
  });
}

async function seedOneShop(index: number, cityId: string, credentials: CredentialRecord[]): Promise<'created' | 'skipped'> {
  const n = index + 1;
  const slug = `${SALON_SLUG_PREFIX}${n}`;

  const existing = await prisma.salon.findUnique({ where: { cityId_slug: { cityId, slug } } });
  if (existing) {
    return 'skipped';
  }

  const point = randomNearbyPoint(ORIGIN_LAT, ORIGIN_LNG, MIN_DISTANCE_M, MAX_DISTANCE_M);

  // --- Owner ---
  const ownerEmail = `owner+test-shop-${n}@${EMAIL_DOMAIN}`;
  const ownerPassword = generatePassword();
  const owner = await prisma.user.create({
    data: {
      email: ownerEmail,
      passwordHash: await passwordService.hash(ownerPassword),
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
  credentials.push({ role: 'owner', shopIndex: n, shopSlug: slug, email: ownerEmail, password: ownerPassword });

  // --- Salon ---
  const salon = await prisma.salon.create({
    data: {
      ownerUserId: owner.id,
      name: `Test Shop ${n}`,
      slug,
      cityId,
      addressLine: `Test Address ${n}, near Handsome Center, Hajipur`,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      lat: point.lat,
      lng: point.lng,
      phone: testShopPhone(n),
      description: `${TEST_DATA_MARKER} Test Shop ${n} — created for platform testing, safe to delete. See prisma/delete-test-shops.ts.`,
      status: SalonStatus.ACTIVE,
    },
  });

  await prisma.userRole.create({ data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id } });

  // --- Chairs ---
  const chairs = await Promise.all(
    Array.from({ length: CHAIRS_PER_SHOP }, (_, i) =>
      prisma.chair.create({ data: { salonId: salon.id, label: `Chair ${i + 1}`, status: ChairStatus.ACTIVE } }),
    ),
  );

  // --- Barbers ---
  const staffRows: { id: string }[] = [];
  for (let i = 0; i < BARBERS_PER_SHOP; i++) {
    const staffEmail = `barber${i + 1}+test-shop-${n}@${EMAIL_DOMAIN}`;
    const staffPassword = generatePassword();
    const staffUser = await prisma.user.create({
      data: {
        email: staffEmail,
        passwordHash: await passwordService.hash(staffPassword),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    credentials.push({ role: 'staff', shopIndex: n, shopSlug: slug, email: staffEmail, password: staffPassword });
    await prisma.userRole.create({ data: { userId: staffUser.id, role: Role.SALON_STAFF, salonId: salon.id } });
    const salonStaff = await prisma.salonStaff.create({
      data: {
        salonId: salon.id,
        userId: staffUser.id,
        displayName: `Barber ${i + 1}`,
        roleInSalon: SalonStaffRole.BARBER,
        status: StaffMemberStatus.ACTIVE,
      },
    });
    staffRows.push(salonStaff);
  }

  // --- Today's shift: each barber to their matching chair (10 barbers, 10 chairs — 1:1) ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const shiftFrom = new Date(today);
  shiftFrom.setHours(9, 0, 0, 0);
  const shiftUntil = new Date(today);
  shiftUntil.setHours(21, 0, 0, 0);
  await Promise.all(
    staffRows.map((staff, i) =>
      prisma.staffChairAssignment.create({
        data: {
          salonId: salon.id,
          staffId: staff.id,
          chairId: chairs[i].id,
          shiftDate: today,
          assignedFrom: shiftFrom,
          assignedUntil: shiftUntil,
        },
      }),
    ),
  );

  // --- Services ---
  await Promise.all(
    SERVICE_MENU.map((s) =>
      prisma.service.create({
        data: { salonId: salon.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price, category: s.category, isActive: true },
      }),
    ),
  );

  // --- Operating hours ---
  await Promise.all(
    OPERATING_HOURS.map((h) =>
      prisma.operatingHours.create({
        data: { salonId: salon.id, dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime, isClosed: false },
      }),
    ),
  );

  // --- Photos: 1 cover + 3 gallery, a distinct color per shop for visual variety ---
  const palette = ['1c1a17/fffdf9', 'b0413e/ffffff', 'a8791f/fffdf9', '2a2420/e9c77a'];
  const coverColor = palette[n % palette.length].split('/');
  await prisma.photo.create({
    data: {
      salonId: salon.id,
      url: placeholderPhotoUrl(`Test Shop ${n}`, coverColor[0], coverColor[1]),
      altText: `Test Shop ${n} placeholder cover photo — not a real premises photo`,
      type: PhotoType.COVER,
      sortOrder: 0,
    },
  });
  for (let i = 0; i < 3; i++) {
    const c = palette[(n + i + 1) % palette.length].split('/');
    await prisma.photo.create({
      data: {
        salonId: salon.id,
        url: placeholderPhotoUrl(`Test Shop ${n} · ${i + 1}`, c[0], c[1]),
        altText: `Test Shop ${n} placeholder gallery photo ${i + 1} — not a real premises photo`,
        type: PhotoType.GALLERY,
        sortOrder: i + 1,
      },
    });
  }

  log(`[test-shop-${n}] created — ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`);
  return 'created';
}

async function main() {
  // ---------- Production safety guard — checked first, before any Prisma call ----------
  if (process.env[CONFIRMATION_ENV_VAR] !== REQUIRED_CONFIRMATION_VALUE) {
    log(`
Refusing to run: this would write ${NUM_SHOPS} shops (and ~${NUM_SHOPS * (1 + BARBERS_PER_SHOP)} user
accounts, ~${NUM_SHOPS * CHAIRS_PER_SHOP} chairs, ~${NUM_SHOPS * SERVICE_MENU.length} services, and more)
to whatever database DATABASE_URL currently points at.

To proceed, re-run with:
  ${CONFIRMATION_ENV_VAR}=${REQUIRED_CONFIRMATION_VALUE} npm run seed:test-shops

No database connection has been made and nothing has been written.
`);
    process.exitCode = 1;
    return;
  }

  // ---------- Idempotency check — report up front, before writing anything ----------
  const city = await findOrCreateCity();
  const existingCount = await prisma.salon.count({
    where: { cityId: city.id, slug: { in: Array.from({ length: NUM_SHOPS }, (_, i) => `${SALON_SLUG_PREFIX}${i + 1}`) } },
  });
  if (existingCount === NUM_SHOPS) {
    log(`All ${NUM_SHOPS} test shops (${SALON_SLUG_PREFIX}1..${SALON_SLUG_PREFIX}${NUM_SHOPS}) already exist — nothing to do. Re-run prisma/delete-test-shops.ts first if you want to regenerate them.`);
    return;
  }
  if (existingCount > 0) {
    log(`${existingCount} of ${NUM_SHOPS} test shops already exist (likely from an interrupted previous run) — skipping those, creating the remaining ${NUM_SHOPS - existingCount}.`);
  }

  const credentials: CredentialRecord[] = [];
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < NUM_SHOPS; i++) {
    const result = await seedOneShop(i, city.id, credentials);
    if (result === 'created') created++;
    else skipped++;
  }

  const finalCount = await prisma.salon.count({ where: { cityId: city.id, slug: { startsWith: SALON_SLUG_PREFIX } } });
  log(`\n[verify] test shops with slug starting "${SALON_SLUG_PREFIX}": ${finalCount} / ${NUM_SHOPS} (created ${created} just now, ${skipped} already existed)`);

  // ---------- Credentials: written to a local, gitignored file — never to stdout/logs ----------
  if (credentials.length > 0) {
    const outPath = join(__dirname, '.test-shop-credentials.json');
    writeFileSync(outPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    log(`
${credentials.length} account credentials (all freshly generated, unique per account — never a
shared password) written to:
  ${outPath}
This file is gitignored and was never printed to this log. Delete it once you're done testing, or
just leave it — prisma/delete-test-shops.ts removes the accounts it describes from the database
regardless of whether this file still exists.
`);
  }
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

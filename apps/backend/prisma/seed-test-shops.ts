/**
 * Ad-hoc test-data seed — creates up to 50 fully-functioning, publicly-visible shops ("Test Shop
 * 1" through "Test Shop N") scattered 100m-5km from an existing real shop ("Handsome Center",
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
 *   - Salon.cityId is the specific, pre-existing Hajipur city row (this script never creates it)
 *   - owner/staff User.email matches an exact regex tying it to one specific candidate salon
 *   - every such User is additionally cross-checked as actually being that salon's owner or a
 *     SalonStaff row on that salon — an email pattern match alone is never sufficient
 *
 * ATOMICITY — each shop is created inside ONE Prisma interactive transaction (owner, salon, role,
 * 10 chairs, 10 staff + their roles + salon-staff rows, 10 shift assignments, 5 services, 7 hours,
 * 4 photos — everything). Either the whole shop commits, or none of it does. This closes two real
 * failure modes an earlier, non-transactional version had: (A) owner created, then a crash before
 * the salon existed, so a re-run's deterministic owner email hit a unique-constraint conflict on
 * retry; (B) owner+salon created, then a crash mid-way through chairs/staff/services/hours, so a
 * re-run saw the salon already existed and returned "skipped", permanently leaving an incomplete
 * shop in place. Password hashing (slow, CPU-bound bcrypt work) happens BEFORE the transaction
 * opens, not inside it — only the actual row writes run against the transaction client.
 *
 * IDEMPOTENCY — safe to re-run. Before writing anything, this reports how many of the target
 * salons already exist. Any that do are left untouched and skipped (not duplicated, not touched in
 * any way); only the missing ones (all of them on a first run, a subset after an interrupted
 * previous run) are created — each still atomically, per the paragraph above.
 *
 * CREDENTIALS — every owner/staff account gets its own cryptographically random password (never a
 * shared literal). The credential file is:
 *   - written incrementally, immediately after EACH shop's transaction commits — never batched
 *     until the end of the whole run — so a crash on shop 30 of 50 can never make shops 1-29's
 *     already-committed passwords unrecoverable.
 *   - written atomically (temp file + rename), so a crash mid-write can never leave a corrupt or
 *     partially-written JSON file behind.
 *   - never regenerated for a shop that already exists: if this script finds an existing Test Shop
 *     whose owner/staff credentials are NOT present in the local file, it FAILS LOUDLY rather than
 *     silently fabricating new passwords that would not match the already-stored password hash.
 *   - plaintext only ever goes to that local, gitignored file — never to stdout/logs.
 *
 * Run with (from apps/backend):
 *   ALLOW_TEST_SHOP_SEED=YES_I_UNDERSTAND npm run seed:test-shops
 * Optional: SEED_TEST_SHOPS_COUNT=<1-50> to seed fewer than the default 50 (validated — a
 * non-integer, or a value outside 1-50, is rejected before any database call).
 * Requires DATABASE_URL in the environment — point it at whichever database you want these shops
 * created in (this project's own package.json / railway env holds the production value; nothing
 * in this script hard-codes an environment).
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
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
const MAX_SHOPS = 50;
const DEFAULT_SHOPS = 50;

const prisma = new PrismaClient();
const passwordService = new PasswordService();

const CHAIRS_PER_SHOP = 10;
const BARBERS_PER_SHOP = 10;
const CREDENTIALS_PATH = join(__dirname, '.test-shop-credentials.json');

// Handsome Center, Hajipur, Bihar (from its live public listing's JSON-LD).
const ORIGIN_LAT = 25.69971;
const ORIGIN_LNG = 85.20942;
const MIN_DISTANCE_M = 100;
const MAX_DISTANCE_M = 5000;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

/** Validates SEED_TEST_SHOPS_COUNT before any database call: must be a finite integer, 1-50. */
function resolveShopCount(): number {
  const raw = process.env.SEED_TEST_SHOPS_COUNT;
  if (raw === undefined) return DEFAULT_SHOPS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SHOPS) {
    throw new Error(
      `Invalid SEED_TEST_SHOPS_COUNT="${raw}" — must be a finite integer between 1 and ${MAX_SHOPS} inclusive (${MAX_SHOPS} is this batch's intended production maximum).`,
    );
  }
  return parsed;
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

// ---------------------------------------------------------------------------------------------
// Credential file: incremental, atomic writes. Loaded once at startup; rewritten in full (but
// atomically) after every shop that newly commits, so the file on disk always exactly reflects
// what's actually in the database — never ahead of it, never behind it after a clean exit.
// ---------------------------------------------------------------------------------------------

function loadExistingCredentials(): CredentialRecord[] {
  if (!existsSync(CREDENTIALS_PATH)) return [];
  let raw: string;
  try {
    raw = readFileSync(CREDENTIALS_PATH, 'utf8');
  } catch (err) {
    throw new Error(`Could not read existing credentials file at ${CREDENTIALS_PATH}: ${String(err)}`);
  }
  try {
    return JSON.parse(raw) as CredentialRecord[];
  } catch (err) {
    throw new Error(
      `Existing credentials file at ${CREDENTIALS_PATH} is present but could not be parsed as JSON — refusing ` +
        `to proceed without being able to tell which accounts already have a recoverable password on file. ` +
        `Fix or remove that file (after confirming you don't need its contents) before re-running. ${String(err)}`,
    );
  }
}

/** Atomic: write to a temp file in the same directory, then rename over the real path. A crash
 * mid-write leaves the temp file orphaned but the real credentials file untouched and intact. */
function writeCredentialsAtomically(records: CredentialRecord[]): void {
  const tmpPath = `${CREDENTIALS_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(records, null, 2), { mode: 0o600 });
  renameSync(tmpPath, CREDENTIALS_PATH);
}

// ---------------------------------------------------------------------------------------------
// Test-only fault injection — a no-op unless SEED_TEST_SHOPS_INJECT_FAILURE_AT is set to one of
// the exact point names below AND SEED_TEST_SHOPS_INJECT_FAILURE_SHOP matches the shop currently
// being created. Used to prove the per-shop transaction actually rolls back completely on a crash
// at each of these points — never triggers in a normal run since both env vars default unset.
// ---------------------------------------------------------------------------------------------
type FaultPoint = 'after_owner' | 'after_salon' | 'mid_staff' | 'after_chairs_before_services' | 'before_commit';
const INJECT_FAULT_AT = process.env.SEED_TEST_SHOPS_INJECT_FAILURE_AT as FaultPoint | undefined;
const INJECT_FAULT_SHOP = Number(process.env.SEED_TEST_SHOPS_INJECT_FAILURE_SHOP ?? 1);

function maybeInjectFault(point: FaultPoint, shopIndex: number): void {
  if (INJECT_FAULT_AT === point && shopIndex === INJECT_FAULT_SHOP) {
    throw new Error(`[TEST-ONLY FAULT INJECTION] simulated crash at "${point}" for shop ${shopIndex}`);
  }
}

async function resolveRequiredCity(): Promise<{ id: string }> {
  const city = await prisma.city.findFirst({ where: { countryCode: 'IN', slug: CITY_SLUG } });
  if (!city) {
    throw new Error(
      `Required city not found (countryCode=IN, slug=${CITY_SLUG}). This test-data seed intentionally does ` +
        `NOT create reference geography — it only ever writes into the existing Hajipur setup. Resolve why ` +
        `that city row is missing before running this script.`,
    );
  }
  return city;
}

interface PreparedAccount {
  email: string;
  password: string;
  passwordHash: string;
}

async function prepareAccount(email: string): Promise<PreparedAccount> {
  const password = generatePassword();
  const passwordHash = await passwordService.hash(password);
  return { email, password, passwordHash };
}

/**
 * Creates one complete shop — owner, salon, role, chairs, staff, assignments, services, hours,
 * photos — inside a single interactive transaction. Returns the newly-created shop's credential
 * records on success (the caller is responsible for persisting them); throws (and Prisma rolls
 * back everything) on any failure, including an injected test fault.
 */
async function createShopAtomically(
  n: number,
  slug: string,
  cityId: string,
  ownerAccount: PreparedAccount,
  staffAccounts: PreparedAccount[],
): Promise<CredentialRecord[]> {
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const point = randomNearbyPoint(ORIGIN_LAT, ORIGIN_LNG, MIN_DISTANCE_M, MAX_DISTANCE_M);

      // --- Owner ---
      const owner = await tx.user.create({
        data: {
          email: ownerAccount.email,
          passwordHash: ownerAccount.passwordHash,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      maybeInjectFault('after_owner', n);

      // --- Salon ---
      const salon = await tx.salon.create({
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
      maybeInjectFault('after_salon', n);

      await tx.userRole.create({ data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id } });

      // --- Chairs (sequential — a single interactive-transaction connection should not be given
      // concurrent queries, so this deliberately awaits each one rather than Promise.all) ---
      const chairs: { id: string }[] = [];
      for (let i = 0; i < CHAIRS_PER_SHOP; i++) {
        chairs.push(await tx.chair.create({ data: { salonId: salon.id, label: `Chair ${i + 1}`, status: ChairStatus.ACTIVE } }));
      }
      maybeInjectFault('after_chairs_before_services', n);

      // --- Barbers ---
      const staffRows: { id: string }[] = [];
      for (let i = 0; i < staffAccounts.length; i++) {
        maybeInjectFault('mid_staff', n === INJECT_FAULT_SHOP && i === Math.floor(staffAccounts.length / 2) ? n : Number.NaN);
        const account = staffAccounts[i];
        const staffUser = await tx.user.create({
          data: {
            email: account.email,
            passwordHash: account.passwordHash,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
        await tx.userRole.create({ data: { userId: staffUser.id, role: Role.SALON_STAFF, salonId: salon.id } });
        staffRows.push(
          await tx.salonStaff.create({
            data: {
              salonId: salon.id,
              userId: staffUser.id,
              displayName: `Barber ${i + 1}`,
              roleInSalon: SalonStaffRole.BARBER,
              status: StaffMemberStatus.ACTIVE,
            },
          }),
        );
      }

      // --- Today's shift: each barber to their matching chair (1:1) ---
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const shiftFrom = new Date(today);
      shiftFrom.setHours(9, 0, 0, 0);
      const shiftUntil = new Date(today);
      shiftUntil.setHours(21, 0, 0, 0);
      for (let i = 0; i < staffRows.length; i++) {
        await tx.staffChairAssignment.create({
          data: {
            salonId: salon.id,
            staffId: staffRows[i].id,
            chairId: chairs[i].id,
            shiftDate: today,
            assignedFrom: shiftFrom,
            assignedUntil: shiftUntil,
          },
        });
      }

      // --- Services ---
      for (const s of SERVICE_MENU) {
        await tx.service.create({
          data: { salonId: salon.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price, category: s.category, isActive: true },
        });
      }

      // --- Operating hours ---
      for (const h of OPERATING_HOURS) {
        await tx.operatingHours.create({
          data: { salonId: salon.id, dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime, isClosed: false },
        });
      }

      // --- Photos: 1 cover + 3 gallery, a distinct color per shop for visual variety ---
      const palette = ['1c1a17/fffdf9', 'b0413e/ffffff', 'a8791f/fffdf9', '2a2420/e9c77a'];
      const coverColor = palette[n % palette.length].split('/');
      await tx.photo.create({
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
        await tx.photo.create({
          data: {
            salonId: salon.id,
            url: placeholderPhotoUrl(`Test Shop ${n} · ${i + 1}`, c[0], c[1]),
            altText: `Test Shop ${n} placeholder gallery photo ${i + 1} — not a real premises photo`,
            type: PhotoType.GALLERY,
            sortOrder: i + 1,
          },
        });
      }

      maybeInjectFault('before_commit', n);

      const records: CredentialRecord[] = [
        { role: 'owner', shopIndex: n, shopSlug: slug, email: ownerAccount.email, password: ownerAccount.password },
        ...staffAccounts.map((a, i): CredentialRecord => ({
          role: 'staff',
          shopIndex: n,
          shopSlug: slug,
          email: a.email,
          password: staffAccounts[i].password,
        })),
      ];
      return records;
    },
    // 69 writes per shop over a real network connection (production) needs real headroom — the
    // Prisma defaults (5s transaction timeout, 2s pool-wait) are sized for much smaller
    // transactions and would false-positive-timeout here.
    { maxWait: 10_000, timeout: 30_000 },
  );
}

async function seedOneShop(
  index: number,
  cityId: string,
  existingCredentialsByEmail: Map<string, string>,
): Promise<{ status: 'created'; records: CredentialRecord[] } | { status: 'skipped' }> {
  const n = index + 1;
  const slug = `${SALON_SLUG_PREFIX}${n}`;

  const existing = await prisma.salon.findUnique({ where: { cityId_slug: { cityId, slug } } });
  if (existing) {
    // Already in the database — verify every one of its accounts has a recoverable credential on
    // file before silently treating this as "nothing to do." Regenerating a password here would
    // produce a value that does not match the already-stored hash — worse than doing nothing.
    const ownerEmail = `owner+${slug}@${EMAIL_DOMAIN}`;
    const staffEmails = Array.from({ length: BARBERS_PER_SHOP }, (_, i) => `barber${i + 1}+${slug}@${EMAIL_DOMAIN}`);
    const missing = [ownerEmail, ...staffEmails].filter((e) => !existingCredentialsByEmail.has(e));
    if (missing.length > 0) {
      throw new Error(
        `${slug} already exists in the database, but ${missing.length} of its account(s) have no recoverable ` +
          `password in the local credentials file (${CREDENTIALS_PATH}): ${missing.join(', ')}. Refusing to ` +
          `fabricate new passwords that would not match the already-stored hash. Resolve manually (e.g. a ` +
          `password-reset flow, or delete+recreate just this shop via prisma/delete-test-shops.ts) before ` +
          `re-running this seed.`,
      );
    }
    return { status: 'skipped' };
  }

  // Prepare credentials + hash them BEFORE opening the transaction — bcrypt is slow, deliberately
  // kept off the transaction's clock (and its connection).
  const ownerAccount = await prepareAccount(`owner+${slug}@${EMAIL_DOMAIN}`);
  const staffAccounts: PreparedAccount[] = [];
  for (let i = 0; i < BARBERS_PER_SHOP; i++) {
    staffAccounts.push(await prepareAccount(`barber${i + 1}+${slug}@${EMAIL_DOMAIN}`));
  }

  const records = await createShopAtomically(n, slug, cityId, ownerAccount, staffAccounts);
  log(`[${slug}] created`);
  return { status: 'created', records };
}

async function main() {
  // ---------- Production safety guard — checked first, before any Prisma call ----------
  if (process.env[CONFIRMATION_ENV_VAR] !== REQUIRED_CONFIRMATION_VALUE) {
    log(`
Refusing to run: this would write up to ${DEFAULT_SHOPS} shops (and hundreds of user accounts,
chairs, and services) to whatever database DATABASE_URL currently points at.

To proceed, re-run with:
  ${CONFIRMATION_ENV_VAR}=${REQUIRED_CONFIRMATION_VALUE} npm run seed:test-shops

No database connection has been made and nothing has been written.
`);
    process.exitCode = 1;
    return;
  }

  // ---------- SEED_TEST_SHOPS_COUNT validation — before any Prisma call ----------
  const numShops = resolveShopCount();

  // ---------- City must already exist — this script never creates reference geography ----------
  const city = await resolveRequiredCity();

  // ---------- Idempotency check — report up front, before writing anything ----------
  // Deliberately NOT an early-return short-circuit when every target shop already exists: each
  // one must still go through seedOneShop's per-shop credential-recoverability check below (an
  // existing shop whose local credentials file entry is missing must FAIL LOUDLY, never be waved
  // through as "nothing to do").
  const existingCount = await prisma.salon.count({
    where: { cityId: city.id, slug: { in: Array.from({ length: numShops }, (_, i) => `${SALON_SLUG_PREFIX}${i + 1}`) } },
  });
  if (existingCount === numShops) {
    log(`All ${numShops} test shops (${SALON_SLUG_PREFIX}1..${SALON_SLUG_PREFIX}${numShops}) already exist — verifying each one's credentials are still recoverable before confirming there's nothing to do.`);
  } else if (existingCount > 0) {
    log(`${existingCount} of ${numShops} test shops already exist (likely from an interrupted previous run) — skipping those (after verifying their credentials are recoverable), creating the remaining ${numShops - existingCount}.`);
  }

  const existingRecords = loadExistingCredentials();
  const existingCredentialsByEmail = new Map(existingRecords.map((r) => [r.email, r.password]));
  const allRecords = [...existingRecords];

  let created = 0;
  let skipped = 0;
  for (let i = 0; i < numShops; i++) {
    const result = await seedOneShop(i, city.id, existingCredentialsByEmail);
    if (result.status === 'created') {
      created++;
      allRecords.push(...result.records);
      for (const r of result.records) existingCredentialsByEmail.set(r.email, r.password);
      // Written after EVERY shop, not batched until the loop ends — a crash on shop 30 of 50 must
      // never cost shops 1-29 their already-committed, already-generated passwords.
      writeCredentialsAtomically(allRecords);
    } else {
      skipped++;
    }
  }

  const finalCount = await prisma.salon.count({ where: { cityId: city.id, slug: { startsWith: SALON_SLUG_PREFIX } } });
  log(`\n[verify] test shops with slug starting "${SALON_SLUG_PREFIX}": ${finalCount} / ${numShops} (created ${created} just now, ${skipped} already existed)`);

  if (created > 0) {
    log(`
${created * (1 + BARBERS_PER_SHOP)} new account credential(s) written to:
  ${CREDENTIALS_PATH}
This file is gitignored and was never printed to this log. It now contains every account for
every test shop created across this run and any previous run — never overwritten with different
passwords for an already-existing account. Delete it once you're done testing (after also running
prisma/delete-test-shops.ts), or just leave it; the delete script removes the accounts it
describes from the database regardless of whether this file still exists.
`);
  }
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed — nothing for the shop in progress was committed (the whole thing runs in one transaction per shop), so re-running this script is safe and will retry it:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

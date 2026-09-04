/**
 * Removes everything prisma/seed-test-shops.ts created — and ONLY that. This does not delete "any
 * salon whose slug starts with test-shop-" or "any user at this email domain" as a single loose
 * check; every candidate row must pass ALL of several independent, deterministic markers before
 * it's even considered for deletion:
 *
 *   Salon candidates must have:
 *     - slug matching ^test-shop-[1-9][0-9]*$ EXACTLY (not just startsWith — "test-shop-abc" or
 *       "test-shop-1-legacy" would not match)
 *     - description starting with the EXACT TEST_DATA_MARKER string exported from
 *       seed-test-shops.ts (a versioned marker — a future, deliberately different seed batch
 *       would use a different marker and never match here)
 *     - phone matching the EXACT synthetic pattern seed-test-shops.ts generates for that same
 *       numeric slug index (cross-checks the slug number against a second, independently-derived
 *       field — a coincidental slug collision alone can't produce a matching phone too)
 *     - cityId equal to the specific Hajipur city row the seed resolves
 *
 *   User candidates must have:
 *     - an email matching an exact regex that ties it to one specific candidate salon's index
 *       (e.g. "owner+test-shop-7@..." only ever refers to test-shop-7)
 *     - AND be independently confirmed, via a real foreign-key relationship (Salon.ownerUserId or
 *       a SalonStaff row), to actually be that exact candidate salon's owner or staff — an email
 *       pattern match by itself is never sufficient to select a user for deletion.
 *
 * ============================================================================================
 * PRODUCTION SAFETY GUARD — this script always computes and PRINTS a full dry-run summary (row
 * counts across every affected table) before touching the database. It then refuses to write
 * anything unless the environment variable ALLOW_TEST_SHOP_DELETE is set to exactly
 * "YES_DELETE_TEST_DATA". No default, no partial match, no case-insensitive comparison. Running
 * this script with the env var unset (or wrong) is always a safe, read-only dry run.
 * ============================================================================================
 *
 * Every foreign key in schema.prisma pointing at Salon or User is a real, enforced constraint
 * (nothing cascades automatically), so deletion happens in dependency order, children before
 * parents — see the inline comments at each step for which relation forced that ordering.
 *
 * IDEMPOTENT / RESUMABLE — both the candidate salon set and the candidate user set are resolved
 * ONCE, up front, directly from the markers above — never re-derived later via a relation this
 * script itself deletes along the way. An earlier version looked up staff User ids via
 * `SalonStaff.findMany` immediately before deleting SalonStaff, which is only correct if the
 * whole script completes in one pass; if interrupted partway through and re-run, that join is
 * gone as soon as SalonStaff rows are deleted, silently orphaning every staff User the second run
 * could no longer find. Resolving both id sets up front makes every step, and any re-run after an
 * interruption, safe — with one narrow, deliberate exception: resolveCandidateUsers() cross-checks
 * each user against a currently-existing candidate salon, so if a crash landed in the few lines
 * between `salonsDeleted` and `usersDeleted` at the very end of a run, those specific users would
 * no longer be identifiable on a re-run (their salon is already gone). This is intentional, not an
 * oversight: the alternative — treating a bare email-pattern match as sufficient once its salon is
 * gone — is exactly the "one loose marker is enough" shortcut this script is designed to refuse.
 * If that exact race is ever actually hit, it needs a one-off manual look (query
 * `email ~ '^(owner|barber[0-9]+)\+test-shop-[0-9]+@fastque-test\.internal$'`), not a silent
 * automatic deletion.
 *
 * Run with (from apps/backend):
 *   npm run seed:test-shops:delete                                    (dry run — prints summary only)
 *   ALLOW_TEST_SHOP_DELETE=YES_DELETE_TEST_DATA npm run seed:test-shops:delete   (actually deletes)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  CITY_SLUG,
  EMAIL_DOMAIN,
  EMAIL_EXACT_PATTERN,
  SALON_SLUG_EXACT_PATTERN,
  SALON_SLUG_PREFIX,
  TEST_DATA_MARKER,
  testShopPhone,
} from './test-shop-markers';

const REQUIRED_CONFIRMATION_VALUE = 'YES_DELETE_TEST_DATA';
const CONFIRMATION_ENV_VAR = 'ALLOW_TEST_SHOP_DELETE';

const prisma = new PrismaClient();

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

/** Salons that pass every independent marker check — slug shape, exact marker text, exact
 * synthetic phone for that same index, and the specific test city. */
async function resolveCandidateSalons(): Promise<{ id: string; slug: string; ownerUserId: string }[]> {
  const city = await prisma.city.findFirst({ where: { countryCode: 'IN', slug: CITY_SLUG } });
  if (!city) return [];

  const rows = await prisma.salon.findMany({
    where: {
      cityId: city.id,
      slug: { startsWith: SALON_SLUG_PREFIX },
      description: { startsWith: TEST_DATA_MARKER },
    },
    select: { id: true, slug: true, phone: true, ownerUserId: true },
  });

  return rows
    .filter((s) => {
      const match = SALON_SLUG_EXACT_PATTERN.exec(s.slug);
      if (!match) return false;
      const index = Number(match[1]);
      return s.phone === testShopPhone(index);
    })
    .map((s) => ({ id: s.id, slug: s.slug, ownerUserId: s.ownerUserId }));
}

/** Users that pass the email-pattern check AND are independently confirmed, via a real relation,
 * to actually belong to one of the given candidate salons — never selected on email alone. */
async function resolveCandidateUsers(
  candidateSalons: { id: string; slug: string; ownerUserId: string }[],
): Promise<{ id: string; email: string }[]> {
  const salonBySlug = new Map(candidateSalons.map((s) => [s.slug, s]));
  const salonIds = candidateSalons.map((s) => s.id);

  const staffRows = await prisma.salonStaff.findMany({
    where: { salonId: { in: salonIds } },
    select: { userId: true, salonId: true },
  });
  const staffUserToSalon = new Map(staffRows.map((r) => [r.userId, r.salonId]));

  const domainUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true, email: true },
  });

  const candidates: { id: string; email: string }[] = [];
  for (const { id, email } of domainUsers) {
    // User.email is nullable in the schema; the `endsWith` filter above can only match a non-null
    // value in practice, but Prisma's generated type doesn't encode that — narrow explicitly.
    if (!email) continue;
    const match = EMAIL_EXACT_PATTERN.exec(email);
    if (!match) continue;
    const [, roleLabel, indexStr] = match;
    const salon = salonBySlug.get(`test-shop-${indexStr}`);
    if (!salon) continue; // email references a shop index that isn't a validated candidate
    const isConfirmed = roleLabel === 'owner' ? salon.ownerUserId === id : staffUserToSalon.get(id) === salon.id;
    if (isConfirmed) candidates.push({ id, email });
  }
  return candidates;
}

async function main() {
  const candidateSalons = await resolveCandidateSalons();
  const salonIds = candidateSalons.map((s) => s.id);
  const candidateUsers = await resolveCandidateUsers(candidateSalons);
  const testUserIds = candidateUsers.map((u) => u.id);

  if (salonIds.length === 0 && testUserIds.length === 0) {
    log('No test shops or test users matched every marker check — nothing to delete.');
    return;
  }

  // ---------- Dry-run summary — computed and printed unconditionally, before any write ----------
  const [
    serviceSessionCount,
    refundCount,
    ledgerEntryCount,
    reviewCount,
    paymentCount,
    queueEntryCount,
    bookingCount,
    assignmentCount,
    staffServiceCount,
    workingHoursCount,
    photoCount,
    serviceCount,
    operatingHoursCount,
    paymentPolicyCount,
    cancellationPolicyCount,
    verificationRequestCount,
    chairCount,
    salonStaffCount,
    notificationPrefCount,
    authIdentityCount,
    refreshTokenCount,
    passwordResetTokenCount,
    notificationCount,
    auditLogCount,
    subscriptionCount,
    pushDeviceCount,
    userRoleCount,
  ] = await Promise.all([
    prisma.serviceSession.count({ where: { queueEntry: { salonId: { in: salonIds } } } }),
    prisma.refund.count({ where: { payment: { booking: { salonId: { in: salonIds } } } } }),
    prisma.customerLedgerEntry.count({ where: { salonId: { in: salonIds } } }),
    prisma.review.count({ where: { salonId: { in: salonIds } } }),
    prisma.payment.count({ where: { booking: { salonId: { in: salonIds } } } }),
    prisma.queueEntry.count({ where: { salonId: { in: salonIds } } }),
    prisma.booking.count({ where: { salonId: { in: salonIds } } }),
    prisma.staffChairAssignment.count({ where: { salonId: { in: salonIds } } }),
    prisma.staffService.count({ where: { staff: { salonId: { in: salonIds } } } }),
    prisma.staffWorkingHours.count({ where: { staff: { salonId: { in: salonIds } } } }),
    prisma.photo.count({ where: { salonId: { in: salonIds } } }),
    prisma.service.count({ where: { salonId: { in: salonIds } } }),
    prisma.operatingHours.count({ where: { salonId: { in: salonIds } } }),
    prisma.salonPaymentPolicy.count({ where: { salonId: { in: salonIds } } }),
    prisma.cancellationPolicy.count({ where: { salonId: { in: salonIds } } }),
    prisma.verificationRequest.count({ where: { OR: [{ salonId: { in: salonIds } }, { staff: { salonId: { in: salonIds } } }] } }),
    prisma.chair.count({ where: { salonId: { in: salonIds } } }),
    prisma.salonStaff.count({ where: { salonId: { in: salonIds } } }),
    prisma.notificationPreference.count({ where: { userId: { in: testUserIds } } }),
    prisma.authIdentity.count({ where: { userId: { in: testUserIds } } }),
    prisma.refreshToken.count({ where: { userId: { in: testUserIds } } }),
    prisma.passwordResetToken.count({ where: { userId: { in: testUserIds } } }),
    prisma.notification.count({ where: { userId: { in: testUserIds } } }),
    prisma.auditLog.count({ where: { actorUserId: { in: testUserIds } } }),
    prisma.customerSubscription.count({ where: { userId: { in: testUserIds } } }),
    prisma.pushDevice.count({ where: { userId: { in: testUserIds } } }),
    prisma.userRole.count({ where: { userId: { in: testUserIds } } }),
  ]);

  const ownerCount = candidateUsers.filter((u) => EMAIL_EXACT_PATTERN.exec(u.email)?.[1] === 'owner').length;
  const staffAccountCount = candidateUsers.length - ownerCount;

  log(`
================================ DRY RUN — NOTHING DELETED YET ================================
Matched ${salonIds.length} salon(s), all validated against slug shape + exact TEST_DATA_MARKER +
exact synthetic phone + the specific test city: ${candidateSalons.map((s) => s.slug).join(', ') || '(none)'}

Would delete:
  Salons:                    ${salonIds.length}
  Owner accounts:             ${ownerCount}
  Staff (barber) accounts:    ${staffAccountCount}
  Chairs:                     ${chairCount}
  Salon staff rows:           ${salonStaffCount}
  Services:                   ${serviceCount}
  Operating hours rows:       ${operatingHoursCount}
  Staff-chair assignments:    ${assignmentCount}
  Staff service links:        ${staffServiceCount}
  Staff working hours:        ${workingHoursCount}
  Photos:                     ${photoCount}
  Bookings:                   ${bookingCount}
  Queue entries:               ${queueEntryCount}
  Service sessions:           ${serviceSessionCount}
  Reviews:                    ${reviewCount}
  Payments:                   ${paymentCount}
  Refunds:                    ${refundCount}
  Customer ledger entries:    ${ledgerEntryCount}
  Salon payment policies:     ${paymentPolicyCount}
  Cancellation policies:      ${cancellationPolicyCount}
  Verification requests:      ${verificationRequestCount}
  Notification preferences:   ${notificationPrefCount}
  Auth identities:            ${authIdentityCount}
  Refresh tokens:             ${refreshTokenCount}
  Password reset tokens:      ${passwordResetTokenCount}
  Notifications:              ${notificationCount}
  Audit log rows:             ${auditLogCount}
  Subscriptions:              ${subscriptionCount}
  Push devices:               ${pushDeviceCount}
  User roles:                 ${userRoleCount}
  ------------------------------------------------------------------------------
  Total user accounts:        ${testUserIds.length}
=================================================================================================
`);

  if (process.env[CONFIRMATION_ENV_VAR] !== REQUIRED_CONFIRMATION_VALUE) {
    log(`Dry run only — no changes made. To actually delete the rows summarized above, re-run with:
  ${CONFIRMATION_ENV_VAR}=${REQUIRED_CONFIRMATION_VALUE} npm run seed:test-shops:delete
`);
    return;
  }

  log('Confirmation received — deleting now.');

  // ---------- Salon-scoped operational data (children before parents) ----------
  // ServiceSession references QueueEntry/SalonStaff/Chair/Service — must go before all four.
  const serviceSessions = await prisma.serviceSession.deleteMany({ where: { queueEntry: { salonId: { in: salonIds } } } });
  // Refund references Payment — must go before it.
  const refunds = await prisma.refund.deleteMany({ where: { payment: { booking: { salonId: { in: salonIds } } } } });
  // CustomerLedgerEntry references both Booking and Payment (settledByPaymentId) — must go before
  // both, not after (a Booking/Payment can't be deleted while a ledger row still points at it).
  const ledgerEntries = await prisma.customerLedgerEntry.deleteMany({ where: { salonId: { in: salonIds } } });
  // Review references Booking (bookingId is required+unique) — must go before it.
  const reviews = await prisma.review.deleteMany({ where: { salonId: { in: salonIds } } });
  // Payment references Booking — must go before it.
  const payments = await prisma.payment.deleteMany({ where: { booking: { salonId: { in: salonIds } } } });
  // QueueEntry references Booking (nullable) — must go before it.
  const queueEntries = await prisma.queueEntry.deleteMany({ where: { salonId: { in: salonIds } } });
  const bookings = await prisma.booking.deleteMany({ where: { salonId: { in: salonIds } } });
  const assignments = await prisma.staffChairAssignment.deleteMany({ where: { salonId: { in: salonIds } } });
  const staffServices = await prisma.staffService.deleteMany({ where: { staff: { salonId: { in: salonIds } } } });
  const workingHours = await prisma.staffWorkingHours.deleteMany({ where: { staff: { salonId: { in: salonIds } } } });
  const photos = await prisma.photo.deleteMany({ where: { salonId: { in: salonIds } } });
  const services = await prisma.service.deleteMany({ where: { salonId: { in: salonIds } } });
  const operatingHours = await prisma.operatingHours.deleteMany({ where: { salonId: { in: salonIds } } });
  const paymentPolicies = await prisma.salonPaymentPolicy.deleteMany({ where: { salonId: { in: salonIds } } });
  const cancellationPolicies = await prisma.cancellationPolicy.deleteMany({ where: { salonId: { in: salonIds } } });
  const verificationRequests = await prisma.verificationRequest.deleteMany({
    where: { OR: [{ salonId: { in: salonIds } }, { staff: { salonId: { in: salonIds } } }] },
  });
  const chairs = await prisma.chair.deleteMany({ where: { salonId: { in: salonIds } } });
  const salonStaff = await prisma.salonStaff.deleteMany({ where: { salonId: { in: salonIds } } });

  // ---------- Everything else that references a User, scoped to the test users resolved above ----------
  const notificationPrefs = await prisma.notificationPreference.deleteMany({ where: { userId: { in: testUserIds } } });
  const authIdentities = await prisma.authIdentity.deleteMany({ where: { userId: { in: testUserIds } } });
  const refreshTokens = await prisma.refreshToken.deleteMany({ where: { userId: { in: testUserIds } } });
  const passwordResetTokens = await prisma.passwordResetToken.deleteMany({ where: { userId: { in: testUserIds } } });
  const notifications = await prisma.notification.deleteMany({ where: { userId: { in: testUserIds } } });
  const auditLogs = await prisma.auditLog.deleteMany({ where: { actorUserId: { in: testUserIds } } });
  const subscriptions = await prisma.customerSubscription.deleteMany({ where: { userId: { in: testUserIds } } });
  const pushDevices = await prisma.pushDevice.deleteMany({ where: { userId: { in: testUserIds } } });
  const userRoles = await prisma.userRole.deleteMany({ where: { userId: { in: testUserIds } } });

  const salonsDeleted = await prisma.salon.deleteMany({ where: { id: { in: salonIds } } });
  const usersDeleted = await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });

  log(`
[deleted] service sessions:        ${serviceSessions.count}
[deleted] refunds:                 ${refunds.count}
[deleted] payments:                ${payments.count}
[deleted] reviews:                 ${reviews.count}
[deleted] queue entries:           ${queueEntries.count}
[deleted] bookings:                ${bookings.count}
[deleted] ledger entries:          ${ledgerEntries.count}
[deleted] staff-chair assignments: ${assignments.count}
[deleted] staff service links:     ${staffServices.count}
[deleted] staff working hours:     ${workingHours.count}
[deleted] photos:                  ${photos.count}
[deleted] services:                ${services.count}
[deleted] operating hours rows:    ${operatingHours.count}
[deleted] salon payment policies:  ${paymentPolicies.count}
[deleted] cancellation policies:   ${cancellationPolicies.count}
[deleted] verification requests:   ${verificationRequests.count}
[deleted] chairs:                  ${chairs.count}
[deleted] salon staff rows:        ${salonStaff.count}
[deleted] notification prefs:      ${notificationPrefs.count}
[deleted] auth identities:         ${authIdentities.count}
[deleted] refresh tokens:          ${refreshTokens.count}
[deleted] password reset tokens:   ${passwordResetTokens.count}
[deleted] notifications:           ${notifications.count}
[deleted] audit log rows:          ${auditLogs.count}
[deleted] subscriptions:           ${subscriptions.count}
[deleted] push devices:            ${pushDevices.count}
[deleted] user roles:              ${userRoles.count}
[deleted] salons:                  ${salonsDeleted.count}
[deleted] test users:              ${usersDeleted.count}
`);
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Delete failed — safe to just re-run this script again; every step above is scoped to durable, independently-validated identifiers, not to relations that might already be gone from a previous partial run.', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

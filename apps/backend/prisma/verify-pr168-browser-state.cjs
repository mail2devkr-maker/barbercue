const { readFileSync, appendFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');

const fixturePath = process.env.PR168_BROWSER_FIXTURE_FILE;
const resultPath = process.env.PR168_BROWSER_RESULT_FILE;
const manifestPath = process.env.PR168_FIXTURE_MANIFEST;
if (!fixturePath || !resultPath || !manifestPath) {
  throw new Error(
    'Disposable PR #168 browser verification files are required.',
  );
}

const databaseUrl = new URL(process.env.DATABASE_URL || '');
if (
  databaseUrl.hostname !== '127.0.0.1' ||
  databaseUrl.pathname !== '/fastque_ci'
) {
  throw new Error(
    'Browser state verification requires the disposable loopback fastque_ci database.',
  );
}

const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (
  fixtures.version !== 1 ||
  result.version !== 1 ||
  result.shopId !== fixtures.shop.id ||
  typeof result.requestId !== 'string' ||
  result.assertionCount < 1
) {
  throw new Error(
    'Browser certification result did not match its synthetic fixture.',
  );
}

const prisma = new PrismaClient();
let checks = 0;
function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

async function main() {
  const [
    shop,
    request,
    expiredShop,
    audit,
    booking,
    payment,
    refund,
    ledger,
    subsidy,
  ] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: fixtures.shop.id },
      select: {
        id: true,
        publicId: true,
        name: true,
        status: true,
        softDeletedAt: true,
        restoreEligibleUntil: true,
        softDeletionRequestId: true,
        statusBeforeSoftDelete: true,
      },
    }),
    prisma.shopDeletionRequest.findUnique({
      where: { id: result.requestId },
    }),
    prisma.salon.findUnique({
      where: { id: fixtures.expiredShop.id },
      select: { id: true, softDeletedAt: true, restoreEligibleUntil: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: 'Salon', entityId: fixtures.shop.id },
      select: { action: true, actorUserId: true, metadata: true },
    }),
    prisma.booking.findUnique({
      where: { id: fixtures.history.bookingId },
      select: { id: true, salonId: true, status: true },
    }),
    prisma.payment.findUnique({
      where: { id: fixtures.history.paymentId },
      select: { id: true, bookingId: true, status: true },
    }),
    prisma.refund.findUnique({
      where: { id: fixtures.history.refundId },
      select: { id: true, paymentId: true, status: true },
    }),
    prisma.customerLedgerEntry.findUnique({
      where: { id: fixtures.history.ledgerId },
      select: { id: true, salonId: true, status: true },
    }),
    prisma.platformShopSubsidyEntry.findUnique({
      where: { id: fixtures.history.subsidyId },
      select: { id: true, salonId: true, status: true },
    }),
  ]);

  assert(shop !== null, 'Browser-tested shop was permanently deleted.');
  assert(
    shop.id === fixtures.shop.id &&
      shop.publicId === fixtures.shop.publicId &&
      shop.name === fixtures.shop.name,
    'Restored shop identity changed.',
  );
  assert(
    shop.status === 'ACTIVE' &&
      shop.softDeletedAt === null &&
      shop.restoreEligibleUntil === null &&
      shop.softDeletionRequestId === null,
    'Browser-tested shop did not finish in its original active state.',
  );
  assert(
    request !== null,
    'Browser-created deletion request was not persisted.',
  );
  assert(
    request.status === 'APPROVED' &&
      request.salonId === shop.id &&
      request.requestedByUserId === fixtures.accounts.coFounder.id &&
      request.decidedByUserId === fixtures.accounts.superAdmin.id,
    'Deletion request does not show the expected requester and Super Admin decision.',
  );
  assert(
    request.reason ===
      'Synthetic browser certification request; no shop data is deleted.',
    'Persisted deletion reason does not match the UI submission.',
  );
  const actions = new Set(audit.map((entry) => entry.action));
  for (const action of [
    'SHOP_DELETE_REQUESTED',
    'SHOP_DELETE_APPROVED',
    'SHOP_SOFT_DELETED',
    'SHOP_DELETE_RESTORED',
  ]) {
    assert(actions.has(action), `Missing durable ${action} audit event.`);
  }
  assert(
    audit.some(
      (entry) =>
        entry.action === 'SHOP_DELETE_REQUESTED' &&
        entry.actorUserId === fixtures.accounts.coFounder.id,
    ),
    'Request audit event is not attributed to the Co-Founder.',
  );
  assert(
    audit.some(
      (entry) =>
        entry.action === 'SHOP_DELETE_APPROVED' &&
        entry.actorUserId === fixtures.accounts.superAdmin.id,
    ) &&
      audit.some(
        (entry) =>
          entry.action === 'SHOP_DELETE_RESTORED' &&
          entry.actorUserId === fixtures.accounts.superAdmin.id,
      ),
    'Approval/restoration audit events are not attributed to the Super Admin.',
  );
  assert(
    audit.every((entry) => {
      const serialized = JSON.stringify(entry.metadata ?? {});
      return !/(password|totp|token|secret|credential)/i.test(serialized);
    }),
    'A recovery audit event contains credential-like metadata.',
  );
  assert(
    expiredShop?.softDeletedAt instanceof Date &&
      expiredShop.restoreEligibleUntil instanceof Date &&
      expiredShop.restoreEligibleUntil.getTime() <=
        Number(readFileSync(process.env.PR168_TEST_CLOCK_FILE, 'utf8')),
    'Expired browser fixture was removed or became restorable again.',
  );
  assert(
    booking?.salonId === shop.id &&
      booking.status === 'COMPLETED' &&
      payment?.bookingId === booking.id &&
      payment.status === 'SUCCESS' &&
      refund?.paymentId === payment.id &&
      refund.status === 'FAILED' &&
      ledger?.salonId === shop.id &&
      ledger.status === 'SETTLED' &&
      subsidy?.salonId === shop.id &&
      subsidy.status === 'SETTLED',
    'Historical booking, payment, refund, ledger or subsidy data was changed or lost.',
  );
  assert(
    manifest.financial.some(
      (entry) => entry.bookingId === fixtures.history.bookingId,
    ),
    'Browser history fixture is not part of the certified recovery manifest.',
  );
  const pendingRequests = await prisma.shopDeletionRequest.count({
    where: { salonId: shop.id, status: 'PENDING' },
  });
  assert(
    pendingRequests === 0,
    'A duplicate pending request remains after approval.',
  );

  console.log(
    `PASS: ${checks} PostgreSQL state assertions confirm browser-driven approval, reversible quarantine, restoration, audit attribution and historical record preservation.`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Post-browser PostgreSQL cross-check: **${checks}/${checks} assertions passed**; the shop identity and historical financial rows remain intact, and request/approval/quarantine/restore audit events are present.\n`,
    );
  }
}

main()
  .catch((error) => {
    console.error(
      `PR #168 browser database verification failed: ${error instanceof Error ? error.message : 'unexpected verification failure'}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

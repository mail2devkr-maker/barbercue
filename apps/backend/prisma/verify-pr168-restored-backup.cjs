const { createHash } = require('node:crypto');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const recoveryMigration = '20261008180000_recoverable_shop_deletion';
const bootstrapMigration = '20260830215000_ensure_primary_platform_admin';
const migrationsDir = path.join(__dirname, 'migrations');
const triggerNames = [
  'salons_quarantine_update_guard',
  'salons_hard_delete_guard',
  'bookings_quarantine_insert_guard',
  'queue_entries_quarantine_insert_guard',
  'manual_chair_occupancies_quarantine_insert_guard',
  'service_sessions_quarantine_insert_guard',
  'bookings_quarantine_write_guard',
  'queue_entries_quarantine_write_guard',
  'manual_chair_occupancies_quarantine_write_guard',
  'service_sessions_quarantine_write_guard',
  'payments_quarantine_write_guard',
  'refunds_quarantine_write_guard',
  'customer_ledger_quarantine_write_guard',
  'platform_subsidy_quarantine_write_guard',
  'salons_quarantine_obligations_guard',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL || '');
  assert(
    databaseUrl.hostname === '127.0.0.1' &&
      databaseUrl.pathname === '/fastque_ci_restore',
    'Backup certification requires the isolated loopback fastque_ci_restore database.',
  );
  const manifestPath = process.env.PR168_FIXTURE_MANIFEST;
  assert(
    manifestPath,
    'Restored backup verification manifest is not configured.',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert(
    manifest.version === 1,
    'Restored backup fixture manifest version is unsupported.',
  );
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name IS NOT NULL
    `;
    const migrationNames = (
      await readdir(migrationsDir, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = rows.filter(
      (row) => row.finished_at && !row.rolled_back_at,
    );
    assert(
      applied.length === migrationNames.length,
      'Restored backup migration history count does not match committed migrations.',
    );
    for (const name of migrationNames) {
      const sql = await readFile(
        path.join(migrationsDir, name, 'migration.sql'),
      );
      const checksum = createHash('sha256').update(sql).digest('hex');
      assert(
        applied.filter(
          (row) => row.migration_name === name && row.checksum === checksum,
        ).length === 1,
        `Restored backup has a missing or mismatched migration checksum (${name}).`,
      );
    }
    const rollbackRows = rows.filter((row) => row.rolled_back_at);
    assert(
      rollbackRows.length <= 1 &&
        rollbackRows.every((row) => row.migration_name === bootstrapMigration),
      'Restored backup contains an unexpected failed/rolled-back migration.',
    );
    assert(
      applied.some((row) => row.migration_name === recoveryMigration),
      'Recovery migration is not recorded as applied in the restored backup.',
    );

    const allTriggers = await prisma.$queryRaw`
      SELECT t.tgname::text AS name, t.tgenabled AS enabled, t.tgdeferrable AS deferrable, t.tginitdeferred AS initially_deferred
      FROM pg_trigger t
      WHERE NOT t.tgisinternal
    `;
    const triggers = allTriggers.filter((trigger) =>
      triggerNames.includes(trigger.name),
    );
    assert(
      triggers.length === triggerNames.length,
      'Restored backup is missing one or more recovery triggers.',
    );
    assert(
      triggers.every((trigger) => ['O', 'A'].includes(trigger.enabled)),
      'One or more restored recovery triggers are disabled.',
    );
    const obligations = triggers.find(
      (trigger) => trigger.name === 'salons_quarantine_obligations_guard',
    );
    assert(
      obligations?.deferrable && obligations.initially_deferred,
      'Restored deferred obligation trigger lost its deferrable/deferred properties.',
    );

    const salonRows = await prisma.salon.findMany({
      where: { id: { in: manifest.salonIds } },
      select: {
        id: true,
        status: true,
        softDeletedAt: true,
        restoreEligibleUntil: true,
        publicId: true,
      },
    });
    assert(
      salonRows.length === manifest.salonIds.length,
      'One or more synthetic shops are missing from the restored backup.',
    );
    const salonById = new Map(salonRows.map((salon) => [salon.id, salon]));
    assert(
      salonById.get(manifest.activeRestoredShopId)?.status === 'ACTIVE' &&
        salonById.get(manifest.activeRestoredShopId)?.softDeletedAt === null,
      'Restored active shop state is incorrect in the backup.',
    );
    assert(
      salonById.get(manifest.suspendedShopId)?.status === 'SUSPENDED' &&
        salonById.get(manifest.suspendedShopId)?.softDeletedAt === null,
      'Restored previously suspended shop state is incorrect in the backup.',
    );
    for (const boundary of [manifest.deadline.equal, manifest.deadline.after]) {
      const salon = salonById.get(boundary.salonId);
      assert(
        salon?.softDeletedAt instanceof Date &&
          salon.restoreEligibleUntil?.getTime() ===
            boundary.restoreEligibleUntil,
        'Expired boundary shop/quarantine deadline was not preserved in the backup.',
      );
    }

    const requests = await prisma.shopDeletionRequest.findMany({
      where: { id: { in: manifest.requestIds } },
      select: { id: true, status: true, salonId: true, decidedAt: true },
    });
    assert(
      requests.length === manifest.requestIds.length,
      'One or more request/audit source rows are missing in the backup.',
    );
    assert(
      requests.some(
        (request) =>
          request.id === manifest.mainRequestId &&
          request.status === 'APPROVED' &&
          request.decidedAt,
      ),
      'Approved request state is missing in the backup.',
    );

    for (const history of manifest.financial) {
      const [booking, payment, refund, ledger, subsidy] = await Promise.all([
        prisma.booking.findUnique({
          where: { id: history.bookingId },
          select: { id: true, salonId: true, status: true },
        }),
        prisma.payment.findUnique({
          where: { id: history.paymentId },
          select: { id: true, bookingId: true, status: true },
        }),
        prisma.refund.findUnique({
          where: { id: history.refundId },
          select: { id: true, paymentId: true, status: true },
        }),
        prisma.customerLedgerEntry.findUnique({
          where: { id: history.ledgerId },
          select: { id: true, salonId: true, bookingId: true, status: true },
        }),
        prisma.platformShopSubsidyEntry.findUnique({
          where: { id: history.subsidyId },
          select: { id: true, salonId: true, bookingId: true, status: true },
        }),
      ]);
      assert(
        booking?.salonId === manifest.historyShopId &&
          booking.status === 'COMPLETED' &&
          payment?.bookingId === booking.id &&
          payment.status === 'SUCCESS' &&
          refund?.paymentId === payment.id &&
          refund.status === 'FAILED' &&
          ledger?.salonId === manifest.historyShopId &&
          ledger.bookingId === booking.id &&
          ledger.status === 'SETTLED' &&
          subsidy?.salonId === manifest.historyShopId &&
          subsidy.bookingId === booking.id &&
          subsidy.status === 'SETTLED',
        'Historical booking/payment/refund/ledger/subsidy state or relationships changed in the restored backup.',
      );
    }
    const auditCount = await prisma.auditLog.count({
      where: {
        entityId: manifest.historyShopId,
        action: {
          in: [
            'SHOP_DELETE_REQUESTED',
            'SHOP_SOFT_DELETED',
            'SHOP_DELETE_APPROVED',
            'SHOP_DELETE_RESTORED',
          ],
        },
      },
    });
    assert(
      auditCount === 4,
      'Request/quarantine/approval/restore audit history is incomplete in the restored backup.',
    );
    console.log(
      `PASS: disposable pg_dump/pg_restore preserved ${salonRows.length} synthetic shops, ${requests.length} recovery requests, completed migration history/checksums, enabled deferred guards, and booking/payment/refund/ledger/subsidy/audit evidence.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const safeMessage =
    typeof error?.message === 'string' &&
    !/postgres(?:ql)?:|password|token|secret|credential/i.test(error.message)
      ? error.message
      : `unexpected backup verification failure (${typeof error?.code === 'string' ? error.code : 'details withheld'})`;
  console.error(`PR #168 restored backup verification failed: ${safeMessage}`);
  process.exitCode = 1;
});

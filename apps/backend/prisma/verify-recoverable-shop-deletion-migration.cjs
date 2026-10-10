const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  BookingSource,
  BookingStatus,
  LedgerReason,
  LedgerStatus,
  PaymentStatus,
  PaymentType,
  PrismaClient,
  QueueEntrySource,
  RefundStatus,
  SubsidyLedgerStatus,
} = require('@prisma/client');

const migrationName = '20261008180000_recoverable_shop_deletion';
const migrationPath = path.join(__dirname, 'migrations', migrationName, 'migration.sql');
const expectedTriggers = [
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

async function main() {
  const sql = await readFile(migrationPath, 'utf8');
  if (/^\s*(?:DROP\s+(?:TABLE|COLUMN|TYPE|FUNCTION|TRIGGER)|TRUNCATE\b|DELETE\s+FROM\s+"salons")/im.test(sql)) {
    throw new Error('Recovery migration contains a destructive statement.');
  }

  const sourceChecksum = createHash('sha256').update(sql).digest('hex');
  const prisma = new PrismaClient();
  try {
    const migrationRows = await prisma.$queryRaw`
      SELECT migration_name, checksum
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName} AND rolled_back_at IS NULL
    `;
    if (migrationRows.length !== 1 || migrationRows[0].checksum !== sourceChecksum) {
      throw new Error('Applied recovery migration checksum does not match the committed SQL file.');
    }

    const placeholders = expectedTriggers.map((_, index) => `$${index + 1}`).join(', ');
    const triggers = await prisma.$queryRawUnsafe(
      `SELECT t.tgname AS name, t.tgenabled AS enabled, t.tgdeferrable AS deferrable, ` +
        `t.tginitdeferred AS initially_deferred, t.tgrelid::regclass::text AS table_name, ` +
        `pg_get_triggerdef(t.oid) AS definition, pg_get_functiondef(t.tgfoid) AS function_definition ` +
        `FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN (${placeholders})`,
      ...expectedTriggers,
    );
    const triggerMap = new Map(triggers.map((trigger) => [trigger.name, trigger]));
    const missingOrDisabled = expectedTriggers.filter((name) => {
      const trigger = triggerMap.get(name);
      return !trigger || !['O', 'A'].includes(trigger.enabled);
    });
    if (missingOrDisabled.length) {
      throw new Error(`Missing or disabled recovery triggers: ${missingOrDisabled.join(', ')}`);
    }
    const obligationsTrigger = triggerMap.get('salons_quarantine_obligations_guard');
    if (!obligationsTrigger.deferrable || !obligationsTrigger.initially_deferred) {
      throw new Error('Open-obligations guard is not an enabled, initially deferred constraint trigger.');
    }
    const expectedTriggerTables = {
      salons_quarantine_update_guard: 'salons',
      salons_hard_delete_guard: 'salons',
      bookings_quarantine_insert_guard: 'bookings',
      queue_entries_quarantine_insert_guard: 'queue_entries',
      manual_chair_occupancies_quarantine_insert_guard: 'manual_chair_occupancies',
      service_sessions_quarantine_insert_guard: 'service_sessions',
      bookings_quarantine_write_guard: 'bookings',
      queue_entries_quarantine_write_guard: 'queue_entries',
      manual_chair_occupancies_quarantine_write_guard: 'manual_chair_occupancies',
      service_sessions_quarantine_write_guard: 'service_sessions',
      payments_quarantine_write_guard: 'payments',
      refunds_quarantine_write_guard: 'refunds',
      customer_ledger_quarantine_write_guard: 'customer_ledger_entries',
      platform_subsidy_quarantine_write_guard: 'platform_shop_subsidy_entries',
      salons_quarantine_obligations_guard: 'salons',
    };
    for (const [name, table] of Object.entries(expectedTriggerTables)) {
      if (triggerMap.get(name).table_name !== table) {
        throw new Error(`Recovery trigger ${name} is attached to the wrong table.`);
      }
    }
    const relatedWriteFunction = triggerMap.get('payments_quarantine_write_guard').function_definition;
    for (const fragment of [
      'bookings', 'queue_entries', 'service_sessions', 'payments', 'refunds',
      'customer_ledger_entries', 'platform_shop_subsidy_entries', 'FOR SHARE', 'SHOP_QUARANTINED',
    ]) {
      if (!relatedWriteFunction.includes(fragment)) {
        throw new Error(`Related-write trigger definition is missing ${fragment}.`);
      }
    }

    const constraints = await prisma.$queryRaw`
      SELECT conname, contype, convalidated
      FROM pg_constraint
      WHERE conrelid = 'salons'::regclass AND conname = 'salons_soft_deletion_state_check'
    `;
    if (constraints.length !== 1 || constraints[0].contype !== 'c' || !constraints[0].convalidated) {
      throw new Error('Validated salon quarantine-state check constraint is missing.');
    }

    const columns = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'salons'
        AND column_name IN (
          'softDeletedAt', 'restoreEligibleUntil', 'softDeletedByUserId',
          'softDeletionRequestId', 'statusBeforeSoftDelete'
        )
    `;
    if (columns.length !== 5) throw new Error('One or more recovery columns are missing.');

    const indexes = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'salons'
        AND indexname IN (
          'salons_softDeletedAt_restoreEligibleUntil_idx',
          'salons_softDeletionRequestId_idx'
        )
    `;
    if (indexes.length !== 2) throw new Error('Recovery lookup indexes are missing.');

    const hardDeleteFunction = await prisma.$queryRaw`
      SELECT pg_get_functiondef('deny_salon_hard_delete()'::regprocedure) AS definition
    `;
    if (!hardDeleteFunction[0].definition.includes('SALON_HARD_DELETE_DISABLED')) {
      throw new Error('Hard-delete trigger does not fail closed.');
    }
    const obligationsFunction = await prisma.$queryRaw`
      SELECT pg_get_functiondef('assert_no_open_salon_obligations_on_quarantine()'::regprocedure) AS definition
    `;
    if (!obligationsFunction[0].definition.includes('SHOP_HAS_OPEN_OBLIGATIONS')) {
      throw new Error('Deferred financial/operational obligation trigger is missing its rejection.');
    }

    await verifyRuntimeGuards(prisma);
    console.log(
      `PASS: ${migrationName} applied checksum ${sourceChecksum}; ` +
        `${expectedTriggers.length} recovery triggers enabled; state constraint, indexes, ` +
        'quarantine/restore preservation, financial guards, and hard-delete denial verified.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyRuntimeGuards(prisma) {
  const suffix = randomUUID().replaceAll('-', '');
  const owner = await prisma.user.create({
    data: { email: `pr168-owner-${suffix}@example.invalid` },
  });
  const customer = await prisma.user.create({
    data: { email: `pr168-customer-${suffix}@example.invalid` },
  });
  const city = await prisma.city.create({
    data: {
      name: `PR168 Certification ${suffix}`,
      slug: `pr168-cert-${suffix}`,
      countryCode: 'ZZ',
      state: 'Disposable',
      country: 'Disposable',
    },
  });
  const salon = await prisma.salon.create({
    data: {
      publicId: `BC-SHOP-CERT-${suffix}`,
      ownerUserId: owner.id,
      name: 'Disposable PR #168 certification shop',
      slug: `pr168-cert-${suffix}`,
      cityId: city.id,
      addressLine: 'Disposable local database fixture',
      status: 'ACTIVE',
    },
  });
  const service = await prisma.service.create({
    data: { salonId: salon.id, name: 'Disposable test service', durationMinutes: 30, price: 100 },
  });
  const now = new Date();
  const booking = await prisma.booking.create({
    data: {
      salonId: salon.id,
      customerId: customer.id,
      serviceId: service.id,
      slotStart: new Date(now.getTime() + 60 * 60 * 1000),
      slotEnd: new Date(now.getTime() + 90 * 60 * 1000),
      status: BookingStatus.CONFIRMED,
      source: BookingSource.APP,
      idempotencyKey: `pr168-cert-${suffix}`,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      type: PaymentType.BOOKING_PAYMENT,
      amount: 100,
      status: PaymentStatus.SUCCESS,
      idempotencyKey: `pr168-payment-${suffix}`,
    },
  });
  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amount: 10,
      reason: 'Disposable failed-refund history fixture',
      status: RefundStatus.FAILED,
    },
  });
  const ledger = await prisma.customerLedgerEntry.create({
    data: {
      customerId: customer.id,
      salonId: salon.id,
      bookingId: booking.id,
      amount: 5,
      reason: LedgerReason.CANCELLATION_CHARGE,
      status: LedgerStatus.SETTLED,
    },
  });
  const subsidy = await prisma.platformShopSubsidyEntry.create({
    data: {
      salonId: salon.id,
      bookingId: booking.id,
      amount: 2,
      status: SubsidyLedgerStatus.SETTLED,
      settledAt: now,
    },
  });

  const quarantineAt = new Date();
  const restoreEligibleUntil = new Date(quarantineAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const requestId = `pr168-request-${suffix}`;
  const quarantineUpdate = async (tx) => {
    await tx.salon.update({
      where: { id: salon.id },
      data: {
        softDeletedAt: quarantineAt,
        restoreEligibleUntil,
        softDeletedByUserId: owner.id,
        softDeletionRequestId: requestId,
        statusBeforeSoftDelete: 'ACTIVE',
        status: 'SUSPENDED',
      },
    });
    // Match the application transaction: surface the deferred check before returning success.
    await tx.$executeRaw`SET CONSTRAINTS salons_quarantine_obligations_guard IMMEDIATE`;
  };

  await expectDatabaseRejection(
    () => prisma.$transaction(quarantineUpdate),
    'SHOP_HAS_OPEN_OBLIGATIONS',
    'Deferred quarantine obligation guard',
  );
  const stillActive = await prisma.salon.findUnique({ where: { id: salon.id } });
  if (stillActive.softDeletedAt !== null || stillActive.status !== 'ACTIVE') {
    throw new Error('Rejected quarantine did not roll back the shop state.');
  }

  await prisma.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.COMPLETED } });
  await prisma.$transaction(quarantineUpdate);

  await expectDatabaseRejection(
    () => prisma.booking.create({
      data: {
        salonId: salon.id,
        customerId: customer.id,
        serviceId: service.id,
        slotStart: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        slotEnd: new Date(now.getTime() + 25 * 60 * 60 * 1000),
        status: BookingStatus.CONFIRMED,
        source: BookingSource.APP,
        idempotencyKey: `pr168-new-booking-${suffix}`,
      },
    }),
    'SHOP_QUARANTINED',
    'New booking insert guard',
  );
  await expectDatabaseRejection(
    () => prisma.queueEntry.create({
      data: {
        salonId: salon.id,
        source: QueueEntrySource.WALK_IN,
        tokenNumber: 990001,
        customerId: customer.id,
      },
    }),
    'SHOP_QUARANTINED',
    'New queue insert guard',
  );
  await expectDatabaseRejection(
    () => prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED } }),
    'SHOP_QUARANTINED',
    'Payment settlement/update guard',
  );
  await expectDatabaseRejection(
    () => prisma.refund.create({
      data: {
        paymentId: payment.id,
        amount: 100,
        reason: 'Disposable refund after quarantine probe',
        status: RefundStatus.INITIATED,
      },
    }),
    'SHOP_QUARANTINED',
    'Refund insert guard',
  );
  await expectDatabaseRejection(
    () => prisma.customerLedgerEntry.update({ where: { id: ledger.id }, data: { status: LedgerStatus.WAIVED } }),
    'SHOP_QUARANTINED',
    'Customer ledger mutation guard',
  );
  await expectDatabaseRejection(
    () => prisma.platformShopSubsidyEntry.update({
      where: { id: subsidy.id },
      data: { status: SubsidyLedgerStatus.VOIDED },
    }),
    'SHOP_QUARANTINED',
    'Platform subsidy mutation guard',
  );
  await expectDatabaseRejection(
    () => prisma.salon.delete({ where: { id: salon.id } }),
    'SALON_HARD_DELETE_DISABLED',
    'Permanent shop deletion guard',
  );

  const financialRows = await Promise.all([
    prisma.payment.findUnique({ where: { id: payment.id } }),
    prisma.refund.findUnique({ where: { id: refund.id } }),
    prisma.customerLedgerEntry.findUnique({ where: { id: ledger.id } }),
    prisma.platformShopSubsidyEntry.findUnique({ where: { id: subsidy.id } }),
  ]);
  if (
    financialRows[0].status !== PaymentStatus.SUCCESS ||
    financialRows[1].status !== RefundStatus.FAILED ||
    financialRows[2].status !== LedgerStatus.SETTLED ||
    financialRows[3].status !== SubsidyLedgerStatus.SETTLED
  ) {
    throw new Error('A rejected financial mutation changed or removed a preserved record.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.fastque_restore_salon_id', ${salon.id}, true)`;
    await tx.salon.update({
      where: { id: salon.id },
      data: {
        softDeletedAt: null,
        restoreEligibleUntil: null,
        softDeletedByUserId: null,
        softDeletionRequestId: null,
        statusBeforeSoftDelete: null,
        status: 'ACTIVE',
      },
    });
  });
  const restored = await prisma.salon.findUnique({ where: { id: salon.id } });
  const preservedBooking = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: { payments: true, ledgerEntries: true, subsidyEntry: true },
  });
  if (
    restored.softDeletedAt !== null ||
    restored.status !== 'ACTIVE' ||
    !preservedBooking ||
    preservedBooking.payments.length !== 1 ||
    preservedBooking.ledgerEntries.length !== 1 ||
    !preservedBooking.subsidyEntry
  ) {
    throw new Error('Restore did not preserve the shop and its booking/financial relationships.');
  }

  await expectDatabaseRejection(
    () => prisma.salon.delete({ where: { id: salon.id } }),
    'SALON_HARD_DELETE_DISABLED',
    'Permanent shop deletion guard after restore',
  );
  const stillPresent = await prisma.salon.count({ where: { id: salon.id } });
  if (stillPresent !== 1) throw new Error('Hard-delete attempt removed the disposable fixture.');
}

async function expectDatabaseRejection(operation, code, label) {
  try {
    await operation();
  } catch (error) {
    if (String(error?.message ?? error).includes(code)) return;
    throw new Error(`${label} failed with an unexpected database error.`);
  }
  throw new Error(`${label} unexpectedly succeeded; expected ${code}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Recovery migration verification failed.');
  process.exitCode = 1;
});

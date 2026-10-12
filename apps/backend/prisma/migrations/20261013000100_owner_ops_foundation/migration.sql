-- Owner-operations mission, part 2 of 2: additive columns, invoicing tables, delivery ledger.
--
-- Backward compatibility: every new column on an existing table is nullable or has a default that
-- reproduces the previous behavior (salons.showPhoneToCustomers defaults to true because the shop
-- phone was already public; salons.queueAutoAssignEnabled defaults to false). The only relaxation
-- of an existing constraint is bookings.customerId becoming nullable, and the CHECK constraint
-- below allows that ONLY for source = 'IN_SHOP' rows, so every pre-existing and every APP/WEB
-- booking is still guaranteed a customer. No data is rewritten, dropped or backfilled.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cancellationReason" VARCHAR(300),
ADD COLUMN     "cancelledByActor" "CancellationActor",
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "guestContactConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guestName" VARCHAR(120),
ADD COLUMN     "guestPhone" VARCHAR(32),
ADD COLUMN     "internalNote" VARCHAR(500),
ALTER COLUMN "customerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "preferredStaffId" TEXT;

-- AlterTable
ALTER TABLE "salon_staff" ADD COLUMN     "accessRevokedAt" TIMESTAMP(3),
ADD COLUMN     "accessRevokedById" TEXT;

-- AlterTable
ALTER TABLE "salons" ADD COLUMN     "queueAutoAssignEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showPhoneToCustomers" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "salon_billing_profiles" (
    "salonId" TEXT NOT NULL,
    "legalName" VARCHAR(160),
    "billingAddress" VARCHAR(300),
    "contactPhone" VARCHAR(32),
    "contactEmail" VARCHAR(160),
    "gstin" VARCHAR(15),
    "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "taxLabel" VARCHAR(20) NOT NULL DEFAULT 'GST',
    "taxRateBps" INTEGER,
    "taxMode" "InvoiceTaxMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "invoicePrefix" VARCHAR(8) NOT NULL DEFAULT 'INV',
    "nextInvoiceSequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salon_billing_profiles_pkey" PRIMARY KEY ("salonId")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "sourceType" "InvoiceSourceType" NOT NULL,
    "bookingId" TEXT,
    "queueEntryId" TEXT,
    "customerId" TEXT,
    "customerName" VARCHAR(120),
    "customerPhone" VARCHAR(32),
    "staffName" VARCHAR(120),
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "taxLabel" VARCHAR(20),
    "taxRateBps" INTEGER,
    "taxMode" "InvoiceTaxMode",
    "sellerLegalName" VARCHAR(160) NOT NULL,
    "sellerGstin" VARCHAR(15),
    "sellerAddress" VARCHAR(300),
    "sellerPhone" VARCHAR(32),
    "sellerEmail" VARCHAR(160),
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" VARCHAR(300),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "serviceId" TEXT,
    "description" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "kind" "InvoicePaymentKind" NOT NULL,
    "method" "InvoicePaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" VARCHAR(80),
    "note" VARCHAR(200),
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(300),
    "nextAttemptAt" TIMESTAMP(3),
    "payload" JSONB,
    "deepLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_idempotencyKey_key" ON "invoices"("idempotencyKey");

-- CreateIndex
CREATE INDEX "invoices_salonId_issuedAt_idx" ON "invoices"("salonId", "issuedAt");

-- CreateIndex
CREATE INDEX "invoices_customerId_issuedAt_idx" ON "invoices"("customerId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_salonId_sequence_key" ON "invoices"("salonId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_salonId_number_key" ON "invoices"("salonId", "number");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_payments_idempotencyKey_key" ON "invoice_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_payments_salonId_recordedAt_idx" ON "invoice_payments"("salonId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_dedupeKey_key" ON "notification_deliveries"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "bookings_salonId_status_cancelledAt_idx" ON "bookings"("salonId", "status", "cancelledAt");

-- AddForeignKey
ALTER TABLE "salon_billing_profiles" ADD CONSTRAINT "salon_billing_profiles_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express.
-- ---------------------------------------------------------------------------------------------

-- A booking is either an in-shop appointment (no account, a named guest, a named creator) or a
-- normal booking with a customer account. Never neither, never both.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_customer_or_in_shop_guest_check"
  CHECK (
    ("source" = 'IN_SHOP' AND "customerId" IS NULL AND "guestName" IS NOT NULL AND "createdByUserId" IS NOT NULL)
    OR ("source" <> 'IN_SHOP' AND "customerId" IS NOT NULL)
  );

-- An invoice refers to exactly one real visit, and a visit has at most one ISSUED invoice (a VOID
-- one may be replaced). Partial unique indexes make repeated/concurrent issuance a database-level
-- impossibility, not just an application-level check.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_source_target_check"
  CHECK (
    ("sourceType" = 'BOOKING' AND "bookingId" IS NOT NULL AND "queueEntryId" IS NULL)
    OR ("sourceType" = 'QUEUE_ENTRY' AND "queueEntryId" IS NOT NULL AND "bookingId" IS NULL)
  ),
  ADD CONSTRAINT "invoices_amounts_check"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "total" >= 0);

CREATE UNIQUE INDEX "invoices_one_issued_per_booking_key"
  ON "invoices" ("bookingId")
  WHERE "bookingId" IS NOT NULL AND "status" = 'ISSUED';

CREATE UNIQUE INDEX "invoices_one_issued_per_queue_entry_key"
  ON "invoices" ("queueEntryId")
  WHERE "queueEntryId" IS NOT NULL AND "status" = 'ISSUED';

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "invoice_lines_amounts_check" CHECK ("unitPrice" >= 0 AND "discount" >= 0 AND "lineTotal" >= 0);

ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_amount_check" CHECK ("amount" > 0);

ALTER TABLE "salon_billing_profiles"
  ADD CONSTRAINT "salon_billing_profiles_tax_rate_check"
  CHECK ("taxRateBps" IS NULL OR ("taxRateBps" >= 0 AND "taxRateBps" <= 10000)),
  ADD CONSTRAINT "salon_billing_profiles_tax_requires_rate_check"
  CHECK (NOT "taxEnabled" OR "taxRateBps" IS NOT NULL),
  ADD CONSTRAINT "salon_billing_profiles_gstin_format_check"
  CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  ADD CONSTRAINT "salon_billing_profiles_sequence_check" CHECK ("nextInvoiceSequence" >= 1);

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_attempts_check" CHECK ("attempts" >= 0);

-- Financial auditability: recorded payments/refunds are an append-only ledger (corrections are a
-- new REFUND row, never an edit), and an issued invoice's money fields are frozen. Only the void
-- bookkeeping columns may change after issue.
CREATE FUNCTION "fastque_invoice_payment_append_only"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'invoice_payments is append-only: record a REFUND row instead of changing or deleting a payment'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "invoice_payments_append_only"
  BEFORE UPDATE OR DELETE ON "invoice_payments"
  FOR EACH ROW EXECUTE FUNCTION "fastque_invoice_payment_append_only"();

CREATE FUNCTION "fastque_invoice_immutable_money"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."subtotal" <> OLD."subtotal"
     OR NEW."discountTotal" <> OLD."discountTotal"
     OR NEW."taxTotal" <> OLD."taxTotal"
     OR NEW."total" <> OLD."total"
     OR NEW."number" <> OLD."number"
     OR NEW."sequence" <> OLD."sequence"
     OR NEW."salonId" <> OLD."salonId"
     OR NEW."currency" <> OLD."currency" THEN
    RAISE EXCEPTION 'an issued invoice''s number and amounts are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_immutable_money"
  BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "fastque_invoice_immutable_money"();

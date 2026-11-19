-- FastQue Finance (admin portal). Purely additive: new finance_* tables only; no existing table
-- is changed. Contributions are never revenue; approval never marks an expense paid; finalised
-- money rows are voided (never deleted); finance_audit_events is append-only.

-- Human-readable record numbers (EXP-000001, FND-000001, RMB-000001).
CREATE SEQUENCE "finance_expense_number_seq";
CREATE SEQUENCE "finance_funding_number_seq";
CREATE SEQUENCE "finance_reimbursement_number_seq";

-- CreateEnum
CREATE TYPE "FinanceExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinanceContributorType" AS ENUM ('FOUNDER', 'DIRECTOR', 'INVESTOR', 'CITY_PARTNER', 'EMPLOYEE', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceFundingKind" AS ENUM ('CONTRIBUTION', 'REPAYMENT');

-- CreateEnum
CREATE TYPE "FinanceFundingClassification" AS ENUM ('SHARE_CAPITAL', 'SHARE_APPLICATION_MONEY', 'SHARE_PREMIUM', 'FOUNDER_LOAN', 'DIRECTOR_LOAN', 'THIRD_PARTY_LOAN', 'REIMBURSABLE_ADVANCE', 'NON_REIMBURSABLE_CONTRIBUTION', 'OTHER_FUNDING', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "FinanceAccountType" AS ENUM ('COMPANY_BANK', 'COMPANY_CASH', 'COMPANY_WALLET');

-- CreateEnum
CREATE TYPE "FinancePaymentMethod" AS ENUM ('UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancePayerType" AS ENUM ('COMPANY_ACCOUNT', 'PERSON');

-- CreateEnum
CREATE TYPE "FinancePersonalTreatment" AS ENUM ('REIMBURSABLE', 'FOUNDER_LOAN', 'NON_REIMBURSABLE_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "FinanceReimbursementStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_REIMBURSED', 'FULLY_REIMBURSED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "department" VARCHAR(60),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_contributors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "FinanceContributorType" NOT NULL,
    "userId" TEXT,
    "email" VARCHAR(200),
    "phone" VARCHAR(20),
    "notes" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_accounts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "FinanceAccountType" NOT NULL,
    "institution" VARCHAR(120),
    "accountLast4" VARCHAR(4),
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingBalanceDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_vendors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(80),
    "contactPerson" VARCHAR(120),
    "phone" VARCHAR(20),
    "email" VARCHAR(200),
    "address" VARCHAR(400),
    "gstin" VARCHAR(15),
    "paymentTerms" VARCHAR(120),
    "bankDetails" VARCHAR(400),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expenses" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL DEFAULT ('EXP-' || lpad(nextval('finance_expense_number_seq'::regclass)::text, 6, '0')),
    "expenseDate" DATE NOT NULL,
    "categoryId" UUID NOT NULL,
    "subcategoryId" UUID,
    "customSubcategory" VARCHAR(80),
    "description" VARCHAR(1000) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "vendorId" UUID,
    "department" VARCHAR(60),
    "city" VARCHAR(60),
    "project" VARCHAR(120),
    "reimbursementRequired" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(1000),
    "status" "FinanceExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMPTZ(6),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNote" VARCHAR(500),
    "cancelledAt" TIMESTAMPTZ(6),
    "clientRequestId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_payments" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "payerType" "FinancePayerType" NOT NULL,
    "accountId" UUID,
    "contributorId" UUID,
    "personalTreatment" "FinancePersonalTreatment",
    "method" "FinancePaymentMethod" NOT NULL,
    "reference" VARCHAR(120),
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" VARCHAR(500),
    "voidedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "clientRequestId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_expense_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_attachments" (
    "id" UUID NOT NULL,
    "expenseId" UUID,
    "reimbursementId" UUID,
    "fileName" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_funding" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL DEFAULT ('FND-' || lpad(nextval('finance_funding_number_seq'::regclass)::text, 6, '0')),
    "contributorId" UUID NOT NULL,
    "kind" "FinanceFundingKind" NOT NULL,
    "classification" "FinanceFundingClassification" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accountId" UUID NOT NULL,
    "method" "FinancePaymentMethod" NOT NULL,
    "sourceAccount" VARCHAR(120),
    "reference" VARCHAR(120),
    "purpose" VARCHAR(300),
    "remarks" VARCHAR(500),
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" VARCHAR(500),
    "voidedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "clientRequestId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_funding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_reimbursements" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL DEFAULT ('RMB-' || lpad(nextval('finance_reimbursement_number_seq'::regclass)::text, 6, '0')),
    "expensePaymentId" UUID NOT NULL,
    "contributorId" UUID NOT NULL,
    "amountRequested" DECIMAL(14,2) NOT NULL,
    "amountApproved" DECIMAL(14,2),
    "status" "FinanceReimbursementStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" VARCHAR(500),
    "reviewNote" VARCHAR(500),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "createdByUserId" TEXT NOT NULL,
    "clientRequestId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_reimbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_reimbursement_payouts" (
    "id" UUID NOT NULL,
    "reimbursementId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "accountId" UUID NOT NULL,
    "method" "FinancePaymentMethod" NOT NULL,
    "reference" VARCHAR(120),
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" VARCHAR(500),
    "voidedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "clientRequestId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_reimbursement_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_audit_events" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "actorUserId" TEXT,
    "changes" JSONB,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_categories_parentId_sortOrder_idx" ON "finance_categories"("parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "finance_contributors_userId_key" ON "finance_contributors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expenses_number_key" ON "finance_expenses"("number");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expenses_clientRequestId_key" ON "finance_expenses"("clientRequestId");

-- CreateIndex
CREATE INDEX "finance_expenses_expenseDate_idx" ON "finance_expenses"("expenseDate");

-- CreateIndex
CREATE INDEX "finance_expenses_status_expenseDate_idx" ON "finance_expenses"("status", "expenseDate");

-- CreateIndex
CREATE INDEX "finance_expenses_categoryId_expenseDate_idx" ON "finance_expenses"("categoryId", "expenseDate");

-- CreateIndex
CREATE INDEX "finance_expenses_createdByUserId_expenseDate_idx" ON "finance_expenses"("createdByUserId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expense_payments_clientRequestId_key" ON "finance_expense_payments"("clientRequestId");

-- CreateIndex
CREATE INDEX "finance_expense_payments_expenseId_idx" ON "finance_expense_payments"("expenseId");

-- CreateIndex
CREATE INDEX "finance_expense_payments_contributorId_paidOn_idx" ON "finance_expense_payments"("contributorId", "paidOn");

-- CreateIndex
CREATE INDEX "finance_expense_payments_accountId_paidOn_idx" ON "finance_expense_payments"("accountId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "finance_attachments_expenseId_sha256_key" ON "finance_attachments"("expenseId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "finance_attachments_reimbursementId_sha256_key" ON "finance_attachments"("reimbursementId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "finance_funding_number_key" ON "finance_funding"("number");

-- CreateIndex
CREATE UNIQUE INDEX "finance_funding_clientRequestId_key" ON "finance_funding"("clientRequestId");

-- CreateIndex
CREATE INDEX "finance_funding_contributorId_date_idx" ON "finance_funding"("contributorId", "date");

-- CreateIndex
CREATE INDEX "finance_funding_date_idx" ON "finance_funding"("date");

-- CreateIndex
CREATE UNIQUE INDEX "finance_reimbursements_number_key" ON "finance_reimbursements"("number");

-- CreateIndex
CREATE UNIQUE INDEX "finance_reimbursements_clientRequestId_key" ON "finance_reimbursements"("clientRequestId");

-- CreateIndex
CREATE INDEX "finance_reimbursements_contributorId_status_idx" ON "finance_reimbursements"("contributorId", "status");

-- CreateIndex
CREATE INDEX "finance_reimbursements_expensePaymentId_idx" ON "finance_reimbursements"("expensePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_reimbursement_payouts_clientRequestId_key" ON "finance_reimbursement_payouts"("clientRequestId");

-- CreateIndex
CREATE INDEX "finance_reimbursement_payouts_reimbursementId_idx" ON "finance_reimbursement_payouts"("reimbursementId");

-- CreateIndex
CREATE INDEX "finance_reimbursement_payouts_accountId_paidOn_idx" ON "finance_reimbursement_payouts"("accountId", "paidOn");

-- CreateIndex
CREATE INDEX "finance_audit_events_entityType_entityId_createdAt_idx" ON "finance_audit_events"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_contributors" ADD CONSTRAINT "finance_contributors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "finance_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_payments" ADD CONSTRAINT "finance_expense_payments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "finance_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_payments" ADD CONSTRAINT "finance_expense_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_payments" ADD CONSTRAINT "finance_expense_payments_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "finance_contributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "finance_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_reimbursementId_fkey" FOREIGN KEY ("reimbursementId") REFERENCES "finance_reimbursements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_funding" ADD CONSTRAINT "finance_funding_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "finance_contributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_funding" ADD CONSTRAINT "finance_funding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reimbursements" ADD CONSTRAINT "finance_reimbursements_expensePaymentId_fkey" FOREIGN KEY ("expensePaymentId") REFERENCES "finance_expense_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reimbursements" ADD CONSTRAINT "finance_reimbursements_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "finance_contributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reimbursement_payouts" ADD CONSTRAINT "finance_reimbursement_payouts_reimbursementId_fkey" FOREIGN KEY ("reimbursementId") REFERENCES "finance_reimbursements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reimbursement_payouts" ADD CONSTRAINT "finance_reimbursement_payouts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money and consistency rules the database enforces on its own.
ALTER TABLE "finance_expenses"
  ADD CONSTRAINT "finance_expenses_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "finance_expenses_tax_within_amount" CHECK ("taxAmount" >= 0 AND "taxAmount" <= "amount");
ALTER TABLE "finance_expense_payments"
  ADD CONSTRAINT "finance_expense_payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "finance_expense_payments_payer_shape" CHECK (
    ("payerType" = 'COMPANY_ACCOUNT' AND "accountId" IS NOT NULL AND "contributorId" IS NULL AND "personalTreatment" IS NULL)
    OR ("payerType" = 'PERSON' AND "contributorId" IS NOT NULL AND "accountId" IS NULL AND "personalTreatment" IS NOT NULL)
  );
ALTER TABLE "finance_funding" ADD CONSTRAINT "finance_funding_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "finance_reimbursements"
  ADD CONSTRAINT "finance_reimbursements_requested_positive" CHECK ("amountRequested" > 0),
  ADD CONSTRAINT "finance_reimbursements_approved_within_requested" CHECK ("amountApproved" IS NULL OR ("amountApproved" > 0 AND "amountApproved" <= "amountRequested"));
ALTER TABLE "finance_reimbursement_payouts" ADD CONSTRAINT "finance_reimbursement_payouts_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_one_owner" CHECK (("expenseId" IS NULL) <> ("reimbursementId" IS NULL));

-- Category names are unique within their parent (main categories among themselves).
CREATE UNIQUE INDEX "finance_categories_main_name_key" ON "finance_categories" ("normalizedName") WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "finance_categories_sub_name_key" ON "finance_categories" ("parentId", "normalizedName") WHERE "parentId" IS NOT NULL;

-- At most one open reimbursement claim per personal payment (rejected/cancelled claims may be re-filed).
CREATE UNIQUE INDEX "finance_reimbursements_one_open_claim_key" ON "finance_reimbursements" ("expensePaymentId")
  WHERE "status" NOT IN ('REJECTED', 'CANCELLED');

-- finance_audit_events is append-only.
CREATE FUNCTION "fastque_finance_audit_append_only"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'finance_audit_events is append-only';
END;
$$;
CREATE TRIGGER "finance_audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "finance_audit_events"
  FOR EACH ROW EXECUTE FUNCTION "fastque_finance_audit_append_only"();

-- Money rows are never deleted (void them with a reason instead).
CREATE FUNCTION "fastque_finance_money_no_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted: void them with a reason instead', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "finance_expense_payments_no_delete" BEFORE DELETE ON "finance_expense_payments"
  FOR EACH ROW EXECUTE FUNCTION "fastque_finance_money_no_delete"();
CREATE TRIGGER "finance_funding_no_delete" BEFORE DELETE ON "finance_funding"
  FOR EACH ROW EXECUTE FUNCTION "fastque_finance_money_no_delete"();
CREATE TRIGGER "finance_reimbursement_payouts_no_delete" BEFORE DELETE ON "finance_reimbursement_payouts"
  FOR EACH ROW EXECUTE FUNCTION "fastque_finance_money_no_delete"();

-- Seed FastQue standard expense categories (isSystem = true). Admins can add more; ids are generated.
WITH main AS (
  INSERT INTO "finance_categories" ("id", "name", "normalizedName", "department", "isSystem", "sortOrder", "updatedAt") VALUES
    (gen_random_uuid(), 'Technology & Product Development', 'technology product development', 'Technology', true, 0, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Sales & Field Operations', 'sales field operations', 'Sales', true, 1, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Marketing & Customer Acquisition', 'marketing customer acquisition', 'Marketing', true, 2, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Human Resources', 'human resources', 'Human Resources', true, 3, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Legal, Registration & Compliance', 'legal registration compliance', 'Legal & Compliance', true, 4, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Office & Administration', 'office administration', 'Administration', true, 5, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Salon Partnership & Activation', 'salon partnership activation', 'Sales', true, 6, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Inventory & Commerce Operations', 'inventory commerce operations', 'Commerce', true, 7, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Travel & Meetings', 'travel meetings', 'Operations', true, 8, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Miscellaneous', 'miscellaneous', 'Administration', true, 9, CURRENT_TIMESTAMP)
  RETURNING "id", "name"
)
INSERT INTO "finance_categories" ("id", "parentId", "name", "normalizedName", "isSystem", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), main."id", sub.name, sub.normalized, true, sub.ord, CURRENT_TIMESTAMP
FROM main JOIN (VALUES
  ('Technology & Product Development', 'Website Development', 'website development', 0),
  ('Technology & Product Development', 'Mobile App Development', 'mobile app development', 1),
  ('Technology & Product Development', 'Frontend Development', 'frontend development', 2),
  ('Technology & Product Development', 'Backend Development', 'backend development', 3),
  ('Technology & Product Development', 'Cloud Hosting', 'cloud hosting', 4),
  ('Technology & Product Development', 'Database Hosting', 'database hosting', 5),
  ('Technology & Product Development', 'Domain Registration', 'domain registration', 6),
  ('Technology & Product Development', 'SSL/Security', 'ssl security', 7),
  ('Technology & Product Development', 'GitHub / Developer Tools', 'github developer tools', 8),
  ('Technology & Product Development', 'Claude / AI Tools', 'claude ai tools', 9),
  ('Technology & Product Development', 'AI API Usage', 'ai api usage', 10),
  ('Technology & Product Development', 'SMS / OTP Services', 'sms otp services', 11),
  ('Technology & Product Development', 'WhatsApp API', 'whatsapp api', 12),
  ('Technology & Product Development', 'Email Services', 'email services', 13),
  ('Technology & Product Development', 'Maps / Geolocation API', 'maps geolocation api', 14),
  ('Technology & Product Development', 'Storage / CDN', 'storage cdn', 15),
  ('Technology & Product Development', 'Software Subscriptions', 'software subscriptions', 16),
  ('Technology & Product Development', 'Testing / QA', 'testing qa', 17),
  ('Technology & Product Development', 'UI/UX Design', 'ui ux design', 18),
  ('Technology & Product Development', 'Other Technology Expenses', 'other technology expenses', 19),
  ('Sales & Field Operations', 'Field Sales Salaries', 'field sales salaries', 0),
  ('Sales & Field Operations', 'Sales Incentives', 'sales incentives', 1),
  ('Sales & Field Operations', 'Travel Allowance', 'travel allowance', 2),
  ('Sales & Field Operations', 'Fuel', 'fuel', 3),
  ('Sales & Field Operations', 'Local Transportation', 'local transportation', 4),
  ('Sales & Field Operations', 'Field Accommodation', 'field accommodation', 5),
  ('Sales & Field Operations', 'Mobile Recharge', 'mobile recharge', 6),
  ('Sales & Field Operations', 'Internet', 'internet', 7),
  ('Sales & Field Operations', 'Sales Training', 'sales training', 8),
  ('Sales & Field Operations', 'Salon Onboarding Cost', 'salon onboarding cost', 9),
  ('Sales & Field Operations', 'QR Code Installation', 'qr code installation', 10),
  ('Sales & Field Operations', 'Salon Photography', 'salon photography', 11),
  ('Sales & Field Operations', 'Sales Demonstration Materials', 'sales demonstration materials', 12),
  ('Sales & Field Operations', 'Field Equipment', 'field equipment', 13),
  ('Sales & Field Operations', 'Other Field Expenses', 'other field expenses', 14),
  ('Marketing & Customer Acquisition', 'Meta Ads', 'meta ads', 0),
  ('Marketing & Customer Acquisition', 'Google Ads', 'google ads', 1),
  ('Marketing & Customer Acquisition', 'Influencer Marketing', 'influencer marketing', 2),
  ('Marketing & Customer Acquisition', 'Social Media Marketing', 'social media marketing', 3),
  ('Marketing & Customer Acquisition', 'Video Production', 'video production', 4),
  ('Marketing & Customer Acquisition', 'Graphic Design', 'graphic design', 5),
  ('Marketing & Customer Acquisition', 'Flyers and Pamphlets', 'flyers and pamphlets', 6),
  ('Marketing & Customer Acquisition', 'QR Posters', 'qr posters', 7),
  ('Marketing & Customer Acquisition', 'Promotional Banners', 'promotional banners', 8),
  ('Marketing & Customer Acquisition', 'T-shirts / Uniforms', 't shirts uniforms', 9),
  ('Marketing & Customer Acquisition', 'Salon Welcome Kits', 'salon welcome kits', 10),
  ('Marketing & Customer Acquisition', 'Referral Rewards', 'referral rewards', 11),
  ('Marketing & Customer Acquisition', 'Customer Discounts', 'customer discounts', 12),
  ('Marketing & Customer Acquisition', 'Promotional Events', 'promotional events', 13),
  ('Marketing & Customer Acquisition', 'Other Marketing Expenses', 'other marketing expenses', 14),
  ('Human Resources', 'Employee Salaries', 'employee salaries', 0),
  ('Human Resources', 'Contractor Payments', 'contractor payments', 1),
  ('Human Resources', 'Recruitment', 'recruitment', 2),
  ('Human Resources', 'Training', 'training', 3),
  ('Human Resources', 'Employee Benefits', 'employee benefits', 4),
  ('Human Resources', 'Bonuses', 'bonuses', 5),
  ('Human Resources', 'Insurance', 'insurance', 6),
  ('Human Resources', 'Other HR Expenses', 'other hr expenses', 7),
  ('Legal, Registration & Compliance', 'Company Incorporation', 'company incorporation', 0),
  ('Legal, Registration & Compliance', 'CA / Accounting Fees', 'ca accounting fees', 1),
  ('Legal, Registration & Compliance', 'ROC Filings', 'roc filings', 2),
  ('Legal, Registration & Compliance', 'Annual Compliance', 'annual compliance', 3),
  ('Legal, Registration & Compliance', 'Legal Consultation', 'legal consultation', 4),
  ('Legal, Registration & Compliance', 'Trademark Registration', 'trademark registration', 5),
  ('Legal, Registration & Compliance', 'GST Compliance', 'gst compliance', 6),
  ('Legal, Registration & Compliance', 'Income Tax Compliance', 'income tax compliance', 7),
  ('Legal, Registration & Compliance', 'Audit Fees', 'audit fees', 8),
  ('Legal, Registration & Compliance', 'Contract Documentation', 'contract documentation', 9),
  ('Legal, Registration & Compliance', 'Other Legal Expenses', 'other legal expenses', 10),
  ('Office & Administration', 'Office Rent', 'office rent', 0),
  ('Office & Administration', 'Utilities', 'utilities', 1),
  ('Office & Administration', 'Internet', 'internet', 2),
  ('Office & Administration', 'Office Supplies', 'office supplies', 3),
  ('Office & Administration', 'Laptop / Computer', 'laptop computer', 4),
  ('Office & Administration', 'Furniture', 'furniture', 5),
  ('Office & Administration', 'Printing', 'printing', 6),
  ('Office & Administration', 'Courier', 'courier', 7),
  ('Office & Administration', 'Bank Charges', 'bank charges', 8),
  ('Office & Administration', 'Other Administrative Expenses', 'other administrative expenses', 9),
  ('Salon Partnership & Activation', 'Salon Onboarding Kits', 'salon onboarding kits', 0),
  ('Salon Partnership & Activation', 'QR Materials', 'qr materials', 1),
  ('Salon Partnership & Activation', 'Staff Training', 'staff training', 2),
  ('Salon Partnership & Activation', 'Salon Promotional Support', 'salon promotional support', 3),
  ('Salon Partnership & Activation', 'Partner Incentives', 'partner incentives', 4),
  ('Salon Partnership & Activation', 'Salon Activation Campaigns', 'salon activation campaigns', 5),
  ('Salon Partnership & Activation', 'Product Demonstrations', 'product demonstrations', 6),
  ('Salon Partnership & Activation', 'Other Salon Partnership Expenses', 'other salon partnership expenses', 7),
  ('Inventory & Commerce Operations', 'Product Sample Purchases', 'product sample purchases', 0),
  ('Inventory & Commerce Operations', 'Supplier Samples', 'supplier samples', 1),
  ('Inventory & Commerce Operations', 'Warehouse Expenses', 'warehouse expenses', 2),
  ('Inventory & Commerce Operations', 'Packaging', 'packaging', 3),
  ('Inventory & Commerce Operations', 'Shipping', 'shipping', 4),
  ('Inventory & Commerce Operations', 'Barcode / QR Labels', 'barcode qr labels', 5),
  ('Inventory & Commerce Operations', 'Inventory Technology', 'inventory technology', 6),
  ('Inventory & Commerce Operations', 'Product Returns', 'product returns', 7),
  ('Inventory & Commerce Operations', 'Other Commerce Expenses', 'other commerce expenses', 8),
  ('Travel & Meetings', 'Intercity Travel', 'intercity travel', 0),
  ('Travel & Meetings', 'Hotels', 'hotels', 1),
  ('Travel & Meetings', 'Business Meals', 'business meals', 2),
  ('Travel & Meetings', 'Investor Meetings', 'investor meetings', 3),
  ('Travel & Meetings', 'Partner Meetings', 'partner meetings', 4),
  ('Travel & Meetings', 'Local Transportation', 'local transportation', 5),
  ('Travel & Meetings', 'Other Travel Expenses', 'other travel expenses', 6),
  ('Miscellaneous', 'General Miscellaneous', 'general miscellaneous', 0),
  ('Miscellaneous', 'One-Time Expenses', 'one time expenses', 1),
  ('Miscellaneous', 'Unclassified Expenses', 'unclassified expenses', 2)
) AS sub(main_name, name, normalized, ord) ON sub.main_name = main."name";

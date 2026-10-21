-- HR permanent employee-ID register (issue #283). Additive: new hr_* tables, an insert-only backfill of
-- existing employee profiles, and integrity triggers. No existing column, index or row is altered.

-- CreateEnum
CREATE TYPE "HrPersonOrigin" AS ENUM ('OFFER', 'EXISTING_PROFILE', 'RECONCILIATION', 'DIRECT_ACCOUNT');

-- CreateEnum
CREATE TYPE "HrOfferKind" AS ENUM ('FIRST', 'REOFFER', 'REHIRE');

-- CreateEnum
CREATE TYPE "HrOfferSource" AS ENUM ('REGISTER', 'HISTORICAL_IMPORT');

-- CreateEnum
CREATE TYPE "HrOfferStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HrEpisodeStatus" AS ENUM ('PENDING_JOIN', 'NOT_JOINED', 'ACTIVE', 'EXITED');

-- CreateEnum
CREATE TYPE "HrSalaryBasis" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "HrPdfEventKind" AS ENUM ('GENERATED', 'REPRINTED');

-- CreateEnum
CREATE TYPE "HrReconciliationSource" AS ENUM ('SENT_MAIL_AUDIT', 'PDF_REVIEW', 'MANUAL');

-- CreateEnum
CREATE TYPE "HrReconciliationStatus" AS ENUM ('UNVERIFIED', 'LINKED', 'IDENTITY_CREATED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "hr_persons" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "codeNumber" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "nameFirstKey" TEXT NOT NULL,
    "emailHash" TEXT,
    "phoneHash" TEXT,
    "emailEnc" TEXT,
    "phoneEnc" TEXT,
    "addressEnc" TEXT,
    "maskedEmail" TEXT,
    "maskedPhone" TEXT,
    "city" TEXT,
    "origin" "HrPersonOrigin" NOT NULL,
    "employeeProfileId" TEXT,
    "originalJoinedOn" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employment_episodes" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "status" "HrEpisodeStatus" NOT NULL,
    "originatingOfferVersion" INTEGER,
    "joinedOn" DATE,
    "exitedOn" DATE,
    "notJoinedOn" DATE,
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employment_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_offer_versions" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "HrOfferKind" NOT NULL,
    "source" "HrOfferSource" NOT NULL DEFAULT 'REGISTER',
    "status" "HrOfferStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "createdById" TEXT,
    "role" TEXT NOT NULL,
    "baseSalaryInr" DECIMAL(12,2) NOT NULL,
    "salaryBasis" "HrSalaryBasis" NOT NULL,
    "salesTarget" INTEGER,
    "incentiveBeyondTargetInr" INTEGER,
    "proposedJoiningDate" DATE,
    "reportingManagerProfileId" TEXT,
    "city" TEXT,
    "expectedPerformanceIncentiveMonthlyInr" INTEGER NOT NULL DEFAULT 5000,
    "letterContactEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_offer_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_pdf_events" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "event" "HrPdfEventKind" NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_pdf_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_audit_events" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "offerId" TEXT,
    "episodeId" TEXT,
    "action" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL DEFAULT 'PERSON',
    "subjectLabel" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "reason" TEXT,
    "actorUserId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_salary_history" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "offerId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "baseSalaryInr" DECIMAL(12,2) NOT NULL,
    "salaryBasis" "HrSalaryBasis" NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_salary_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_manager_history" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "offerId" TEXT,
    "managerProfileId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_manager_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_reconciliation_items" (
    "id" TEXT NOT NULL,
    "source" "HrReconciliationSource" NOT NULL,
    "sentOn" DATE NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "maskedRecipient" TEXT NOT NULL,
    "candidateLabel" TEXT,
    "printedEmployeeCode" TEXT,
    "possibleDuplicateOfId" TEXT,
    "acceptanceNote" TEXT,
    "status" "HrReconciliationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "linkedPersonId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_persons_employeeCode_key" ON "hr_persons"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "hr_persons_codeNumber_key" ON "hr_persons"("codeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "hr_persons_employeeProfileId_key" ON "hr_persons"("employeeProfileId");

-- CreateIndex
CREATE INDEX "hr_persons_emailHash_idx" ON "hr_persons"("emailHash");

-- CreateIndex
CREATE INDEX "hr_persons_phoneHash_idx" ON "hr_persons"("phoneHash");

-- CreateIndex
CREATE INDEX "hr_persons_nameKey_idx" ON "hr_persons"("nameKey");

-- CreateIndex
CREATE INDEX "hr_persons_nameFirstKey_idx" ON "hr_persons"("nameFirstKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employment_episodes_personId_episodeNumber_key" ON "hr_employment_episodes"("personId", "episodeNumber");

-- CreateIndex
CREATE INDEX "hr_offer_versions_personId_issuedAt_idx" ON "hr_offer_versions"("personId", "issuedAt");

-- CreateIndex
CREATE INDEX "hr_offer_versions_status_idx" ON "hr_offer_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_offer_versions_personId_version_key" ON "hr_offer_versions"("personId", "version");

-- CreateIndex
CREATE INDEX "hr_pdf_events_offerId_createdAt_idx" ON "hr_pdf_events"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "hr_audit_events_personId_createdAt_idx" ON "hr_audit_events"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "hr_salary_history_personId_effectiveFrom_idx" ON "hr_salary_history"("personId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "hr_manager_history_personId_fromDate_idx" ON "hr_manager_history"("personId", "fromDate");

-- CreateIndex
CREATE INDEX "hr_reconciliation_items_status_idx" ON "hr_reconciliation_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reconciliation_items_recipientHash_sentOn_key" ON "hr_reconciliation_items"("recipientHash", "sentOn");

-- AddForeignKey
ALTER TABLE "hr_persons" ADD CONSTRAINT "hr_persons_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employment_episodes" ADD CONSTRAINT "hr_employment_episodes_personId_fkey" FOREIGN KEY ("personId") REFERENCES "hr_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_offer_versions" ADD CONSTRAINT "hr_offer_versions_personId_fkey" FOREIGN KEY ("personId") REFERENCES "hr_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_offer_versions" ADD CONSTRAINT "hr_offer_versions_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "hr_employment_episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_offer_versions" ADD CONSTRAINT "hr_offer_versions_reportingManagerProfileId_fkey" FOREIGN KEY ("reportingManagerProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_pdf_events" ADD CONSTRAINT "hr_pdf_events_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "hr_offer_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_audit_events" ADD CONSTRAINT "hr_audit_events_personId_fkey" FOREIGN KEY ("personId") REFERENCES "hr_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_history" ADD CONSTRAINT "hr_salary_history_personId_fkey" FOREIGN KEY ("personId") REFERENCES "hr_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_history" ADD CONSTRAINT "hr_salary_history_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "hr_employment_episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_history" ADD CONSTRAINT "hr_salary_history_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "hr_offer_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_manager_history" ADD CONSTRAINT "hr_manager_history_personId_fkey" FOREIGN KEY ("personId") REFERENCES "hr_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_manager_history" ADD CONSTRAINT "hr_manager_history_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "hr_employment_episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_manager_history" ADD CONSTRAINT "hr_manager_history_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "hr_offer_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_manager_history" ADD CONSTRAINT "hr_manager_history_managerProfileId_fkey" FOREIGN KEY ("managerProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reconciliation_items" ADD CONSTRAINT "hr_reconciliation_items_possibleDuplicateOfId_fkey" FOREIGN KEY ("possibleDuplicateOfId") REFERENCES "hr_reconciliation_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reconciliation_items" ADD CONSTRAINT "hr_reconciliation_items_linkedPersonId_fkey" FOREIGN KEY ("linkedPersonId") REFERENCES "hr_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================================================================================================
-- Hand-written integrity layer (Prisma cannot express these). Everything below is additive: it touches
-- only the new hr_* tables, plus two guard triggers on employee_profiles (no column, index or row of
-- any existing table is changed).
-- ===================================================================================================

-- ---- Check constraints --------------------------------------------------------------------------

ALTER TABLE "hr_persons"
  ADD CONSTRAINT "hr_persons_code_format_chk"
  CHECK (
    "employeeCode" ~ '^FQ-FE-[0-9]{5}$'
    AND "codeNumber" BETWEEN 1 AND 99999
    AND "employeeCode" = 'FQ-FE-' || lpad("codeNumber"::text, 5, '0')
  );

ALTER TABLE "hr_employment_episodes"
  ADD CONSTRAINT "hr_employment_episodes_number_chk" CHECK ("episodeNumber" >= 1),
  ADD CONSTRAINT "hr_employment_episodes_dates_chk"
  CHECK ("joinedOn" IS NULL OR "exitedOn" IS NULL OR "exitedOn" >= "joinedOn");

ALTER TABLE "hr_offer_versions"
  ADD CONSTRAINT "hr_offer_versions_version_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "hr_offer_versions_salary_chk" CHECK ("baseSalaryInr" >= 0),
  ADD CONSTRAINT "hr_offer_versions_target_pair_chk" CHECK (("salesTarget" IS NULL) = ("incentiveBeyondTargetInr" IS NULL)),
  ADD CONSTRAINT "hr_offer_versions_target_range_chk"
  CHECK (
    ("salesTarget" IS NULL OR "salesTarget" >= 1)
    AND ("incentiveBeyondTargetInr" IS NULL OR "incentiveBeyondTargetInr" BETWEEN 1 AND 1000000)
  ),
  ADD CONSTRAINT "hr_offer_versions_incentive_snapshot_chk" CHECK ("expectedPerformanceIncentiveMonthlyInr" >= 0);

ALTER TABLE "hr_pdf_events"
  ADD CONSTRAINT "hr_pdf_events_sha256_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$' AND "byteLength" > 0);

ALTER TABLE "hr_reconciliation_items"
  ADD CONSTRAINT "hr_reconciliation_printed_code_chk"
  CHECK ("printedEmployeeCode" IS NULL OR "printedEmployeeCode" ~ '^FQ-FE-[0-9]{5}$');

-- ---- Backfill: every existing EmployeeProfile becomes a register person with its ORIGINAL code -------
-- Insert-only. The profile and its user, CRM leads/visits/follow-ups and audit rows are not touched.
-- An existing account is represented as ONE episode: ACTIVE when its login is active, otherwise EXITED
-- (never invented as "joined again"); no offer versions are fabricated for people hired before the register.

INSERT INTO "hr_persons"
  ("id", "employeeCode", "codeNumber", "fullName", "nameKey", "nameFirstKey", "origin", "employeeProfileId",
   "originalJoinedOn", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  ep."employeeCode",
  substr(ep."employeeCode", 7)::int,
  ep."fullName",
  lower(regexp_replace(btrim(ep."fullName"), '\s+', ' ', 'g')),
  split_part(lower(regexp_replace(btrim(ep."fullName"), '\s+', ' ', 'g')), ' ', 1),
  'EXISTING_PROFILE'::"HrPersonOrigin",
  ep."id",
  (ep."joinedAt" AT TIME ZONE 'Asia/Kolkata')::date,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "employee_profiles" ep
WHERE ep."employeeCode" ~ '^FQ-FE-[0-9]{5}$'
ORDER BY ep."employeeCode";

INSERT INTO "hr_employment_episodes"
  ("id", "personId", "episodeNumber", "status", "joinedOn", "statusReason", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  1,
  CASE WHEN u."status" = 'ACTIVE' THEN 'ACTIVE'::"HrEpisodeStatus" ELSE 'EXITED'::"HrEpisodeStatus" END,
  (ep."joinedAt" AT TIME ZONE 'Asia/Kolkata')::date,
  CASE WHEN u."status" = 'ACTIVE' THEN NULL ELSE 'Backfilled from a suspended account; exit date not recorded' END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "hr_persons" p
JOIN "employee_profiles" ep ON ep."id" = p."employeeProfileId"
JOIN "users" u ON u."id" = ep."userId"
WHERE p."origin" = 'EXISTING_PROFILE';

INSERT INTO "hr_audit_events" ("id", "personId", "action", "subjectKind", "metadata", "createdAt")
SELECT gen_random_uuid()::text, p."id", 'BACKFILLED_FROM_EMPLOYEE_PROFILE', 'PERSON',
       jsonb_build_object('employeeCode', p."employeeCode"), CURRENT_TIMESTAMP
FROM "hr_persons" p
WHERE p."origin" = 'EXISTING_PROFILE';

-- ---- Guard functions + triggers ---------------------------------------------------------------------

CREATE FUNCTION hr_forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HR_RECORD_UNDELETABLE: % rows are permanent history and can never be deleted', TG_TABLE_NAME
    USING ERRCODE = '23000';
END
$$;

CREATE FUNCTION hr_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HR_RECORD_APPEND_ONLY: % rows are append-only and cannot be changed', TG_TABLE_NAME
    USING ERRCODE = '23000';
END
$$;

CREATE TRIGGER "hr_persons_no_delete" BEFORE DELETE ON "hr_persons" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();
CREATE TRIGGER "hr_employment_episodes_no_delete" BEFORE DELETE ON "hr_employment_episodes" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();
CREATE TRIGGER "hr_offer_versions_no_delete" BEFORE DELETE ON "hr_offer_versions" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();
CREATE TRIGGER "hr_pdf_events_no_delete" BEFORE DELETE ON "hr_pdf_events" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();
CREATE TRIGGER "hr_audit_events_no_delete" BEFORE DELETE ON "hr_audit_events" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();
CREATE TRIGGER "hr_salary_history_no_delete" BEFORE DELETE ON "hr_salary_history" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();
CREATE TRIGGER "hr_manager_history_no_delete" BEFORE DELETE ON "hr_manager_history" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();
CREATE TRIGGER "hr_reconciliation_items_no_delete" BEFORE DELETE ON "hr_reconciliation_items" FOR EACH ROW EXECUTE FUNCTION hr_forbid_delete();

CREATE TRIGGER "hr_pdf_events_append_only" BEFORE UPDATE ON "hr_pdf_events" FOR EACH ROW EXECUTE FUNCTION hr_forbid_update();
CREATE TRIGGER "hr_audit_events_append_only" BEFORE UPDATE ON "hr_audit_events" FOR EACH ROW EXECUTE FUNCTION hr_forbid_update();
CREATE TRIGGER "hr_salary_history_append_only" BEFORE UPDATE ON "hr_salary_history" FOR EACH ROW EXECUTE FUNCTION hr_forbid_update();

-- A person's code is permanent; the profile link is set exactly once and never re-pointed or cleared.
CREATE FUNCTION hr_person_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."employeeCode" IS DISTINCT FROM OLD."employeeCode" OR NEW."codeNumber" IS DISTINCT FROM OLD."codeNumber" THEN
    RAISE EXCEPTION 'HR_CODE_IMMUTABLE: an employee code can never be changed' USING ERRCODE = '23000';
  END IF;
  IF NEW."origin" IS DISTINCT FROM OLD."origin" THEN
    RAISE EXCEPTION 'HR_ORIGIN_IMMUTABLE: a person''s origin can never be changed' USING ERRCODE = '23000';
  END IF;
  IF OLD."employeeProfileId" IS NOT NULL AND NEW."employeeProfileId" IS DISTINCT FROM OLD."employeeProfileId" THEN
    RAISE EXCEPTION 'HR_PROFILE_LINK_IMMUTABLE: a person stays linked to the same employee profile' USING ERRCODE = '23000';
  END IF;
  IF OLD."originalJoinedOn" IS NOT NULL AND NEW."originalJoinedOn" IS DISTINCT FROM OLD."originalJoinedOn" THEN
    RAISE EXCEPTION 'HR_ORIGINAL_JOIN_IMMUTABLE: the original joining date is preserved' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "hr_persons_guard_update" BEFORE UPDATE ON "hr_persons" FOR EACH ROW EXECUTE FUNCTION hr_person_guard_update();

-- Offer terms are immutable; only the status axis may move, and only along valid transitions.
CREATE FUNCTION hr_offer_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest int;
BEGIN
  SELECT COALESCE(MAX("version"), 0) INTO latest FROM "hr_offer_versions" WHERE "personId" = NEW."personId";
  IF NEW."version" <> latest + 1 THEN
    RAISE EXCEPTION 'HR_OFFER_VERSION_GAP: next offer version for this person must be %', latest + 1 USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "hr_offer_versions_guard_insert" BEFORE INSERT ON "hr_offer_versions" FOR EACH ROW EXECUTE FUNCTION hr_offer_guard_insert();

CREATE FUNCTION hr_offer_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."personId" IS DISTINCT FROM OLD."personId"
     OR NEW."episodeId" IS DISTINCT FROM OLD."episodeId"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."baseSalaryInr" IS DISTINCT FROM OLD."baseSalaryInr"
     OR NEW."salaryBasis" IS DISTINCT FROM OLD."salaryBasis"
     OR NEW."salesTarget" IS DISTINCT FROM OLD."salesTarget"
     OR NEW."incentiveBeyondTargetInr" IS DISTINCT FROM OLD."incentiveBeyondTargetInr"
     OR NEW."proposedJoiningDate" IS DISTINCT FROM OLD."proposedJoiningDate"
     OR NEW."reportingManagerProfileId" IS DISTINCT FROM OLD."reportingManagerProfileId"
     OR NEW."city" IS DISTINCT FROM OLD."city"
     OR NEW."expectedPerformanceIncentiveMonthlyInr" IS DISTINCT FROM OLD."expectedPerformanceIncentiveMonthlyInr"
     OR NEW."letterContactEnc" IS DISTINCT FROM OLD."letterContactEnc"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'HR_OFFER_TERMS_IMMUTABLE: an issued offer version can never be edited; issue a new version' USING ERRCODE = '23000';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'DRAFT'  AND NEW."status" = 'ISSUED')
      OR (OLD."status" = 'ISSUED' AND NEW."status" IN ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'))
      OR (OLD."status" = 'SENT'   AND NEW."status" IN ('ACCEPTED', 'DECLINED', 'EXPIRED'))
    ) THEN
      RAISE EXCEPTION 'HR_OFFER_INVALID_TRANSITION: % -> % is not allowed', OLD."status", NEW."status" USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "hr_offer_versions_guard_update" BEFORE UPDATE ON "hr_offer_versions" FOR EACH ROW EXECUTE FUNCTION hr_offer_guard_update();

-- Employment episodes: contiguous numbering, at most one open (pending/active) episode per person,
-- valid transitions only, and the person / number / join date never rewritten.
CREATE FUNCTION hr_episode_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest int;
BEGIN
  SELECT COALESCE(MAX("episodeNumber"), 0) INTO latest FROM "hr_employment_episodes" WHERE "personId" = NEW."personId";
  IF NEW."episodeNumber" <> latest + 1 THEN
    RAISE EXCEPTION 'HR_EPISODE_NUMBER_GAP: next episode number for this person must be %', latest + 1 USING ERRCODE = '23000';
  END IF;
  IF NEW."status" IN ('PENDING_JOIN', 'ACTIVE') AND EXISTS (
    SELECT 1 FROM "hr_employment_episodes" WHERE "personId" = NEW."personId" AND "status" IN ('PENDING_JOIN', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'HR_EPISODE_ALREADY_OPEN: this person already has an open employment episode' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "hr_employment_episodes_guard_insert" BEFORE INSERT ON "hr_employment_episodes" FOR EACH ROW EXECUTE FUNCTION hr_episode_guard_insert();

CREATE FUNCTION hr_episode_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."personId" IS DISTINCT FROM OLD."personId" OR NEW."episodeNumber" IS DISTINCT FROM OLD."episodeNumber" THEN
    RAISE EXCEPTION 'HR_EPISODE_IDENTITY_IMMUTABLE: an episode keeps its person and number' USING ERRCODE = '23000';
  END IF;
  IF OLD."joinedOn" IS NOT NULL AND NEW."joinedOn" IS DISTINCT FROM OLD."joinedOn" THEN
    RAISE EXCEPTION 'HR_EPISODE_JOIN_IMMUTABLE: the recorded joining date of an episode is preserved' USING ERRCODE = '23000';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'PENDING_JOIN' AND NEW."status" IN ('NOT_JOINED', 'ACTIVE'))
      OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'EXITED')
    ) THEN
      RAISE EXCEPTION 'HR_EPISODE_INVALID_TRANSITION: % -> % is not allowed', OLD."status", NEW."status" USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "hr_employment_episodes_guard_update" BEFORE UPDATE ON "hr_employment_episodes" FOR EACH ROW EXECUTE FUNCTION hr_episode_guard_update();

-- Manager history: a period is closed once (NULL -> date) and is otherwise append-only.
CREATE FUNCTION hr_manager_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."personId" IS DISTINCT FROM OLD."personId"
     OR NEW."episodeId" IS DISTINCT FROM OLD."episodeId"
     OR NEW."offerId" IS DISTINCT FROM OLD."offerId"
     OR NEW."managerProfileId" IS DISTINCT FROM OLD."managerProfileId"
     OR NEW."fromDate" IS DISTINCT FROM OLD."fromDate"
     OR NEW."recordedById" IS DISTINCT FROM OLD."recordedById"
     OR (OLD."toDate" IS NOT NULL AND NEW."toDate" IS DISTINCT FROM OLD."toDate") THEN
    RAISE EXCEPTION 'HR_RECORD_APPEND_ONLY: a reporting-manager period can only be closed once' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "hr_manager_history_guard_update" BEFORE UPDATE ON "hr_manager_history" FOR EACH ROW EXECUTE FUNCTION hr_manager_guard_update();

-- ---- employee_profiles guards (the only existing table touched, by triggers only) --------------------
-- 1) A code belongs to exactly one person: it can never be edited on the profile.
-- 2) A profile may only be created with a code that belongs to a register person if the joining
--    transaction declared it (set_config('app.hr_joining_person', <person id>, true)). This also makes a
--    not-yet-drained OLD backend instance fail loudly instead of minting a duplicate or stolen ID.
-- 3) A profile created outside the register (legacy path) automatically gets its register person, so
--    the register is always a complete superset of every ID ever issued.

CREATE FUNCTION hr_guard_employee_profile_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."employeeCode" IS DISTINCT FROM OLD."employeeCode" THEN
    RAISE EXCEPTION 'HR_CODE_IMMUTABLE: an employee code can never be changed' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "employee_profiles_hr_code_immutable" BEFORE UPDATE ON "employee_profiles" FOR EACH ROW EXECUTE FUNCTION hr_guard_employee_profile_update();

CREATE FUNCTION hr_guard_employee_profile_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_id text; person_profile text;
BEGIN
  SELECT "id", "employeeProfileId" INTO person_id, person_profile FROM "hr_persons" WHERE "employeeCode" = NEW."employeeCode";
  IF FOUND AND (person_profile IS NOT NULL OR current_setting('app.hr_joining_person', true) IS DISTINCT FROM person_id) THEN
    RAISE EXCEPTION 'HR_EMPLOYEE_CODE_RESERVED: % already belongs to a register person; use the HR register joining flow', NEW."employeeCode"
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "employee_profiles_hr_code_guard" BEFORE INSERT ON "employee_profiles" FOR EACH ROW EXECUTE FUNCTION hr_guard_employee_profile_insert();

CREATE FUNCTION hr_adopt_employee_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_id text; key text; user_status text;
BEGIN
  IF EXISTS (SELECT 1 FROM "hr_persons" WHERE "employeeCode" = NEW."employeeCode") OR NEW."employeeCode" !~ '^FQ-FE-[0-9]{5}$' THEN
    RETURN NEW;
  END IF;
  key := lower(regexp_replace(btrim(NEW."fullName"), '\s+', ' ', 'g'));
  person_id := gen_random_uuid()::text;
  INSERT INTO "hr_persons"
    ("id", "employeeCode", "codeNumber", "fullName", "nameKey", "nameFirstKey", "origin", "employeeProfileId",
     "originalJoinedOn", "createdAt", "updatedAt")
  VALUES
    (person_id, NEW."employeeCode", substr(NEW."employeeCode", 7)::int, NEW."fullName", key, split_part(key, ' ', 1),
     'EXISTING_PROFILE', NEW."id", (NEW."joinedAt" AT TIME ZONE 'Asia/Kolkata')::date, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  SELECT "status"::text INTO user_status FROM "users" WHERE "id" = NEW."userId";
  INSERT INTO "hr_employment_episodes" ("id", "personId", "episodeNumber", "status", "joinedOn", "statusReason", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, person_id, 1,
          CASE WHEN user_status = 'ACTIVE' THEN 'ACTIVE'::"HrEpisodeStatus" ELSE 'EXITED'::"HrEpisodeStatus" END,
          (NEW."joinedAt" AT TIME ZONE 'Asia/Kolkata')::date,
          CASE WHEN user_status = 'ACTIVE' THEN NULL ELSE 'Adopted from a suspended account; exit date not recorded' END,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  INSERT INTO "hr_audit_events" ("id", "personId", "action", "subjectKind", "metadata", "createdAt")
  VALUES (gen_random_uuid()::text, person_id, 'ADOPTED_LEGACY_EMPLOYEE_PROFILE', 'PERSON',
          jsonb_build_object('employeeCode', NEW."employeeCode"), CURRENT_TIMESTAMP);
  RETURN NEW;
END
$$;
CREATE TRIGGER "employee_profiles_hr_adopt" AFTER INSERT ON "employee_profiles" FOR EACH ROW EXECUTE FUNCTION hr_adopt_employee_profile();

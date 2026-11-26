-- FastQue Growth AI: customer acquisition, advisory mode. Additive only: new growth_* tables, no change
-- to any existing table. See docs/growth-ai/README.md.

-- CreateTable
CREATE TABLE "growth_staff_roles" (
    "userId" TEXT NOT NULL,
    "role" VARCHAR(30) NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_staff_roles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "growth_controls" (
    "id" INTEGER NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" VARCHAR(300),
    "pausedByUserId" TEXT,
    "pausedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_salon_exclusions" (
    "salonId" TEXT NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_salon_exclusions_pkey" PRIMARY KEY ("salonId")
);

-- CreateTable
CREATE TABLE "growth_keyword_runs" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "isMock" BOOLEAN NOT NULL,
    "cityId" TEXT NOT NULL,
    "locationLabel" VARCHAR(160) NOT NULL,
    "geoTargetConstant" VARCHAR(40),
    "language" VARCHAR(40) NOT NULL,
    "serviceKey" VARCHAR(30) NOT NULL,
    "seeds" JSONB NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "dailyBudgetPaise" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "error" VARCHAR(500),
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_keyword_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_keyword_ideas" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "keyword" VARCHAR(120) NOT NULL,
    "avgMonthlySearches" INTEGER,
    "monthlyVolumes" JSONB NOT NULL,
    "competition" VARCHAR(10) NOT NULL,
    "competitionIndex" INTEGER,
    "lowBidMicros" BIGINT,
    "highBidMicros" BIGINT,
    "isMock" BOOLEAN NOT NULL,

    CONSTRAINT "growth_keyword_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_proposals" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "keywordRunId" UUID NOT NULL,
    "cityId" TEXT NOT NULL,
    "serviceKey" VARCHAR(30) NOT NULL,
    "keywords" JSONB NOT NULL,
    "salons" JSONB NOT NULL,
    "dailyBudgetPaise" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "preview" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "usesMockData" BOOLEAN NOT NULL,
    "adCopy" JSONB,
    "adCopySource" VARCHAR(20),
    "previewHash" CHAR(64) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "approvalNote" VARCHAR(500),
    "approvedHash" CHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "growth_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_proposal_events" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "fromStatus" VARCHAR(20),
    "toStatus" VARCHAR(20) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "note" VARCHAR(500),
    "previewHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_proposal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_measurements" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_ai_usage" (
    "id" UUID NOT NULL,
    "feature" VARCHAR(40) NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicroUsd" BIGINT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" VARCHAR(300),
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growth_keyword_runs_createdAt_idx" ON "growth_keyword_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "growth_keyword_ideas_runId_keyword_key" ON "growth_keyword_ideas"("runId", "keyword");

-- CreateIndex
CREATE INDEX "growth_proposals_status_createdAt_idx" ON "growth_proposals"("status", "createdAt");

-- CreateIndex
CREATE INDEX "growth_proposal_events_proposalId_createdAt_idx" ON "growth_proposal_events"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "growth_measurements_proposalId_createdAt_idx" ON "growth_measurements"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "growth_ai_usage_createdAt_idx" ON "growth_ai_usage"("createdAt");

-- AddForeignKey
ALTER TABLE "growth_keyword_ideas" ADD CONSTRAINT "growth_keyword_ideas_runId_fkey" FOREIGN KEY ("runId") REFERENCES "growth_keyword_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_keywordRunId_fkey" FOREIGN KEY ("keywordRunId") REFERENCES "growth_keyword_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_proposal_events" ADD CONSTRAINT "growth_proposal_events_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "growth_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_measurements" ADD CONSTRAINT "growth_measurements_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "growth_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Flat CHECK constraints (no functions), so a dump/restore keeps the same definition.
ALTER TABLE "growth_staff_roles" ADD CONSTRAINT "growth_staff_roles_role_check" CHECK ("role" IN ('ADMIN', 'MARKETING_MANAGER', 'ANALYST', 'READ_ONLY'));
ALTER TABLE "growth_controls" ADD CONSTRAINT "growth_controls_singleton_check" CHECK ("id" = 1);
ALTER TABLE "growth_keyword_runs" ADD CONSTRAINT "growth_keyword_runs_provider_check" CHECK ("provider" IN ('mock', 'google_ads'));
ALTER TABLE "growth_keyword_runs" ADD CONSTRAINT "growth_keyword_runs_mock_check" CHECK (("provider" = 'mock') = "isMock");
ALTER TABLE "growth_keyword_runs" ADD CONSTRAINT "growth_keyword_runs_status_check" CHECK ("status" IN ('COMPLETED', 'FAILED'));
ALTER TABLE "growth_keyword_runs" ADD CONSTRAINT "growth_keyword_runs_budget_check" CHECK ("dailyBudgetPaise" > 0);
ALTER TABLE "growth_keyword_ideas" ADD CONSTRAINT "growth_keyword_ideas_competition_check" CHECK ("competition" IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'));
ALTER TABLE "growth_keyword_ideas" ADD CONSTRAINT "growth_keyword_ideas_numbers_check" CHECK (("avgMonthlySearches" IS NULL OR "avgMonthlySearches" >= 0) AND ("competitionIndex" IS NULL OR ("competitionIndex" >= 0 AND "competitionIndex" <= 100)) AND ("lowBidMicros" IS NULL OR "lowBidMicros" >= 0) AND ("highBidMicros" IS NULL OR "highBidMicros" >= 0));
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_status_check" CHECK ("status" IN ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'));
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_channel_check" CHECK ("channel" IN ('GOOGLE_SEARCH'));
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_budget_check" CHECK ("dailyBudgetPaise" > 0 AND "durationDays" BETWEEN 1 AND 90 AND "endsOn" >= "startsOn");
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_copy_source_check" CHECK ("adCopySource" IS NULL OR "adCopySource" IN ('AI_GENERATED', 'TEMPLATE'));
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_approval_check" CHECK (("status" = 'APPROVED') <= ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedHash" IS NOT NULL));
ALTER TABLE "growth_ai_usage" ADD CONSTRAINT "growth_ai_usage_numbers_check" CHECK ("inputTokens" >= 0 AND "outputTokens" >= 0 AND "costMicroUsd" >= 0);

-- History and measurements are append-only.
CREATE FUNCTION "growth_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER "growth_proposal_events_append_only" BEFORE UPDATE OR DELETE ON "growth_proposal_events" FOR EACH ROW EXECUTE FUNCTION "growth_append_only"();
CREATE TRIGGER "growth_measurements_append_only" BEFORE UPDATE OR DELETE ON "growth_measurements" FOR EACH ROW EXECUTE FUNCTION "growth_append_only"();
CREATE TRIGGER "growth_ai_usage_append_only" BEFORE UPDATE OR DELETE ON "growth_ai_usage" FOR EACH ROW EXECUTE FUNCTION "growth_append_only"();

INSERT INTO "growth_controls" ("id", "paused", "updatedAt") VALUES (1, false, now());

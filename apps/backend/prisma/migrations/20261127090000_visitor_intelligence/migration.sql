-- FastQue Visitor Intelligence. Additive only: new enums, tables and indexes. No existing table, column or row is changed.
-- Rollback: DROP the vi_* tables and Vi* enums (docs/visitor-intelligence/DEPLOYMENT.md).

-- CreateEnum
CREATE TYPE "ViGeoSource" AS ENUM ('CDN_HEADER', 'OFFLINE_DB', 'BROWSER_PERMISSION', 'USER_SELECTED', 'NONE');

-- CreateEnum
CREATE TYPE "ViCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ViConversionType" AS ENUM ('REGISTRATION', 'BOOKING', 'QUEUE_JOIN', 'HOME_BOOKING', 'PURCHASE', 'PARTNER_REGISTRATION');

-- CreateEnum
CREATE TYPE "ViInsightStatus" AS ENUM ('NEW', 'ACCEPTED', 'REJECTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ViSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ViStaffRoleKind" AS ENUM ('MARKETING_HEAD', 'SALES_HEAD', 'OPERATIONS_HEAD', 'SUPPORT');

-- CreateEnum
CREATE TYPE "ViPrivacyRequestType" AS ENUM ('ACCESS', 'DELETE');

-- CreateEnum
CREATE TYPE "ViPrivacyRequestStatus" AS ENUM ('OPEN', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "vi_visitors" (
    "id" UUID NOT NULL,
    "visitorKey" CHAR(64) NOT NULL,
    "guestNumber" SERIAL NOT NULL,
    "userId" TEXT,
    "linkedAt" TIMESTAMPTZ(6),
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "salonViews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "bookingAttempts" INTEGER NOT NULL DEFAULT 0,
    "bookings" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenuePaise" BIGINT NOT NULL DEFAULT 0,
    "engagedMs" BIGINT NOT NULL DEFAULT 0,
    "firstChannel" VARCHAR(30),
    "firstSource" VARCHAR(120),
    "firstCampaign" VARCHAR(160),
    "firstCampaignId" UUID,
    "lastChannel" VARCHAR(30),
    "lastSource" VARCHAR(120),
    "lastCampaign" VARCHAR(160),
    "lastCampaignId" UUID,
    "country" VARCHAR(80),
    "state" VARCHAR(80),
    "city" VARCHAR(80),
    "deviceCategory" VARCHAR(10),
    "topServices" JSONB,
    "priceMinInr" INTEGER,
    "priceMaxInr" INTEGER,
    "consentAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "consentMarketing" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vi_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_sessions" (
    "id" UUID NOT NULL,
    "clientSessionId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "userId" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL,
    "engagedMs" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "entryPath" VARCHAR(300),
    "currentPath" VARCHAR(300),
    "previousPath" VARCHAR(300),
    "referrerDomain" VARCHAR(120),
    "channel" VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
    "utmSource" VARCHAR(120),
    "utmMedium" VARCHAR(120),
    "utmCampaign" VARCHAR(160),
    "utmContent" VARCHAR(160),
    "utmTerm" VARCHAR(160),
    "campaignId" UUID,
    "clickIdType" VARCHAR(10),
    "deviceCategory" VARCHAR(10) NOT NULL DEFAULT 'unknown',
    "browser" VARCHAR(30),
    "os" VARCHAR(30),
    "country" VARCHAR(80),
    "state" VARCHAR(80),
    "city" VARCHAR(80),
    "locality" VARCHAR(120),
    "geoSource" "ViGeoSource" NOT NULL DEFAULT 'NONE',
    "isNewVisitor" BOOLEAN NOT NULL DEFAULT true,
    "searched" BOOLEAN NOT NULL DEFAULT false,
    "viewedSalon" BOOLEAN NOT NULL DEFAULT false,
    "bookingStarted" BOOLEAN NOT NULL DEFAULT false,
    "bookingConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "bookingFailed" BOOLEAN NOT NULL DEFAULT false,
    "addedToCart" BOOLEAN NOT NULL DEFAULT false,
    "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "revenuePaise" BIGINT NOT NULL DEFAULT 0,
    "searchTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salonsViewed" INTEGER NOT NULL DEFAULT 0,
    "productsViewed" INTEGER NOT NULL DEFAULT 0,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vi_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_events" (
    "id" UUID NOT NULL,
    "clientEventId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" TEXT,
    "type" VARCHAR(40) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "module" VARCHAR(30),
    "path" VARCHAR(300) NOT NULL,
    "entityType" VARCHAR(40),
    "entityId" VARCHAR(80),
    "salonId" VARCHAR(80),
    "country" VARCHAR(80),
    "state" VARCHAR(80),
    "city" VARCHAR(80),
    "geoSource" "ViGeoSource" NOT NULL DEFAULT 'NONE',
    "channel" VARCHAR(30),
    "campaignId" UUID,
    "deviceCategory" VARCHAR(10),
    "consentStatus" VARCHAR(20) NOT NULL DEFAULT 'analytics',
    "metadata" JSONB,

    CONSTRAINT "vi_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_search_events" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "rawQuery" VARCHAR(120) NOT NULL,
    "normalizedQuery" VARCHAR(120) NOT NULL,
    "category" VARCHAR(60),
    "locationText" VARCHAR(120),
    "country" VARCHAR(80),
    "state" VARCHAR(80),
    "city" VARCHAR(80),
    "filters" JSONB,
    "priceMinInr" INTEGER,
    "priceMaxInr" INTEGER,
    "resultCount" INTEGER,
    "zeroResult" BOOLEAN NOT NULL DEFAULT false,
    "ledToSalonView" BOOLEAN NOT NULL DEFAULT false,
    "ledToBooking" BOOLEAN NOT NULL DEFAULT false,
    "ledToPurchase" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vi_search_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_conversions" (
    "id" UUID NOT NULL,
    "type" "ViConversionType" NOT NULL,
    "entityId" VARCHAR(80) NOT NULL,
    "visitorId" UUID,
    "sessionId" UUID,
    "userId" TEXT,
    "salonId" VARCHAR(80),
    "city" VARCHAR(80),
    "valuePaise" BIGINT NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "firstChannel" VARCHAR(30),
    "lastChannel" VARCHAR(30),
    "firstCampaignId" UUID,
    "lastCampaignId" UUID,
    "module" VARCHAR(30),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_consent_records" (
    "id" UUID NOT NULL,
    "visitorKey" CHAR(64) NOT NULL,
    "analytics" BOOLEAN NOT NULL,
    "marketing" BOOLEAN NOT NULL,
    "preciseLocation" BOOLEAN,
    "policyVersion" VARCHAR(20) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_campaigns" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "status" "ViCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "landingPath" VARCHAR(300) NOT NULL DEFAULT '/',
    "utmSource" VARCHAR(120),
    "utmMedium" VARCHAR(120),
    "utmCampaign" VARCHAR(160),
    "utmContent" VARCHAR(160),
    "utmTerm" VARCHAR(160),
    "salonId" VARCHAR(80),
    "employeeProfileId" UUID,
    "city" VARCHAR(80),
    "budgetPaise" BIGINT,
    "startsAt" TIMESTAMPTZ(6),
    "endsAt" TIMESTAMPTZ(6),
    "googleAdsCampaignId" VARCHAR(60),
    "metaCampaignId" VARCHAR(60),
    "notes" VARCHAR(500),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vi_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_campaign_expense_links" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "financeExpenseId" UUID NOT NULL,
    "linkedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_campaign_expense_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_segments" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "rule" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "frequencyCapPerWeek" INTEGER NOT NULL DEFAULT 2,
    "memberCount" INTEGER,
    "consentedCount" INTEGER,
    "lastComputedAt" TIMESTAMPTZ(6),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vi_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_marketing_preferences" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "optedIn" BOOLEAN NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(200),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_marketing_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_insights" (
    "id" UUID NOT NULL,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "supportingData" JSONB NOT NULL,
    "periodFrom" TIMESTAMPTZ(6) NOT NULL,
    "periodTo" TIMESTAMPTZ(6) NOT NULL,
    "impact" VARCHAR(300) NOT NULL,
    "confidencePct" INTEGER NOT NULL,
    "priority" VARCHAR(10) NOT NULL,
    "action" VARCHAR(500) NOT NULL,
    "department" VARCHAR(30) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'RULE',
    "status" "ViInsightStatus" NOT NULL DEFAULT 'NEW',
    "decisionNote" VARCHAR(300),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "crmTaskId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_alert_rules" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowMinutes" INTEGER NOT NULL DEFAULT 60,
    "severity" "ViSeverity" NOT NULL DEFAULT 'WARNING',
    "channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "recipientUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 240,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMPTZ(6),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vi_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_alert_events" (
    "id" UUID NOT NULL,
    "ruleId" UUID,
    "kind" VARCHAR(40) NOT NULL,
    "severity" "ViSeverity" NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "firedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(6),
    "acknowledgedByUserId" TEXT,

    CONSTRAINT "vi_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_daily_metrics" (
    "day" DATE NOT NULL,
    "metric" VARCHAR(40) NOT NULL,
    "dimType" VARCHAR(20) NOT NULL,
    "dimValue" VARCHAR(120) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "vi_daily_metrics_pkey" PRIMARY KEY ("day","metric","dimType","dimValue")
);

-- CreateTable
CREATE TABLE "vi_integration_settings" (
    "provider" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretsCipher" TEXT,
    "lastSyncAt" TIMESTAMPTZ(6),
    "lastStatus" VARCHAR(20),
    "lastError" VARCHAR(500),
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vi_integration_settings_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "vi_external_metrics" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "day" DATE NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "key" VARCHAR(300) NOT NULL,
    "dims" JSONB,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "vi_external_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "settings" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vi_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_staff_roles" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ViStaffRoleKind" NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_staff_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_report_schedules" (
    "id" UUID NOT NULL,
    "reportType" VARCHAR(20) NOT NULL,
    "format" VARCHAR(5) NOT NULL,
    "frequency" VARCHAR(10) NOT NULL,
    "period" VARCHAR(10) NOT NULL DEFAULT '7d',
    "recipientUserIds" TEXT[],
    "nextRunAt" TIMESTAMPTZ(6) NOT NULL,
    "lastRunAt" TIMESTAMPTZ(6),
    "lastStatus" VARCHAR(200),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_privacy_requests" (
    "id" UUID NOT NULL,
    "type" "ViPrivacyRequestType" NOT NULL,
    "visitorKey" CHAR(64),
    "userId" TEXT,
    "status" "ViPrivacyRequestStatus" NOT NULL DEFAULT 'OPEN',
    "note" VARCHAR(300),
    "result" JSONB,
    "requestedByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vi_opportunity_assignments" (
    "id" UUID NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "state" VARCHAR(80),
    "level" VARCHAR(10) NOT NULL,
    "score" INTEGER NOT NULL,
    "metrics" JSONB NOT NULL,
    "crmTaskId" UUID NOT NULL,
    "assigneeEmployeeId" UUID NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vi_opportunity_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vi_visitors_visitorKey_key" ON "vi_visitors"("visitorKey");

-- CreateIndex
CREATE UNIQUE INDEX "vi_visitors_guestNumber_key" ON "vi_visitors"("guestNumber");

-- CreateIndex
CREATE INDEX "vi_visitors_lastSeenAt_idx" ON "vi_visitors"("lastSeenAt");

-- CreateIndex
CREATE INDEX "vi_visitors_firstSeenAt_idx" ON "vi_visitors"("firstSeenAt");

-- CreateIndex
CREATE INDEX "vi_visitors_userId_idx" ON "vi_visitors"("userId");

-- CreateIndex
CREATE INDEX "vi_visitors_city_lastSeenAt_idx" ON "vi_visitors"("city", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "vi_sessions_clientSessionId_key" ON "vi_sessions"("clientSessionId");

-- CreateIndex
CREATE INDEX "vi_sessions_lastActivityAt_idx" ON "vi_sessions"("lastActivityAt");

-- CreateIndex
CREATE INDEX "vi_sessions_startedAt_idx" ON "vi_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "vi_sessions_visitorId_startedAt_idx" ON "vi_sessions"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "vi_sessions_city_startedAt_idx" ON "vi_sessions"("city", "startedAt");

-- CreateIndex
CREATE INDEX "vi_sessions_channel_startedAt_idx" ON "vi_sessions"("channel", "startedAt");

-- CreateIndex
CREATE INDEX "vi_sessions_campaignId_startedAt_idx" ON "vi_sessions"("campaignId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vi_events_clientEventId_key" ON "vi_events"("clientEventId");

-- CreateIndex
CREATE INDEX "vi_events_occurredAt_idx" ON "vi_events"("occurredAt");

-- CreateIndex
CREATE INDEX "vi_events_type_occurredAt_idx" ON "vi_events"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_events_sessionId_occurredAt_idx" ON "vi_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_events_visitorId_occurredAt_idx" ON "vi_events"("visitorId", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_events_salonId_type_occurredAt_idx" ON "vi_events"("salonId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_events_city_type_occurredAt_idx" ON "vi_events"("city", "type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "vi_search_events_eventId_key" ON "vi_search_events"("eventId");

-- CreateIndex
CREATE INDEX "vi_search_events_occurredAt_idx" ON "vi_search_events"("occurredAt");

-- CreateIndex
CREATE INDEX "vi_search_events_normalizedQuery_occurredAt_idx" ON "vi_search_events"("normalizedQuery", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_search_events_category_occurredAt_idx" ON "vi_search_events"("category", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_search_events_city_occurredAt_idx" ON "vi_search_events"("city", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_search_events_sessionId_occurredAt_idx" ON "vi_search_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_conversions_occurredAt_idx" ON "vi_conversions"("occurredAt");

-- CreateIndex
CREATE INDEX "vi_conversions_lastCampaignId_occurredAt_idx" ON "vi_conversions"("lastCampaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_conversions_firstCampaignId_occurredAt_idx" ON "vi_conversions"("firstCampaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "vi_conversions_salonId_occurredAt_idx" ON "vi_conversions"("salonId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "vi_conversions_type_entityId_key" ON "vi_conversions"("type", "entityId");

-- CreateIndex
CREATE INDEX "vi_consent_records_visitorKey_createdAt_idx" ON "vi_consent_records"("visitorKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vi_campaigns_code_key" ON "vi_campaigns"("code");

-- CreateIndex
CREATE INDEX "vi_campaigns_status_createdAt_idx" ON "vi_campaigns"("status", "createdAt");

-- CreateIndex
CREATE INDEX "vi_campaigns_kind_idx" ON "vi_campaigns"("kind");

-- CreateIndex
CREATE INDEX "vi_campaign_expense_links_financeExpenseId_idx" ON "vi_campaign_expense_links"("financeExpenseId");

-- CreateIndex
CREATE UNIQUE INDEX "vi_campaign_expense_links_campaignId_financeExpenseId_key" ON "vi_campaign_expense_links"("campaignId", "financeExpenseId");

-- CreateIndex
CREATE UNIQUE INDEX "vi_marketing_preferences_userId_channel_key" ON "vi_marketing_preferences"("userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "vi_insights_dedupeKey_key" ON "vi_insights"("dedupeKey");

-- CreateIndex
CREATE INDEX "vi_insights_status_createdAt_idx" ON "vi_insights"("status", "createdAt");

-- CreateIndex
CREATE INDEX "vi_insights_kind_createdAt_idx" ON "vi_insights"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "vi_alert_events_firedAt_idx" ON "vi_alert_events"("firedAt");

-- CreateIndex
CREATE INDEX "vi_alert_events_acknowledgedAt_firedAt_idx" ON "vi_alert_events"("acknowledgedAt", "firedAt");

-- CreateIndex
CREATE INDEX "vi_daily_metrics_metric_dimType_day_idx" ON "vi_daily_metrics"("metric", "dimType", "day");

-- CreateIndex
CREATE INDEX "vi_external_metrics_provider_kind_day_idx" ON "vi_external_metrics"("provider", "kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX "vi_external_metrics_provider_day_kind_key_key" ON "vi_external_metrics"("provider", "day", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "vi_staff_roles_userId_role_key" ON "vi_staff_roles"("userId", "role");

-- CreateIndex
CREATE INDEX "vi_report_schedules_enabled_nextRunAt_idx" ON "vi_report_schedules"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "vi_privacy_requests_status_createdAt_idx" ON "vi_privacy_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "vi_opportunity_assignments_city_createdAt_idx" ON "vi_opportunity_assignments"("city", "createdAt");

-- AddForeignKey
ALTER TABLE "vi_sessions" ADD CONSTRAINT "vi_sessions_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "vi_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vi_campaign_expense_links" ADD CONSTRAINT "vi_campaign_expense_links_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "vi_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vi_alert_events" ADD CONSTRAINT "vi_alert_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "vi_alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;


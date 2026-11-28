-- FastQue Connect (docs/connect/). Additive only: new connect_* tables and enums, foreign keys from
-- them to existing tables. No existing table or column is altered. Rollback: docs/connect/DEPLOYMENT.md.

-- CreateEnum
CREATE TYPE "ConnectConversationKind" AS ENUM ('SALON_BOOKING', 'LIVE_QUEUE', 'HOME_SERVICE');

-- CreateEnum
CREATE TYPE "ConnectConversationStatus" AS ENUM ('ACTIVE', 'READ_ONLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConnectPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ConnectAwaiting" AS ENUM ('NONE', 'CUSTOMER', 'SALON');

-- CreateEnum
CREATE TYPE "ConnectSenderKind" AS ENUM ('CUSTOMER', 'SALON', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ConnectMessageKind" AS ENUM ('TEXT', 'IMAGE', 'VOICE', 'FILE', 'LOCATION', 'ACTION', 'QUOTATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ConnectSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'ATTENTION');

-- CreateEnum
CREATE TYPE "ConnectStaffRole" AS ENUM ('MANAGER', 'RECEPTIONIST', 'STYLIST');

-- CreateEnum
CREATE TYPE "ConnectActionKind" AS ENUM ('RESCHEDULE', 'CANCEL', 'ADD_SERVICE', 'REMOVE_SERVICE', 'CHANGE_STYLIST', 'LATE_ARRIVAL', 'JOIN_QUEUE_SLOT', 'ADD_FAMILY_MEMBER');

-- CreateEnum
CREATE TYPE "ConnectActionStatus" AS ENUM ('AWAITING_CUSTOMER', 'AWAITING_SALON', 'APPLIED', 'ACKNOWLEDGED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConnectQuotationStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'CHANGES_REQUESTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConnectReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "connect_conversations" (
    "id" UUID NOT NULL,
    "kind" "ConnectConversationKind" NOT NULL,
    "salonId" TEXT,
    "homeProviderId" TEXT,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "queueEntryId" TEXT,
    "homeBookingId" TEXT,
    "groupKey" VARCHAR(40),
    "status" "ConnectConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" "ConnectPriority" NOT NULL DEFAULT 'NORMAL',
    "awaiting" "ConnectAwaiting" NOT NULL DEFAULT 'NONE',
    "aiHandled" BOOLEAN NOT NULL DEFAULT false,
    "hasOpenComplaint" BOOLEAN NOT NULL DEFAULT false,
    "customerBlockedAt" TIMESTAMPTZ(6),
    "salonBlockedAt" TIMESTAMPTZ(6),
    "sentiment" "ConnectSentiment",
    "sentimentReason" VARCHAR(200),
    "tags" TEXT[],
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMPTZ(6),
    "lockUserId" TEXT,
    "lockExpiresAt" TIMESTAMPTZ(6),
    "lastMessageSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMPTZ(6),
    "lastSalonReplySeq" INTEGER NOT NULL DEFAULT 0,
    "firstCustomerMsgAt" TIMESTAMPTZ(6),
    "firstSalonReplyAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "readOnlyAt" TIMESTAMPTZ(6),
    "reopenedUntil" TIMESTAMPTZ(6),
    "summary" VARCHAR(1200),
    "summaryAt" TIMESTAMPTZ(6),
    "queueState" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_participants" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "side" "ConnectSenderKind" NOT NULL,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveredSeq" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMPTZ(6),
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "senderUserId" TEXT,
    "senderKind" "ConnectSenderKind" NOT NULL,
    "kind" "ConnectMessageKind" NOT NULL DEFAULT 'TEXT',
    "body" VARCHAR(4000),
    "language" VARCHAR(12),
    "intent" VARCHAR(40),
    "replyToId" UUID,
    "clientMessageId" VARCHAR(64),
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_message_edits" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "previousBody" VARCHAR(4000),
    "editedByUserId" TEXT NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_message_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_attachments" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID,
    "uploaderUserId" TEXT NOT NULL,
    "storageKey" VARCHAR(300) NOT NULL,
    "mimeType" VARCHAR(60) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "fileName" VARCHAR(120),
    "scanStatus" VARCHAR(16) NOT NULL DEFAULT 'NOT_SCANNED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_reactions" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_internal_notes" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_saved_replies" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_saved_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_assignment_events" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_staff_grants" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ConnectStaffRole" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_staff_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_ai_interactions" (
    "id" UUID NOT NULL,
    "salonId" TEXT,
    "conversationId" UUID,
    "messageId" UUID,
    "feature" VARCHAR(24) NOT NULL,
    "engine" VARCHAR(8) NOT NULL,
    "provider" VARCHAR(24),
    "model" VARCHAR(80),
    "intent" VARCHAR(40),
    "confidence" DOUBLE PRECISION,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" VARCHAR(60),
    "injectionFlagged" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_ai_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_translations" (
    "id" UUID NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "sourceLang" VARCHAR(12),
    "targetLang" VARCHAR(12) NOT NULL,
    "text" VARCHAR(6000) NOT NULL,
    "engine" VARCHAR(8) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_consent_records" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "salonId" TEXT,
    "purpose" VARCHAR(32) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_booking_actions" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "kind" "ConnectActionKind" NOT NULL,
    "status" "ConnectActionStatus" NOT NULL,
    "requestedByUserId" TEXT,
    "requestedBy" "ConnectSenderKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "customerApprovedAt" TIMESTAMPTZ(6),
    "salonApprovedAt" TIMESTAMPTZ(6),
    "salonApprovedById" TEXT,
    "appliedAt" TIMESTAMPTZ(6),
    "resultNote" VARCHAR(300),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_booking_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_quotations" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "salonId" TEXT,
    "title" VARCHAR(120) NOT NULL,
    "status" "ConnectQuotationStatus" NOT NULL DEFAULT 'SENT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "acceptedVersion" INTEGER,
    "decidedAt" TIMESTAMPTZ(6),
    "customerNote" VARCHAR(500),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_quotation_versions" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "validUntil" TIMESTAMPTZ(6) NOT NULL,
    "terms" VARCHAR(1000),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_quotation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_complaints" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "supportTicketId" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_reports" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID,
    "reporterUserId" TEXT NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "details" VARCHAR(1000),
    "status" "ConnectReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_analytics_events" (
    "id" UUID NOT NULL,
    "salonId" TEXT,
    "homeProviderId" TEXT,
    "conversationId" UUID,
    "type" VARCHAR(40) NOT NULL,
    "actorUserId" TEXT,
    "valuePaise" INTEGER,
    "seconds" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_audit_events" (
    "id" UUID NOT NULL,
    "salonId" TEXT,
    "conversationId" UUID,
    "actorUserId" TEXT,
    "action" VARCHAR(60) NOT NULL,
    "purpose" VARCHAR(300),
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_salon_settings" (
    "id" UUID NOT NULL,
    "salonId" TEXT,
    "homeProviderId" TEXT,
    "aiMode" VARCHAR(8) NOT NULL DEFAULT 'OFF',
    "autoReplyIntents" TEXT[],
    "translationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "followUpsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "faq" JSONB,
    "parkingInfo" VARCHAR(500),
    "directions" VARCHAR(500),
    "aftercare" VARCHAR(800),
    "aiMonthlyBudgetMicroUsd" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_salon_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_platform_config" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'global',
    "config" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_platform_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_location_shares" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" INTEGER,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_location_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_follow_ups" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "promotional" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "sentAt" TIMESTAMPTZ(6),
    "skippedReason" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_user_prefs" (
    "userId" TEXT NOT NULL,
    "showOnline" BOOLEAN NOT NULL DEFAULT false,
    "showLastActive" BOOLEAN NOT NULL DEFAULT false,
    "notificationPreviews" BOOLEAN NOT NULL DEFAULT false,
    "preferredLanguage" VARCHAR(12),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connect_user_prefs_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "connect_conversations_bookingId_key" ON "connect_conversations"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "connect_conversations_queueEntryId_key" ON "connect_conversations"("queueEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "connect_conversations_homeBookingId_key" ON "connect_conversations"("homeBookingId");

-- CreateIndex
CREATE INDEX "connect_conversations_salonId_lastMessageAt_idx" ON "connect_conversations"("salonId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "connect_conversations_homeProviderId_lastMessageAt_idx" ON "connect_conversations"("homeProviderId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "connect_conversations_customerId_lastMessageAt_idx" ON "connect_conversations"("customerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "connect_conversations_salonId_status_awaiting_idx" ON "connect_conversations"("salonId", "status", "awaiting");

-- CreateIndex
CREATE INDEX "connect_conversations_groupKey_idx" ON "connect_conversations"("groupKey");

-- CreateIndex
CREATE INDEX "connect_participants_userId_idx" ON "connect_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "connect_participants_conversationId_userId_key" ON "connect_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "connect_messages_conversationId_createdAt_idx" ON "connect_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "connect_messages_conversationId_seq_key" ON "connect_messages"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "connect_messages_conversationId_senderUserId_clientMessageI_key" ON "connect_messages"("conversationId", "senderUserId", "clientMessageId");

-- CreateIndex
CREATE INDEX "connect_message_edits_messageId_idx" ON "connect_message_edits"("messageId");

-- CreateIndex
CREATE INDEX "connect_attachments_conversationId_idx" ON "connect_attachments"("conversationId");

-- CreateIndex
CREATE INDEX "connect_attachments_createdAt_idx" ON "connect_attachments"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "connect_reactions_messageId_userId_emoji_key" ON "connect_reactions"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "connect_internal_notes_conversationId_createdAt_idx" ON "connect_internal_notes"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "connect_saved_replies_salonId_idx" ON "connect_saved_replies"("salonId");

-- CreateIndex
CREATE INDEX "connect_assignment_events_conversationId_idx" ON "connect_assignment_events"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "connect_staff_grants_salonId_userId_key" ON "connect_staff_grants"("salonId", "userId");

-- CreateIndex
CREATE INDEX "connect_ai_interactions_salonId_createdAt_idx" ON "connect_ai_interactions"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "connect_ai_interactions_createdAt_idx" ON "connect_ai_interactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "connect_translations_sourceHash_targetLang_key" ON "connect_translations"("sourceHash", "targetLang");

-- CreateIndex
CREATE INDEX "connect_consent_records_userId_purpose_createdAt_idx" ON "connect_consent_records"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "connect_booking_actions_conversationId_status_idx" ON "connect_booking_actions"("conversationId", "status");

-- CreateIndex
CREATE INDEX "connect_quotations_conversationId_idx" ON "connect_quotations"("conversationId");

-- CreateIndex
CREATE INDEX "connect_quotations_salonId_createdAt_idx" ON "connect_quotations"("salonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "connect_quotation_versions_quotationId_version_key" ON "connect_quotation_versions"("quotationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "connect_complaints_supportTicketId_key" ON "connect_complaints"("supportTicketId");

-- CreateIndex
CREATE INDEX "connect_complaints_conversationId_idx" ON "connect_complaints"("conversationId");

-- CreateIndex
CREATE INDEX "connect_reports_status_createdAt_idx" ON "connect_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "connect_analytics_events_salonId_type_createdAt_idx" ON "connect_analytics_events"("salonId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "connect_analytics_events_type_createdAt_idx" ON "connect_analytics_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "connect_audit_events_conversationId_createdAt_idx" ON "connect_audit_events"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "connect_audit_events_salonId_createdAt_idx" ON "connect_audit_events"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "connect_audit_events_actorUserId_createdAt_idx" ON "connect_audit_events"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "connect_salon_settings_salonId_key" ON "connect_salon_settings"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "connect_salon_settings_homeProviderId_key" ON "connect_salon_settings"("homeProviderId");

-- CreateIndex
CREATE INDEX "connect_location_shares_conversationId_expiresAt_idx" ON "connect_location_shares"("conversationId", "expiresAt");

-- CreateIndex
CREATE INDEX "connect_follow_ups_sentAt_dueAt_idx" ON "connect_follow_ups"("sentAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "connect_follow_ups_conversationId_kind_key" ON "connect_follow_ups"("conversationId", "kind");

-- AddForeignKey
ALTER TABLE "connect_conversations" ADD CONSTRAINT "connect_conversations_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_conversations" ADD CONSTRAINT "connect_conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_conversations" ADD CONSTRAINT "connect_conversations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_conversations" ADD CONSTRAINT "connect_conversations_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "queue_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_conversations" ADD CONSTRAINT "connect_conversations_homeBookingId_fkey" FOREIGN KEY ("homeBookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_participants" ADD CONSTRAINT "connect_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_messages" ADD CONSTRAINT "connect_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_message_edits" ADD CONSTRAINT "connect_message_edits_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "connect_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_attachments" ADD CONSTRAINT "connect_attachments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_attachments" ADD CONSTRAINT "connect_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "connect_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_reactions" ADD CONSTRAINT "connect_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "connect_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_internal_notes" ADD CONSTRAINT "connect_internal_notes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_assignment_events" ADD CONSTRAINT "connect_assignment_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_booking_actions" ADD CONSTRAINT "connect_booking_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_quotations" ADD CONSTRAINT "connect_quotations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_quotation_versions" ADD CONSTRAINT "connect_quotation_versions_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "connect_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_complaints" ADD CONSTRAINT "connect_complaints_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_reports" ADD CONSTRAINT "connect_reports_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_location_shares" ADD CONSTRAINT "connect_location_shares_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_follow_ups" ADD CONSTRAINT "connect_follow_ups_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "connect_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one booking link per conversation.
ALTER TABLE "connect_conversations" ADD CONSTRAINT "connect_conversations_one_link_chk"
  CHECK ((("bookingId" IS NOT NULL)::int + ("queueEntryId" IS NOT NULL)::int + ("homeBookingId" IS NOT NULL)::int) = 1);
-- A tenant is always present.
ALTER TABLE "connect_conversations" ADD CONSTRAINT "connect_conversations_tenant_chk"
  CHECK ("salonId" IS NOT NULL OR "homeProviderId" IS NOT NULL);

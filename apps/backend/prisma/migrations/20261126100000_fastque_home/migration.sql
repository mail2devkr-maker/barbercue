-- FastQue Home. Additive only: new enums, tables, indexes, constraints and reference catalogue rows.
-- No existing table, column or row is changed. Rollback: see docs/home/DEPLOYMENT.md.

-- CreateEnum
CREATE TYPE "HomeProviderKind" AS ENUM ('SALON_MANAGED', 'INDEPENDENT_PROFESSIONAL');

-- CreateEnum
CREATE TYPE "HomeProviderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "HomeServiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "HomeAreaKind" AS ENUM ('RADIUS', 'PINCODE', 'LOCALITY', 'CITY', 'SOCIETY');

-- CreateEnum
CREATE TYPE "HomeTravelMode" AS ENUM ('WALK', 'BICYCLE', 'TWO_WHEELER', 'CAR', 'PUBLIC_TRANSPORT');

-- CreateEnum
CREATE TYPE "ProfessionalCommitmentKind" AS ENUM ('HOME_HOLD', 'HOME_BOOKING', 'BREAK', 'TIME_OFF');

-- CreateEnum
CREATE TYPE "HomeBookingMode" AS ENUM ('INSTANT', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "HomePreference" AS ENUM ('SPECIFIC_PROFESSIONAL', 'SPECIFIC_PROVIDER', 'FASTEST');

-- CreateEnum
CREATE TYPE "HomeBookingStatus" AS ENUM ('DRAFT', 'REQUESTED', 'AWAITING_ASSIGNMENT', 'INVITED', 'ACCEPTED', 'CONFIRMED', 'PREPARING', 'ON_THE_WAY', 'ARRIVED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'CLOSED', 'NO_PROFESSIONAL', 'EXPIRED', 'RESCHEDULE_REQUESTED', 'REPLACEMENT_REQUESTED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROFESSIONAL', 'CANCELLED_BY_SALON', 'CANCELLED_BY_PLATFORM', 'CUSTOMER_NO_SHOW', 'PROFESSIONAL_NO_SHOW', 'ADDRESS_ISSUE', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "HomePaymentStatus" AS ENUM ('NOT_DUE', 'PENDING', 'PARTIAL', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "HomePaymentMethod" AS ENUM ('CASH', 'DIRECT_UPI', 'OTHER_OFFLINE');

-- CreateEnum
CREATE TYPE "HomeComplaintStatus" AS ENUM ('NONE', 'RAISED', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "HomeRefundStatus" AS ENUM ('NONE', 'APPROVED', 'RECORDED');

-- CreateEnum
CREATE TYPE "HomeInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "HomeAssignmentStatus" AS ENUM ('ACTIVE', 'RELEASED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HomeCodePurpose" AS ENUM ('START', 'COMPLETE');

-- CreateEnum
CREATE TYPE "HomeVerificationScope" AS ENUM ('MOBILE', 'IDENTITY', 'EXPERIENCE', 'TRAINING_CERTIFICATE', 'REFERENCES', 'SKILL_ASSESSMENT', 'EQUIPMENT', 'HYGIENE_TRAINING', 'SERVICE_QUALIFICATION', 'BACKGROUND_CHECK');

-- CreateEnum
CREATE TYPE "HomeVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "HomeAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "home_providers" (
    "id" TEXT NOT NULL,
    "kind" "HomeProviderKind" NOT NULL,
    "status" "HomeProviderStatus" NOT NULL DEFAULT 'DRAFT',
    "salonId" TEXT,
    "userId" TEXT,
    "displayName" VARCHAR(120) NOT NULL,
    "bio" VARCHAR(1000),
    "category" VARCHAR(60),
    "city" VARCHAR(80) NOT NULL,
    "locality" VARCHAR(120),
    "baseLat" DOUBLE PRECISION,
    "baseLng" DOUBLE PRECISION,
    "languages" TEXT[],
    "equipment" TEXT[],
    "productsCarried" TEXT[],
    "travelMode" "HomeTravelMode" NOT NULL DEFAULT 'TWO_WHEELER',
    "maxTravelMinutes" INTEGER NOT NULL DEFAULT 60,
    "instantEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduledEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "autoDispatch" BOOLEAN NOT NULL DEFAULT true,
    "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
    "travelFeePaise" INTEGER NOT NULL DEFAULT 0,
    "weekendSurchargePct" INTEGER NOT NULL DEFAULT 0,
    "peakSurchargePct" INTEGER NOT NULL DEFAULT 0,
    "peakStart" VARCHAR(5),
    "peakEnd" VARCHAR(5),
    "groupDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "groupDiscountMin" INTEGER NOT NULL DEFAULT 3,
    "upiVpa" VARCHAR(100),
    "invoiceIssuer" VARCHAR(160),
    "minStaffInSalon" INTEGER NOT NULL DEFAULT 1,
    "maxHomeStaff" INTEGER NOT NULL DEFAULT 1,
    "queueWaitingLimit" INTEGER NOT NULL DEFAULT 3,
    "manualApproval" BOOLEAN NOT NULL DEFAULT false,
    "blockWeekends" BOOLEAN NOT NULL DEFAULT false,
    "blockedStart" VARCHAR(5),
    "blockedEnd" VARCHAR(5),
    "emergencyName" VARCHAR(120),
    "emergencyPhone" VARCHAR(20),
    "compensation" JSONB,
    "termsVersion" VARCHAR(20),
    "termsAcceptedAt" TIMESTAMPTZ(6),
    "publicConsentAt" TIMESTAMPTZ(6),
    "adultDeclaredAt" TIMESTAMPTZ(6),
    "assistedByUserId" TEXT,
    "submittedAt" TIMESTAMPTZ(6),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_professionals" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salonStaffId" TEXT,
    "displayName" VARCHAR(120) NOT NULL,
    "photoUrl" VARCHAR(500),
    "bio" VARCHAR(1000),
    "yearsExperience" INTEGER,
    "skills" TEXT[],
    "languages" TEXT[],
    "portfolioUrls" TEXT[],
    "consentAt" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "suspendedAt" TIMESTAMPTZ(6),
    "dedicated" BOOLEAN NOT NULL DEFAULT false,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "onlineSince" TIMESTAMPTZ(6),
    "maxPerDay" INTEGER NOT NULL DEFAULT 6,
    "priceUpliftPct" INTEGER NOT NULL DEFAULT 0,
    "trustedContact" VARCHAR(20),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_categories" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "groupCode" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameHi" VARCHAR(120) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiresQualification" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "home_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_service_defs" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameHi" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "imageUrl" VARCHAR(500),
    "synonyms" TEXT[],
    "durationMinutes" INTEGER NOT NULL,
    "prepMinutes" INTEGER NOT NULL DEFAULT 5,
    "cleanupMinutes" INTEGER NOT NULL DEFAULT 5,
    "requiredSkills" TEXT[],
    "requiredEquipment" TEXT[],
    "productNotes" VARCHAR(500),
    "customerPreparation" VARCHAR(500),
    "eligibility" VARCHAR(500),
    "safetyInstructions" VARCHAR(1000),
    "addOnCodes" TEXT[],
    "cancellationNote" VARCHAR(500),
    "pricingModel" VARCHAR(20) NOT NULL DEFAULT 'FIXED',
    "customerProducts" BOOLEAN NOT NULL DEFAULT false,
    "forChildren" BOOLEAN NOT NULL DEFAULT false,
    "minPricePaise" INTEGER,
    "maxPricePaise" INTEGER,
    "status" "HomeServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_service_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_offerings" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "serviceDefId" TEXT NOT NULL,
    "salonServiceId" TEXT,
    "title" VARCHAR(120),
    "pricePaise" INTEGER NOT NULL,
    "productPaise" INTEGER NOT NULL DEFAULT 0,
    "disposablePaise" INTEGER NOT NULL DEFAULT 0,
    "equipmentPaise" INTEGER NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL,
    "variants" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_offering_products" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "home_offering_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_professional_services" (
    "professionalId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,

    CONSTRAINT "home_professional_services_pkey" PRIMARY KEY ("professionalId","offeringId")
);

-- CreateTable
CREATE TABLE "home_service_areas" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" "HomeAreaKind" NOT NULL,
    "value" VARCHAR(120) NOT NULL,
    "radiusKm" DOUBLE PRECISION,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "surchargePaise" INTEGER NOT NULL DEFAULT 0,
    "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_schedules" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,

    CONSTRAINT "home_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_commitments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProfessionalCommitmentKind" NOT NULL,
    "startAt" TIMESTAMPTZ(6) NOT NULL,
    "endAt" TIMESTAMPTZ(6) NOT NULL,
    "serviceStart" TIMESTAMPTZ(6),
    "serviceEnd" TIMESTAMPTZ(6),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "postalCode" VARCHAR(10),
    "bookingId" TEXT,
    "note" VARCHAR(200),
    "expiresAt" TIMESTAMPTZ(6),
    "releasedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "label" VARCHAR(20) NOT NULL DEFAULT 'HOME',
    "house" VARCHAR(120) NOT NULL,
    "building" VARCHAR(160),
    "street" VARCHAR(200),
    "locality" VARCHAR(120) NOT NULL,
    "landmark" VARCHAR(160),
    "city" VARCHAR(80) NOT NULL,
    "state" VARCHAR(80) NOT NULL,
    "postalCode" VARCHAR(10) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accessNotes" VARCHAR(300),
    "contactName" VARCHAR(120),
    "contactPhone" VARCHAR(20),
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_bookings" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "customerId" TEXT,
    "guestName" VARCHAR(120),
    "guestPhone" VARCHAR(20),
    "guestPhoneVerifiedAt" TIMESTAMPTZ(6),
    "guestAccessHash" VARCHAR(64),
    "groupKey" VARCHAR(40),
    "providerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "mode" "HomeBookingMode" NOT NULL,
    "preference" "HomePreference" NOT NULL,
    "preferredProfessionalId" TEXT,
    "allowAlternatives" BOOLEAN NOT NULL DEFAULT false,
    "status" "HomeBookingStatus" NOT NULL,
    "paymentStatus" "HomePaymentStatus" NOT NULL DEFAULT 'NOT_DUE',
    "complaintStatus" "HomeComplaintStatus" NOT NULL DEFAULT 'NONE',
    "refundStatus" "HomeRefundStatus" NOT NULL DEFAULT 'NONE',
    "paymentMethod" "HomePaymentMethod" NOT NULL,
    "serviceStart" TIMESTAMPTZ(6) NOT NULL,
    "serviceEnd" TIMESTAMPTZ(6) NOT NULL,
    "etaFrom" TIMESTAMPTZ(6),
    "etaTo" TIMESTAMPTZ(6),
    "etaConfidence" VARCHAR(10),
    "etaBasis" JSONB,
    "totalPaise" INTEGER NOT NULL,
    "priceSnapshot" JSONB NOT NULL,
    "termsSnapshot" JSONB NOT NULL,
    "notes" VARCHAR(500),
    "productPreference" VARCHAR(20) NOT NULL DEFAULT 'PROFESSIONAL',
    "forChild" BOOLEAN NOT NULL DEFAULT false,
    "guardianConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "travelStartedAt" TIMESTAMPTZ(6),
    "arrivedAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" VARCHAR(500),
    "rescheduleTo" TIMESTAMPTZ(6),
    "replacementProposedId" TEXT,
    "dispatchDeadline" TIMESTAMPTZ(6),
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "recurringPlanId" TEXT,
    "campaignId" TEXT,
    "promotionId" TEXT,
    "shareHash" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_booking_items" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "offeringId" TEXT,
    "serviceDefId" TEXT NOT NULL,
    "serviceName" VARCHAR(120) NOT NULL,
    "variantCode" VARCHAR(40),
    "personName" VARCHAR(80),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPaise" INTEGER NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "addedLater" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "home_booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_booking_events" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "fromStatus" VARCHAR(40),
    "toStatus" VARCHAR(40),
    "actorUserId" TEXT,
    "actorParty" VARCHAR(20) NOT NULL,
    "note" VARCHAR(1000),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_invitations" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" "HomeInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(200) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "respondedAt" TIMESTAMPTZ(6),
    "declineNote" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_assignments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "status" "HomeAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(6),
    "releaseReason" VARCHAR(300),

    CONSTRAINT "home_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_service_codes" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "purpose" "HomeCodePurpose" NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_service_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_tracking_sessions" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "professionalUserId" TEXT NOT NULL,
    "consentAt" TIMESTAMPTZ(6) NOT NULL,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastAccuracyM" DOUBLE PRECISION,
    "lastAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),
    "endReason" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_tracking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_payment_records" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "method" "HomePaymentMethod" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "tipPaise" INTEGER NOT NULL DEFAULT 0,
    "collectedBy" VARCHAR(160) NOT NULL,
    "reference" VARCHAR(80),
    "recordedByUserId" TEXT NOT NULL,
    "customerConfirmedAt" TIMESTAMPTZ(6),
    "disputedAt" TIMESTAMPTZ(6),
    "disputeNote" VARCHAR(500),
    "voidedAt" TIMESTAMPTZ(6),
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_earnings" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "servicePaise" INTEGER NOT NULL,
    "travelPaise" INTEGER NOT NULL,
    "productPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL,
    "tipPaise" INTEGER NOT NULL DEFAULT 0,
    "platformFeePaise" INTEGER NOT NULL DEFAULT 0,
    "staffPayoutPaise" INTEGER NOT NULL DEFAULT 0,
    "productCostPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_price_adjustments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "offeringId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "HomeAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_price_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_product_uses" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" VARCHAR(160) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "movementId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_product_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_verifications" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "scope" "HomeVerificationScope" NOT NULL,
    "subject" VARCHAR(60) NOT NULL DEFAULT '',
    "status" "HomeVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceNote" VARCHAR(1000),
    "evidenceKey" VARCHAR(300),
    "evidenceType" VARCHAR(60),
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMPTZ(6),
    "reviewNote" VARCHAR(1000),
    "expiresAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_hygiene_records" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "stage" VARCHAR(10) NOT NULL,
    "answers" JSONB NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_hygiene_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_reviews" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "customerId" TEXT,
    "overall" INTEGER NOT NULL,
    "quality" INTEGER NOT NULL,
    "behaviour" INTEGER NOT NULL,
    "punctuality" INTEGER NOT NULL,
    "hygiene" INTEGER NOT NULL,
    "transparency" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "response" VARCHAR(1000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    "reportReason" VARCHAR(300),
    "moderatedByUserId" TEXT,
    "moderationNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_professional_feedback" (
    "bookingId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "communication" INTEGER NOT NULL,
    "addressAccuracy" INTEGER NOT NULL,
    "conditions" INTEGER NOT NULL,
    "payment" INTEGER NOT NULL,
    "safetyConcern" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_professional_feedback_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "home_incidents" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "reporterUserId" TEXT,
    "reporterParty" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "severity" VARCHAR(10) NOT NULL DEFAULT 'HIGH',
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "handledByUserId" TEXT,
    "resolution" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "bookingId" TEXT NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "openedByUserId" TEXT,
    "openedByParty" VARCHAR(20) NOT NULL,
    "assignedToUserId" TEXT,
    "escalatedAt" TIMESTAMPTZ(6),
    "resolution" VARCHAR(2000),
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorParty" VARCHAR(20) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body" VARCHAR(2000) NOT NULL,
    "attachmentKey" VARCHAR(300),
    "attachmentType" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_refund_records" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "settledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_favorites" (
    "userId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_favorites_pkey" PRIMARY KEY ("userId","professionalId")
);

-- CreateTable
CREATE TABLE "home_blocks" (
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_blocks_pkey" PRIMARY KEY ("blockerUserId","blockedUserId")
);

-- CreateTable
CREATE TABLE "home_promotions" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "code" VARCHAR(30) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "percentOff" INTEGER,
    "amountOffPaise" INTEGER,
    "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_packages" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "audience" VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
    "offeringIds" TEXT[],
    "pricePaise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_membership_plans" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "periodMonths" INTEGER NOT NULL DEFAULT 1,
    "benefits" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_memberships" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "offlineReference" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_recurring_plans" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "nextStart" TIMESTAMPTZ(6) NOT NULL,
    "paymentMethod" "HomePaymentMethod" NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "lastOutcome" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_recurring_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_societies" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "locality" VARCHAR(120) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "postalCode" VARCHAR(10) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_societies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_campaigns" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "offeringId" TEXT NOT NULL,
    "minParticipants" INTEGER NOT NULL,
    "maxParticipants" INTEGER NOT NULL,
    "discountPct" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "joinBy" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_campaign_participants" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'JOINED',
    "bookingId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_campaign_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_fee_rules" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "providerKind" "HomeProviderKind",
    "providerId" TEXT,
    "percentBps" INTEGER NOT NULL DEFAULT 0,
    "fixedPaise" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(300),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_platform_fees" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "settlementId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_platform_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_settlements" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DUE',
    "reference" VARCHAR(80),
    "note" VARCHAR(300),
    "createdByUserId" TEXT NOT NULL,
    "collectedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "home_audits" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorParty" VARCHAR(20) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(80) NOT NULL,
    "note" VARCHAR(1000),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_field_leads" (
    "id" TEXT NOT NULL,
    "employeeUserId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20),
    "city" VARCHAR(80) NOT NULL,
    "locality" VARCHAR(120),
    "consentAt" TIMESTAMPTZ(6),
    "providerId" TEXT,
    "societyId" TEXT,
    "stage" VARCHAR(30) NOT NULL DEFAULT 'IDENTIFIED',
    "nextStep" VARCHAR(300),
    "nextAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_field_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_visit_metrics" (
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceDefId" TEXT NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "actualMinutes" INTEGER NOT NULL,
    "plannedTravel" INTEGER,
    "actualTravel" INTEGER,
    "etaErrorMinutes" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_visit_metrics_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_providers_salonId_key" ON "home_providers"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "home_providers_userId_key" ON "home_providers"("userId");

-- CreateIndex
CREATE INDEX "home_providers_status_city_idx" ON "home_providers"("status", "city");

-- CreateIndex
CREATE INDEX "home_providers_kind_status_idx" ON "home_providers"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "home_professionals_salonStaffId_key" ON "home_professionals"("salonStaffId");

-- CreateIndex
CREATE INDEX "home_professionals_userId_idx" ON "home_professionals"("userId");

-- CreateIndex
CREATE INDEX "home_professionals_active_isOnline_idx" ON "home_professionals"("active", "isOnline");

-- CreateIndex
CREATE UNIQUE INDEX "home_professionals_providerId_userId_key" ON "home_professionals"("providerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "home_categories_code_key" ON "home_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "home_service_defs_code_key" ON "home_service_defs"("code");

-- CreateIndex
CREATE INDEX "home_service_defs_categoryId_status_idx" ON "home_service_defs"("categoryId", "status");

-- CreateIndex
CREATE INDEX "home_offerings_serviceDefId_active_idx" ON "home_offerings"("serviceDefId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "home_offerings_providerId_serviceDefId_key" ON "home_offerings"("providerId", "serviceDefId");

-- CreateIndex
CREATE UNIQUE INDEX "home_offering_products_offeringId_productId_key" ON "home_offering_products"("offeringId", "productId");

-- CreateIndex
CREATE INDEX "home_professional_services_offeringId_idx" ON "home_professional_services"("offeringId");

-- CreateIndex
CREATE INDEX "home_service_areas_kind_value_idx" ON "home_service_areas"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "home_service_areas_providerId_kind_value_key" ON "home_service_areas"("providerId", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "home_schedules_professionalId_dayOfWeek_key" ON "home_schedules"("professionalId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "professional_commitments_userId_startAt_idx" ON "professional_commitments"("userId", "startAt");

-- CreateIndex
CREATE INDEX "professional_commitments_bookingId_idx" ON "professional_commitments"("bookingId");

-- CreateIndex
CREATE INDEX "professional_commitments_kind_expiresAt_idx" ON "professional_commitments"("kind", "expiresAt");

-- CreateIndex
CREATE INDEX "home_addresses_userId_archivedAt_idx" ON "home_addresses"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "home_bookings_code_key" ON "home_bookings"("code");

-- CreateIndex
CREATE UNIQUE INDEX "home_bookings_guestAccessHash_key" ON "home_bookings"("guestAccessHash");

-- CreateIndex
CREATE UNIQUE INDEX "home_bookings_idempotencyKey_key" ON "home_bookings"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "home_bookings_shareHash_key" ON "home_bookings"("shareHash");

-- CreateIndex
CREATE INDEX "home_bookings_customerId_createdAt_idx" ON "home_bookings"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "home_bookings_providerId_status_serviceStart_idx" ON "home_bookings"("providerId", "status", "serviceStart");

-- CreateIndex
CREATE INDEX "home_bookings_status_serviceStart_idx" ON "home_bookings"("status", "serviceStart");

-- CreateIndex
CREATE INDEX "home_bookings_status_dispatchDeadline_idx" ON "home_bookings"("status", "dispatchDeadline");

-- CreateIndex
CREATE INDEX "home_bookings_groupKey_idx" ON "home_bookings"("groupKey");

-- CreateIndex
CREATE INDEX "home_booking_items_bookingId_idx" ON "home_booking_items"("bookingId");

-- CreateIndex
CREATE INDEX "home_booking_events_bookingId_createdAt_idx" ON "home_booking_events"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "home_invitations_professionalId_status_idx" ON "home_invitations"("professionalId", "status");

-- CreateIndex
CREATE INDEX "home_invitations_status_expiresAt_idx" ON "home_invitations"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "home_invitations_bookingId_professionalId_round_key" ON "home_invitations"("bookingId", "professionalId", "round");

-- CreateIndex
CREATE INDEX "home_assignments_bookingId_status_idx" ON "home_assignments"("bookingId", "status");

-- CreateIndex
CREATE INDEX "home_assignments_professionalId_status_idx" ON "home_assignments"("professionalId", "status");

-- CreateIndex
CREATE INDEX "home_service_codes_bookingId_purpose_idx" ON "home_service_codes"("bookingId", "purpose");

-- CreateIndex
CREATE INDEX "home_tracking_sessions_bookingId_idx" ON "home_tracking_sessions"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "home_payment_records_idempotencyKey_key" ON "home_payment_records"("idempotencyKey");

-- CreateIndex
CREATE INDEX "home_payment_records_bookingId_idx" ON "home_payment_records"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "home_earnings_bookingId_key" ON "home_earnings"("bookingId");

-- CreateIndex
CREATE INDEX "home_earnings_providerId_createdAt_idx" ON "home_earnings"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "home_earnings_professionalId_createdAt_idx" ON "home_earnings"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "home_price_adjustments_bookingId_idx" ON "home_price_adjustments"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "home_product_uses_movementId_key" ON "home_product_uses"("movementId");

-- CreateIndex
CREATE INDEX "home_product_uses_bookingId_idx" ON "home_product_uses"("bookingId");

-- CreateIndex
CREATE INDEX "home_verifications_status_submittedAt_idx" ON "home_verifications"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "home_verifications_professionalId_scope_subject_key" ON "home_verifications"("professionalId", "scope", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "home_hygiene_records_bookingId_stage_key" ON "home_hygiene_records"("bookingId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "home_reviews_bookingId_key" ON "home_reviews"("bookingId");

-- CreateIndex
CREATE INDEX "home_reviews_professionalId_status_idx" ON "home_reviews"("professionalId", "status");

-- CreateIndex
CREATE INDEX "home_reviews_providerId_status_idx" ON "home_reviews"("providerId", "status");

-- CreateIndex
CREATE INDEX "home_incidents_status_createdAt_idx" ON "home_incidents"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "home_tickets_number_key" ON "home_tickets"("number");

-- CreateIndex
CREATE INDEX "home_tickets_status_createdAt_idx" ON "home_tickets"("status", "createdAt");

-- CreateIndex
CREATE INDEX "home_tickets_bookingId_idx" ON "home_tickets"("bookingId");

-- CreateIndex
CREATE INDEX "home_ticket_messages_ticketId_createdAt_idx" ON "home_ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "home_refund_records_bookingId_idx" ON "home_refund_records"("bookingId");

-- CreateIndex
CREATE INDEX "home_blocks_blockedUserId_idx" ON "home_blocks"("blockedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "home_promotions_code_key" ON "home_promotions"("code");

-- CreateIndex
CREATE INDEX "home_promotions_active_endsAt_idx" ON "home_promotions"("active", "endsAt");

-- CreateIndex
CREATE INDEX "home_packages_active_idx" ON "home_packages"("active");

-- CreateIndex
CREATE INDEX "home_memberships_userId_endsAt_idx" ON "home_memberships"("userId", "endsAt");

-- CreateIndex
CREATE INDEX "home_recurring_plans_customerId_idx" ON "home_recurring_plans"("customerId");

-- CreateIndex
CREATE INDEX "home_recurring_plans_status_nextStart_idx" ON "home_recurring_plans"("status", "nextStart");

-- CreateIndex
CREATE INDEX "home_societies_city_postalCode_idx" ON "home_societies"("city", "postalCode");

-- CreateIndex
CREATE INDEX "home_campaigns_status_startsAt_idx" ON "home_campaigns"("status", "startsAt");

-- CreateIndex
CREATE INDEX "home_campaigns_societyId_idx" ON "home_campaigns"("societyId");

-- CreateIndex
CREATE UNIQUE INDEX "home_campaign_participants_campaignId_userId_key" ON "home_campaign_participants"("campaignId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "home_platform_fees_bookingId_key" ON "home_platform_fees"("bookingId");

-- CreateIndex
CREATE INDEX "home_platform_fees_providerId_settlementId_idx" ON "home_platform_fees"("providerId", "settlementId");

-- CreateIndex
CREATE INDEX "home_settlements_providerId_status_idx" ON "home_settlements"("providerId", "status");

-- CreateIndex
CREATE INDEX "home_audits_entityType_entityId_idx" ON "home_audits"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "home_audits_createdAt_idx" ON "home_audits"("createdAt");

-- CreateIndex
CREATE INDEX "home_field_leads_employeeUserId_stage_idx" ON "home_field_leads"("employeeUserId", "stage");

-- CreateIndex
CREATE INDEX "home_visit_metrics_professionalId_serviceDefId_idx" ON "home_visit_metrics"("professionalId", "serviceDefId");

-- CreateIndex
CREATE INDEX "home_visit_metrics_serviceDefId_idx" ON "home_visit_metrics"("serviceDefId");

-- AddForeignKey
ALTER TABLE "home_providers" ADD CONSTRAINT "home_providers_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_providers" ADD CONSTRAINT "home_providers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_professionals" ADD CONSTRAINT "home_professionals_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_professionals" ADD CONSTRAINT "home_professionals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_professionals" ADD CONSTRAINT "home_professionals_salonStaffId_fkey" FOREIGN KEY ("salonStaffId") REFERENCES "salon_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_service_defs" ADD CONSTRAINT "home_service_defs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "home_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_offerings" ADD CONSTRAINT "home_offerings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_offerings" ADD CONSTRAINT "home_offerings_serviceDefId_fkey" FOREIGN KEY ("serviceDefId") REFERENCES "home_service_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_offering_products" ADD CONSTRAINT "home_offering_products_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "home_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_offering_products" ADD CONSTRAINT "home_offering_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_professional_services" ADD CONSTRAINT "home_professional_services_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_professional_services" ADD CONSTRAINT "home_professional_services_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "home_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_service_areas" ADD CONSTRAINT "home_service_areas_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_schedules" ADD CONSTRAINT "home_schedules_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_commitments" ADD CONSTRAINT "professional_commitments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_commitments" ADD CONSTRAINT "professional_commitments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_addresses" ADD CONSTRAINT "home_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_bookings" ADD CONSTRAINT "home_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_bookings" ADD CONSTRAINT "home_bookings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_bookings" ADD CONSTRAINT "home_bookings_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "home_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_bookings" ADD CONSTRAINT "home_bookings_recurringPlanId_fkey" FOREIGN KEY ("recurringPlanId") REFERENCES "home_recurring_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_bookings" ADD CONSTRAINT "home_bookings_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "home_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_booking_items" ADD CONSTRAINT "home_booking_items_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_booking_items" ADD CONSTRAINT "home_booking_items_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "home_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_booking_events" ADD CONSTRAINT "home_booking_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_invitations" ADD CONSTRAINT "home_invitations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_invitations" ADD CONSTRAINT "home_invitations_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_assignments" ADD CONSTRAINT "home_assignments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_assignments" ADD CONSTRAINT "home_assignments_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_service_codes" ADD CONSTRAINT "home_service_codes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_tracking_sessions" ADD CONSTRAINT "home_tracking_sessions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_payment_records" ADD CONSTRAINT "home_payment_records_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_earnings" ADD CONSTRAINT "home_earnings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_price_adjustments" ADD CONSTRAINT "home_price_adjustments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_product_uses" ADD CONSTRAINT "home_product_uses_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_product_uses" ADD CONSTRAINT "home_product_uses_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_product_uses" ADD CONSTRAINT "home_product_uses_productId_fkey" FOREIGN KEY ("productId") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_verifications" ADD CONSTRAINT "home_verifications_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_hygiene_records" ADD CONSTRAINT "home_hygiene_records_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_reviews" ADD CONSTRAINT "home_reviews_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_reviews" ADD CONSTRAINT "home_reviews_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_professional_feedback" ADD CONSTRAINT "home_professional_feedback_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_incidents" ADD CONSTRAINT "home_incidents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_tickets" ADD CONSTRAINT "home_tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_ticket_messages" ADD CONSTRAINT "home_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "home_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_refund_records" ADD CONSTRAINT "home_refund_records_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_favorites" ADD CONSTRAINT "home_favorites_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_promotions" ADD CONSTRAINT "home_promotions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_packages" ADD CONSTRAINT "home_packages_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_memberships" ADD CONSTRAINT "home_memberships_planId_fkey" FOREIGN KEY ("planId") REFERENCES "home_membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_recurring_plans" ADD CONSTRAINT "home_recurring_plans_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "home_professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_campaigns" ADD CONSTRAINT "home_campaigns_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "home_societies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_campaigns" ADD CONSTRAINT "home_campaigns_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_campaign_participants" ADD CONSTRAINT "home_campaign_participants_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "home_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_fee_rules" ADD CONSTRAINT "home_fee_rules_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_platform_fees" ADD CONSTRAINT "home_platform_fees_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "home_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_platform_fees" ADD CONSTRAINT "home_platform_fees_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_platform_fees" ADD CONSTRAINT "home_platform_fees_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "home_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_settlements" ADD CONSTRAINT "home_settlements_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "home_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Integrity rules Prisma cannot express ----------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "home_providers" ADD CONSTRAINT "home_providers_owner_check" CHECK (
  ("kind" = 'SALON_MANAGED' AND "salonId" IS NOT NULL AND "userId" IS NULL) OR
  ("kind" = 'INDEPENDENT_PROFESSIONAL' AND "salonId" IS NULL AND "userId" IS NOT NULL));
ALTER TABLE "home_providers" ADD CONSTRAINT "home_providers_adult_check" CHECK (
  "kind" = 'SALON_MANAGED' OR "status" = 'DRAFT' OR "adultDeclaredAt" IS NOT NULL);
ALTER TABLE "home_offerings" ADD CONSTRAINT "home_offerings_price_check" CHECK ("pricePaise" > 0 AND "productPaise" >= 0 AND "disposablePaise" >= 0 AND "equipmentPaise" >= 0 AND "durationMinutes" > 0);
ALTER TABLE "home_bookings" ADD CONSTRAINT "home_bookings_time_check" CHECK ("serviceEnd" > "serviceStart" AND "totalPaise" >= 0);
ALTER TABLE "home_bookings" ADD CONSTRAINT "home_bookings_customer_check" CHECK ("customerId" IS NOT NULL OR ("guestPhone" IS NOT NULL AND "guestAccessHash" IS NOT NULL));
ALTER TABLE "home_payment_records" ADD CONSTRAINT "home_payment_records_amount_check" CHECK ("amountPaise" > 0 AND "tipPaise" >= 0);
ALTER TABLE "home_reviews" ADD CONSTRAINT "home_reviews_range_check" CHECK (
  "overall" >= 1 AND "overall" <= 5 AND "quality" >= 1 AND "quality" <= 5 AND "behaviour" >= 1 AND "behaviour" <= 5 AND "punctuality" >= 1 AND "punctuality" <= 5 AND "hygiene" >= 1 AND "hygiene" <= 5 AND "transparency" >= 1 AND "transparency" <= 5);
ALTER TABLE "professional_commitments" ADD CONSTRAINT "professional_commitments_range_check" CHECK ("endAt" > "startAt");

-- One person can never hold two overlapping unreleased commitments, in any provider.
ALTER TABLE "professional_commitments" ADD CONSTRAINT "professional_commitments_no_overlap"
  EXCLUDE USING gist ("userId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&) WHERE ("releasedAt" IS NULL);

-- At most one active assignment per booking, one open invitation per person per booking, one live code per purpose.
CREATE UNIQUE INDEX "home_assignments_one_active" ON "home_assignments" ("bookingId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "home_invitations_one_pending" ON "home_invitations" ("bookingId", "professionalId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "home_service_codes_one_live" ON "home_service_codes" ("bookingId", "purpose") WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

CREATE FUNCTION home_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FastQue Home history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "home_booking_events_append_only" BEFORE UPDATE OR DELETE ON "home_booking_events" FOR EACH ROW EXECUTE FUNCTION home_reject_mutation();
CREATE TRIGGER "home_audits_append_only" BEFORE UPDATE OR DELETE ON "home_audits" FOR EACH ROW EXECUTE FUNCTION home_reject_mutation();

-- ---------- Reference catalogue (no prices, no providers) ----------
INSERT INTO "home_categories" ("id","code","groupCode","name","nameHi","sortOrder","active","requiresQualification") VALUES
  (gen_random_uuid()::text, 'mens-grooming', 'MEN', 'Men''s grooming', 'पुरुष ग्रूमिंग', 0, true, false),
  (gen_random_uuid()::text, 'womens-beauty', 'WOMEN', 'Women''s beauty', 'महिला ब्यूटी', 10, true, false),
  (gen_random_uuid()::text, 'kids-family', 'KIDS', 'Kids and family', 'बच्चे और परिवार', 20, true, false),
  (gen_random_uuid()::text, 'bridal-makeup', 'BRIDAL', 'Bridal and makeup', 'ब्राइडल और मेकअप', 30, true, true),
  (gen_random_uuid()::text, 'spa-massage', 'SPA', 'Spa and massage', 'स्पा और मसाज', 40, false, true),
  (gen_random_uuid()::text, 'wedding-event', 'EVENT', 'Wedding and event grooming', 'शादी और इवेंट ग्रूमिंग', 50, false, false),
  (gen_random_uuid()::text, 'corporate', 'EVENT', 'Corporate grooming', 'कॉर्पोरेट ग्रूमिंग', 60, false, false),
  (gen_random_uuid()::text, 'society-camps', 'EVENT', 'Society grooming camps', 'सोसाइटी ग्रूमिंग कैंप', 70, false, false),
  (gen_random_uuid()::text, 'specialized', 'PREMIUM', 'Specialized beauty treatments', 'विशेष ब्यूटी ट्रीटमेंट', 80, false, true);

INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-haircut', 'Men''s haircut', 'पुरुष हेयरकट', ARRAY['haircut','hair cut','barber','बाल कटवाना']::text[], 30, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY['beard-trim','head-massage']::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'beard-trim', 'Beard trimming', 'दाढ़ी ट्रिम', ARRAY['beard','दाढ़ी']::text[], 20, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'shave', 'Shaving', 'शेव', ARRAY['shave','शेविंग']::text[], 20, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-styling', 'Hair styling', 'हेयर स्टाइलिंग', ARRAY['styling']::text[], 30, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-color', 'Hair coloring', 'हेयर कलर', ARRAY['color','colour','hair dye']::text[], 60, 10, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-wash', 'Hair wash', 'हेयर वॉश', ARRAY['wash']::text[], 20, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'head-massage', 'Head massage', 'सिर की मालिश', ARRAY['champi','चंपी']::text[], 20, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-facial', 'Facial', 'फेशियल', ARRAY['facial']::text[], 60, 10, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, true, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-cleanup', 'Cleanup', 'क्लीनअप', ARRAY['cleanup']::text[], 40, 5, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, true, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-manicure', 'Manicure', 'मैनीक्योर', ARRAY['manicure']::text[], 40, 5, 10, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-pedicure', 'Pedicure', 'पेडीक्योर', ARRAY['pedicure']::text[], 45, 5, 10, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'mens-package', 'Grooming package', 'ग्रूमिंग पैकेज', ARRAY['grooming']::text[], 90, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'mens-grooming';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'womens-haircut', 'Women''s haircut', 'महिला हेयरकट', ARRAY['haircut','hair cut']::text[], 45, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'womens-styling', 'Hair styling', 'हेयर स्टाइलिंग', ARRAY['styling','hairstylist']::text[], 45, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'wash-blowdry', 'Hair wash and blow-dry', 'हेयर वॉश और ब्लो ड्राई', ARRAY['blow dry','blowdry']::text[], 45, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'womens-color', 'Hair coloring', 'हेयर कलर', ARRAY['color','colour']::text[], 120, 10, 15, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'root-touchup', 'Root touch-up', 'रूट टच-अप', ARRAY['root touch up','touch up']::text[], 75, 10, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'hair-spa', 'Hair spa', 'हेयर स्पा', ARRAY['spa']::text[], 60, 10, 10, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'womens-facial', 'Facial', 'फेशियल', ARRAY['facial']::text[], 60, 10, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, true, ARRAY[]::text[], ARRAY[]::text[], ARRAY['threading']::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'womens-cleanup', 'Cleanup', 'क्लीनअप', ARRAY['cleanup']::text[], 40, 5, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, true, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'threading', 'Threading', 'थ्रेडिंग', ARRAY['eyebrow','eyebrows']::text[], 15, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'waxing', 'Waxing', 'वैक्सिंग', ARRAY['wax']::text[], 45, 5, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'womens-manicure', 'Manicure', 'मैनीक्योर', ARRAY['manicure']::text[], 40, 5, 10, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'womens-pedicure', 'Pedicure', 'पेडीक्योर', ARRAY['pedicure']::text[], 45, 5, 10, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'nail-art', 'Nail art', 'नेल आर्ट', ARRAY['nails','nail']::text[], 60, 5, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'saree-draping', 'Saree draping', 'साड़ी ड्रेपिंग', ARRAY['saree','sari']::text[], 30, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'womens-beauty';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'party-makeup', 'Party makeup', 'पार्टी मेकअप', ARRAY['makeup','party make up']::text[], 75, 10, 10, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'bridal-makeup';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'bridal-makeup', 'Bridal makeup', 'ब्राइडल मेकअप', ARRAY['bridal','bride']::text[], 150, 15, 15, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'bridal-makeup';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'pre-bridal', 'Pre-bridal package', 'प्री-ब्राइडल पैकेज', ARRAY['pre bridal','prebridal']::text[], 180, 15, 15, 'Tell the professional about allergies or skin conditions. A patch test may be needed. This is not a medical treatment.', false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'bridal-makeup';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'kids-haircut', 'Kids'' haircut', 'बच्चों का हेयरकट', ARRAY['child haircut','kids']::text[], 30, 5, 5, 'A parent or guardian must stay with the child.', true, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'kids-family';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'family-grooming', 'Family grooming package', 'फैमिली ग्रूमिंग पैकेज', ARRAY['family']::text[], 90, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'kids-family';
INSERT INTO "home_service_defs" ("id","categoryId","code","name","nameHi","synonyms","durationMinutes","prepMinutes","cleanupMinutes","safetyInstructions","forChildren","customerProducts","requiredSkills","requiredEquipment","addOnCodes","updatedAt") SELECT gen_random_uuid()::text, c."id", 'senior-grooming', 'Senior citizen grooming', 'वरिष्ठ नागरिक ग्रूमिंग', ARRAY['senior','elderly']::text[], 45, 5, 5, NULL, false, false, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], now() FROM "home_categories" c WHERE c."code" = 'kids-family';

-- Fee rules start switched off; amounts are editable assumptions (HOME_MONETIZATION_ENABLED is also off).
INSERT INTO "home_fee_rules" ("id","kind","providerKind","percentBps","active","note","updatedAt") VALUES
  (gen_random_uuid()::text,'COMMISSION','SALON_MANAGED',500,false,'Assumption: 5-10% salon commission',now()),
  (gen_random_uuid()::text,'COMMISSION','INDEPENDENT_PROFESSIONAL',800,false,'Assumption: 8-15% independent commission',now());

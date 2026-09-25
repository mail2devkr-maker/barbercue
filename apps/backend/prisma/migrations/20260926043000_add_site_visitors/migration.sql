-- First-party FastQue website visitor measurement.
-- One row = one browser/device UUID after SHA-256 hashing by the backend.
-- No historical backfill is attempted because pre-rollout unique visitors cannot be recovered
-- exactly from application data.

CREATE TABLE "site_visitors" (
  "visitorKey" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "site_visitors_pkey" PRIMARY KEY ("visitorKey")
);

-- Additive only: two owner intake switches (default: accepting) and the CEO message table.
ALTER TABLE "salons" ADD COLUMN "queuePaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "bookingsPaused" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "crm_announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(4000),
    "videoUrl" VARCHAR(500),
    "videoStorageKey" VARCHAR(200),
    "videoMimeType" VARCHAR(60),
    "videoSizeBytes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_announcements_isActive_createdAt_idx" ON "crm_announcements"("isActive", "createdAt");

ALTER TABLE "crm_announcements" ADD CONSTRAINT "crm_announcements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

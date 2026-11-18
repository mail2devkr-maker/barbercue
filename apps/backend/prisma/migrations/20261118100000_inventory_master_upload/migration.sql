-- Inventory master database + admin Excel/CSV upload. Purely additive: new enums, new nullable /
-- defaulted columns on global_products, and three new tables. No existing row is rewritten; every
-- existing catalog product becomes GLOBAL (its current behaviour).

-- CreateEnum
CREATE TYPE "CatalogVisibility" AS ENUM ('GLOBAL', 'SHOP');
CREATE TYPE "InventoryUploadFileType" AS ENUM ('XLSX', 'CSV');
CREATE TYPE "InventoryUploadStatus" AS ENUM ('PREVIEWED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');
CREATE TYPE "InventoryUploadIssueSeverity" AS ENUM ('ERROR', 'WARNING', 'REVIEW');
CREATE TYPE "CatalogChangeRequestStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "inventory_upload_jobs" (
    "id" UUID NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileType" "InventoryUploadFileType" NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "sheetName" VARCHAR(120),
    "headerRow" INTEGER,
    "status" "InventoryUploadStatus" NOT NULL DEFAULT 'PREVIEWED',
    "columnMapping" JSONB,
    "parsedRows" JSONB,
    "sourceReference" VARCHAR(300),
    "sourceLicense" VARCHAR(80),
    "markAsTestData" BOOLEAN NOT NULL DEFAULT false,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "linkedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "embeddedImageCount" INTEGER NOT NULL DEFAULT 0,
    "failureMessage" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "inventory_upload_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_upload_jobs_counts_check" CHECK (
      "totalRows" >= 0 AND "createdCount" >= 0 AND "linkedCount" >= 0 AND "unchangedCount" >= 0
      AND "skippedCount" >= 0 AND "errorCount" >= 0 AND "warningCount" >= 0 AND "reviewCount" >= 0
      AND "fileSizeBytes" >= 0
    )
);

CREATE TABLE "inventory_upload_errors" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "severity" "InventoryUploadIssueSeverity" NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "field" VARCHAR(60),
    "message" VARCHAR(500) NOT NULL,
    "rawValue" VARCHAR(300),
    "phase" VARCHAR(10) NOT NULL DEFAULT 'PREVIEW',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_upload_errors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_upload_errors_phase_check" CHECK ("phase" IN ('PREVIEW', 'COMMIT'))
);

CREATE TABLE "catalog_change_requests" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "globalProductId" TEXT,
    "barcode" VARCHAR(64),
    "message" VARCHAR(1000) NOT NULL,
    "proposedFields" JSONB,
    "status" "CatalogChangeRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "resolutionNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_change_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable (additive)
ALTER TABLE "global_products"
  ADD COLUMN "visibility" "CatalogVisibility" NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN "ownerSalonId" TEXT,
  ADD COLUMN "externalRef" VARCHAR(80),
  ADD COLUMN "variantText" VARCHAR(80),
  ADD COLUMN "isTestData" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "uploadJobId" UUID;

-- A SHOP product always names its salon; a GLOBAL product never does.
ALTER TABLE "global_products" ADD CONSTRAINT "global_products_visibility_owner_check" CHECK (
  ("visibility" = 'GLOBAL' AND "ownerSalonId" IS NULL)
  OR ("visibility" = 'SHOP' AND "ownerSalonId" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "inventory_upload_jobs_createdAt_id_idx" ON "inventory_upload_jobs"("createdAt", "id");
CREATE INDEX "inventory_upload_jobs_status_createdAt_idx" ON "inventory_upload_jobs"("status", "createdAt");
CREATE INDEX "inventory_upload_jobs_fileSha256_idx" ON "inventory_upload_jobs"("fileSha256");
CREATE INDEX "inventory_upload_errors_jobId_phase_rowNumber_idx" ON "inventory_upload_errors"("jobId", "phase", "rowNumber");
CREATE INDEX "inventory_upload_errors_jobId_severity_idx" ON "inventory_upload_errors"("jobId", "severity");
CREATE INDEX "catalog_change_requests_status_createdAt_idx" ON "catalog_change_requests"("status", "createdAt");
CREATE INDEX "catalog_change_requests_salonId_createdAt_idx" ON "catalog_change_requests"("salonId", "createdAt");
CREATE INDEX "global_products_visibility_ownerSalonId_idx" ON "global_products"("visibility", "ownerSalonId");
CREATE INDEX "global_products_category_idx" ON "global_products"("category");
CREATE INDEX "global_products_uploadJobId_idx" ON "global_products"("uploadJobId");
-- A supplier product code identifies at most one product (rows without a barcode match on it).
CREATE UNIQUE INDEX "global_products_externalRef_key" ON "global_products"("externalRef") WHERE "externalRef" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "global_products" ADD CONSTRAINT "global_products_ownerSalonId_fkey" FOREIGN KEY ("ownerSalonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "global_products" ADD CONSTRAINT "global_products_uploadJobId_fkey" FOREIGN KEY ("uploadJobId") REFERENCES "inventory_upload_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_upload_jobs" ADD CONSTRAINT "inventory_upload_jobs_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_upload_errors" ADD CONSTRAINT "inventory_upload_errors_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "inventory_upload_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_globalProductId_fkey" FOREIGN KEY ("globalProductId") REFERENCES "global_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

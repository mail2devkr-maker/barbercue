-- Add a canonical, salon-scoped category tree while keeping the legacy text labels intact.
-- Existing service records are linked by normalized labels; no booking/history rows are changed.
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_subcategories" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_subcategories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_categories_salonId_id_key"
    ON "service_categories"("salonId", "id");
CREATE UNIQUE INDEX "service_categories_salonId_normalizedName_key"
    ON "service_categories"("salonId", "normalizedName");
CREATE INDEX "service_categories_salonId_name_idx"
    ON "service_categories"("salonId", "name");

CREATE UNIQUE INDEX "service_subcategories_categoryId_normalizedName_key"
    ON "service_subcategories"("categoryId", "normalizedName");
CREATE UNIQUE INDEX "service_subcategories_salonId_categoryId_id_key"
    ON "service_subcategories"("salonId", "categoryId", "id");
CREATE INDEX "service_subcategories_salonId_categoryId_name_idx"
    ON "service_subcategories"("salonId", "categoryId", "name");

ALTER TABLE "service_categories"
    ADD CONSTRAINT "service_categories_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_subcategories"
    ADD CONSTRAINT "service_subcategories_salonId_categoryId_fkey"
    FOREIGN KEY ("salonId", "categoryId")
    REFERENCES "service_categories"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "services"
    ADD COLUMN "categoryId" TEXT,
    ADD COLUMN "subcategoryId" TEXT;

-- Use PostgreSQL's case-insensitive label identity for backfill and retain one deterministic
-- canonical display spelling. The original Service.category/subcategory text is never rewritten.
INSERT INTO "service_categories" ("id", "salonId", "name", "normalizedName", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "salonId", MIN(btrim("category")), lower(btrim("category")), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "services"
WHERE "category" IS NOT NULL AND btrim("category") <> ''
GROUP BY "salonId", lower(btrim("category"))
ON CONFLICT ("salonId", "normalizedName") DO NOTHING;

INSERT INTO "service_subcategories" ("id", "salonId", "categoryId", "name", "normalizedName", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."salonId", c."id", MIN(btrim(s."subcategory")), lower(btrim(s."subcategory")), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "services" s
JOIN "service_categories" c
  ON c."salonId" = s."salonId"
 AND c."normalizedName" = lower(btrim(s."category"))
WHERE s."category" IS NOT NULL AND btrim(s."category") <> ''
  AND s."subcategory" IS NOT NULL AND btrim(s."subcategory") <> ''
GROUP BY s."salonId", c."id", lower(btrim(s."subcategory"))
ON CONFLICT ("categoryId", "normalizedName") DO NOTHING;

UPDATE "services" s
SET "categoryId" = c."id"
FROM "service_categories" c
WHERE c."salonId" = s."salonId"
  AND c."normalizedName" = lower(btrim(s."category"))
  AND s."category" IS NOT NULL AND btrim(s."category") <> '';

UPDATE "services" s
SET "subcategoryId" = sc."id"
FROM "service_subcategories" sc
WHERE sc."salonId" = s."salonId"
  AND sc."categoryId" = s."categoryId"
  AND sc."normalizedName" = lower(btrim(s."subcategory"))
  AND s."categoryId" IS NOT NULL
  AND s."subcategory" IS NOT NULL AND btrim(s."subcategory") <> '';

CREATE INDEX "services_salonId_categoryId_subcategoryId_idx"
    ON "services"("salonId", "categoryId", "subcategoryId");

ALTER TABLE "services"
    ADD CONSTRAINT "services_subcategory_requires_category_check"
    CHECK ("subcategoryId" IS NULL OR "categoryId" IS NOT NULL),
    ADD CONSTRAINT "services_salonId_categoryId_fkey"
    FOREIGN KEY ("salonId", "categoryId")
    REFERENCES "service_categories"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "services_salonId_categoryId_subcategoryId_fkey"
    FOREIGN KEY ("salonId", "categoryId", "subcategoryId")
    REFERENCES "service_subcategories"("salonId", "categoryId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

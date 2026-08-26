-- Phase 1 of the global location architecture (Country -> Region -> City -> Locality).
-- Purely additive: new enum, two new tables, one new lookup table, and nullable columns on the
-- existing `cities` table. No existing column, constraint, or row is touched. countryCode/
-- regionCode/state/country and the (countryCode, slug) unique constraint on `cities` are
-- untouched and remain the only fields anything reads until a later, separately-approved phase.
--
-- Excluded from this file (deliberately, matching this project's established pattern): a stray
-- `ALTER TABLE "salons" ALTER COLUMN "publicId" SET DEFAULT (...)` statement that `prisma migrate
-- diff` also emits here. It re-asserts a dbgenerated() type-only marker already in effect since
-- the add_salon_public_id/restore_salon_public_id_default migrations and is unrelated to this
-- change (Salon is explicitly out of scope for Phase 1).

-- CreateEnum
CREATE TYPE "CityAliasKind" AS ENUM ('NATIVE_NAME', 'TRANSLITERATION', 'HISTORICAL', 'COMMON_MISSPELLING');

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "isoCode2" TEXT NOT NULL,
    "isoCode3" TEXT,
    "name" TEXT NOT NULL,
    "nativeName" TEXT,
    "phoneCode" TEXT,
    "currencyCode" TEXT,
    "continent" TEXT,
    "subregion" TEXT,
    "hasSubdivisions" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL,
    "postalCodeRegex" TEXT,
    "sourceDataset" TEXT,
    "sourceId" INTEGER,
    "sourceVersion" TEXT,
    "wikiDataId" TEXT,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "nativeName" TEXT,
    "kind" TEXT,
    "slug" TEXT NOT NULL,
    "sourceDataset" TEXT,
    "sourceId" INTEGER,
    "sourceVersion" TEXT,
    "wikiDataId" TEXT,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CityAlias" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CityAliasKind" NOT NULL,

    CONSTRAINT "CityAlias_pkey" PRIMARY KEY ("id")
);

-- AlterTable: additive, all-nullable columns on the existing `cities` table
ALTER TABLE "cities" ADD COLUMN     "countryId" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "nativeName" TEXT,
ADD COLUMN     "population" INTEGER,
ADD COLUMN     "regionId" TEXT,
ADD COLUMN     "sourceDataset" TEXT,
ADD COLUMN     "sourceId" INTEGER,
ADD COLUMN     "sourceVersion" TEXT,
ADD COLUMN     "wikiDataId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Country_isoCode2_key" ON "Country"("isoCode2");

-- CreateIndex
CREATE UNIQUE INDEX "Country_isoCode3_key" ON "Country"("isoCode3");

-- CreateIndex
CREATE UNIQUE INDEX "Country_slug_key" ON "Country"("slug");

-- CreateIndex
CREATE INDEX "Region_countryId_idx" ON "Region"("countryId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_countryId_slug_key" ON "Region"("countryId", "slug");

-- CreateIndex
CREATE INDEX "CityAlias_cityId_idx" ON "CityAlias"("cityId");

-- CreateIndex
CREATE INDEX "CityAlias_name_idx" ON "CityAlias"("name");

-- CreateIndex
CREATE INDEX "cities_countryId_idx" ON "cities"("countryId");

-- CreateIndex
CREATE INDEX "cities_regionId_idx" ON "cities"("regionId");

-- CreateIndex: new parallel constraint, coexists with cities_countryCode_slug_key (untouched)
-- because Postgres never compares NULLs for uniqueness -- every existing row's countryId is
-- NULL until a later, separately-approved backfill phase.
CREATE UNIQUE INDEX "cities_countryId_slug_key" ON "cities"("countryId", "slug");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityAlias" ADD CONSTRAINT "CityAlias_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

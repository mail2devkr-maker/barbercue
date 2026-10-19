-- External review profile links are salon-owned metadata only. No provider review data is copied
-- or fetched; a configured link is exposed as LINK_ONLY.
CREATE TABLE "salon_review_profiles" (
    "salonId" TEXT NOT NULL,
    "googleUrl" VARCHAR(500),
    "facebookUrl" VARCHAR(500),
    "instagramUrl" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "salon_review_profiles_pkey" PRIMARY KEY ("salonId")
);

ALTER TABLE "salon_review_profiles"
  ADD CONSTRAINT "salon_review_profiles_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

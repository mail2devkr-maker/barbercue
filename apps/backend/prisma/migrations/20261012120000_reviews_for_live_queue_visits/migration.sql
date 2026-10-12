-- Additive review target for authenticated standalone Live Queue visits.
-- Existing reviews remain attached to their bookingId. The XOR constraint guarantees that every
-- review is attached to exactly one real visit; nullable unique indexes preserve one-review-per-
-- visit while allowing any number of legacy booking reviews.
ALTER TABLE "reviews" ALTER COLUMN "bookingId" DROP NOT NULL;

ALTER TABLE "reviews" ADD COLUMN "queueEntryId" TEXT;

CREATE UNIQUE INDEX "reviews_queueEntryId_key" ON "reviews"("queueEntryId");

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_queueEntryId_fkey"
  FOREIGN KEY ("queueEntryId") REFERENCES "queue_entries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_exactly_one_visit_target_check"
  CHECK (("bookingId" IS NOT NULL) <> ("queueEntryId" IS NOT NULL));

-- Stable keyset history reads are salon/customer scoped and ordered by visit time then ID.
CREATE INDEX "bookings_customer_slotStart_id_idx"
  ON "bookings" ("customerId", "slotStart" DESC, "id" DESC);

CREATE INDEX "queue_entries_salon_source_joinedAt_id_idx"
  ON "queue_entries" ("salonId", "source", "joinedAt" DESC, "id" DESC);

CREATE INDEX "queue_entries_customer_source_joinedAt_id_idx"
  ON "queue_entries" ("customerId", "source", "joinedAt" DESC, "id" DESC);

-- A queue review must refer to an authenticated, standalone, completed Live Queue visit for the
-- same user and salon. This database guard also prevents a linked appointment's queue check-in
-- from receiving a second review under a different visit key.
CREATE FUNCTION "fastque_validate_queue_visit_review_target"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target "queue_entries"%ROWTYPE;
BEGIN
  IF NEW."queueEntryId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO target
  FROM "queue_entries"
  WHERE "id" = NEW."queueEntryId"
  FOR SHARE;

  IF NOT FOUND
    OR target."customerId" IS DISTINCT FROM NEW."customerId"
    OR target."salonId" IS DISTINCT FROM NEW."salonId"
    OR target."bookingId" IS NOT NULL
    OR target."source" <> 'WALK_IN'
    OR target."status" <> 'COMPLETED'
  THEN
    RAISE EXCEPTION 'Review target is not an owned completed standalone queue visit'
      USING ERRCODE = '23514', CONSTRAINT = 'reviews_queue_visit_target_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "reviews_validate_queue_visit_target"
BEFORE INSERT OR UPDATE OF "queueEntryId", "bookingId", "customerId", "salonId"
ON "reviews"
FOR EACH ROW
EXECUTE FUNCTION "fastque_validate_queue_visit_review_target"();

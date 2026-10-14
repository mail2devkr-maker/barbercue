-- Shop recovery is a reversible quarantine. There is intentionally no purge job or
-- destructive migration; rows and all child records stay in place for audit/recovery.
ALTER TABLE "salons"
  ADD COLUMN "softDeletedAt" TIMESTAMP(3),
  ADD COLUMN "restoreEligibleUntil" TIMESTAMP(3),
  ADD COLUMN "softDeletedByUserId" TEXT,
  ADD COLUMN "softDeletionRequestId" TEXT,
  ADD COLUMN "statusBeforeSoftDelete" "SalonStatus";

CREATE INDEX "salons_softDeletedAt_restoreEligibleUntil_idx"
  ON "salons" ("softDeletedAt", "restoreEligibleUntil");
CREATE INDEX "salons_softDeletionRequestId_idx"
  ON "salons" ("softDeletionRequestId");

ALTER TABLE "salons"
  ADD CONSTRAINT "salons_soft_deletion_state_check"
  CHECK (
    ("softDeletedAt" IS NULL AND "restoreEligibleUntil" IS NULL
      AND "softDeletedByUserId" IS NULL AND "softDeletionRequestId" IS NULL
      AND "statusBeforeSoftDelete" IS NULL)
    OR
    ("softDeletedAt" IS NOT NULL AND "restoreEligibleUntil" > "softDeletedAt"
      AND "softDeletedByUserId" IS NOT NULL AND "softDeletionRequestId" IS NOT NULL
      AND "statusBeforeSoftDelete" IS NOT NULL AND "status" = 'SUSPENDED')
  );

-- A quarantined row can only be changed by the explicit Super Admin restore transaction.
-- The transaction-local marker is set only by that server path and cannot leak through a pool.
CREATE FUNCTION "guard_quarantined_salon_update"() RETURNS trigger AS $$
BEGIN
  IF OLD."softDeletedAt" IS NOT NULL
     AND current_setting('app.fastque_restore_salon_id', true) IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_QUARANTINED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "salons_quarantine_update_guard"
  BEFORE UPDATE ON "salons"
  FOR EACH ROW EXECUTE FUNCTION "guard_quarantined_salon_update"();

-- Permanent deletion is deliberately absent from this release. A future purge feature
-- requires a separate owner-approved policy, retention controls, and audited implementation.
CREATE FUNCTION "deny_salon_hard_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SALON_HARD_DELETE_DISABLED';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "salons_hard_delete_guard"
  BEFORE DELETE ON "salons"
  FOR EACH ROW EXECUTE FUNCTION "deny_salon_hard_delete"();

-- Close the race between an application-level availability check and a new operational row.
-- FOR SHARE locks are mutually compatible for normal concurrent writes, but conflict with the
-- NO KEY UPDATE lock acquired by changing Salon status/tombstone fields (and with quarantine's
-- explicit FOR UPDATE). This makes both application quarantine and any direct SQL transition
-- serialize with child writes.
CREATE FUNCTION "deny_quarantined_salon_child_insert"() RETURNS trigger AS $$
DECLARE
  deleted_at TIMESTAMP(3);
BEGIN
  SELECT s."softDeletedAt" INTO deleted_at
    FROM "salons" AS s
    WHERE s."id" = NEW."salonId"
    FOR SHARE;
  IF deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_QUARANTINED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookings_quarantine_insert_guard"
  BEFORE INSERT ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_child_insert"();
CREATE TRIGGER "queue_entries_quarantine_insert_guard"
  BEFORE INSERT ON "queue_entries"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_child_insert"();
CREATE TRIGGER "manual_chair_occupancies_quarantine_insert_guard"
  BEFORE INSERT ON "manual_chair_occupancies"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_child_insert"();

CREATE FUNCTION "deny_quarantined_service_session_insert"() RETURNS trigger AS $$
DECLARE
  deleted_at TIMESTAMP(3);
BEGIN
  SELECT s."softDeletedAt" INTO deleted_at
    FROM "salons" AS s
    INNER JOIN "queue_entries" AS q ON q."salonId" = s."id"
    WHERE q."id" = NEW."queueEntryId"
    FOR SHARE OF s;
  IF deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_QUARANTINED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "service_sessions_quarantine_insert_guard"
  BEFORE INSERT ON "service_sessions"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_service_session_insert"();

-- Quarantine must also serialize against mutations that can create a new obligation after the
-- application has checked for open work. In particular, payments/refunds and ledger entries may
-- arrive on webhook or settlement paths that do not create a booking/queue row. These triggers
-- lock the same salon row held by quarantine; a racing write either commits first and is visible
-- to the obligation check, or resumes after quarantine and is rejected. Trash remains
-- read-only, while rows for every non-quarantined salon retain their existing behavior.
CREATE FUNCTION "deny_quarantined_salon_related_write"() RETURNS trigger AS $$
DECLARE
  salon_id TEXT;
  booking_id TEXT;
  payment_id TEXT;
  deleted_at TIMESTAMP(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    CASE TG_TABLE_NAME
      WHEN 'bookings' THEN salon_id := OLD."salonId";
      WHEN 'queue_entries' THEN salon_id := OLD."salonId";
      WHEN 'manual_chair_occupancies' THEN salon_id := OLD."salonId";
      WHEN 'service_sessions' THEN
        SELECT q."salonId" INTO salon_id FROM "queue_entries" q WHERE q.id = OLD."queueEntryId";
      WHEN 'customer_ledger_entries' THEN salon_id := OLD."salonId";
      WHEN 'platform_shop_subsidy_entries' THEN salon_id := OLD."salonId";
      WHEN 'payments' THEN booking_id := OLD."bookingId";
      WHEN 'refunds' THEN payment_id := OLD."paymentId";
    END CASE;
  ELSE
    CASE TG_TABLE_NAME
      WHEN 'bookings' THEN salon_id := NEW."salonId";
      WHEN 'queue_entries' THEN salon_id := NEW."salonId";
      WHEN 'manual_chair_occupancies' THEN salon_id := NEW."salonId";
      WHEN 'service_sessions' THEN
        SELECT q."salonId" INTO salon_id FROM "queue_entries" q WHERE q.id = NEW."queueEntryId";
      WHEN 'customer_ledger_entries' THEN salon_id := NEW."salonId";
      WHEN 'platform_shop_subsidy_entries' THEN salon_id := NEW."salonId";
      WHEN 'payments' THEN booking_id := NEW."bookingId";
      WHEN 'refunds' THEN payment_id := NEW."paymentId";
    END CASE;
  END IF;

  IF booking_id IS NOT NULL THEN
    SELECT b."salonId" INTO salon_id FROM "bookings" b WHERE b.id = booking_id;
  ELSIF payment_id IS NOT NULL THEN
    SELECT b."salonId" INTO salon_id
      FROM "payments" p
      INNER JOIN "bookings" b ON b.id = p."bookingId"
      WHERE p.id = payment_id;
  END IF;

  IF salon_id IS NOT NULL THEN
    SELECT s."softDeletedAt" INTO deleted_at
      FROM "salons" s WHERE s.id = salon_id FOR SHARE;
    IF deleted_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_QUARANTINED';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookings_quarantine_write_guard"
  BEFORE UPDATE OR DELETE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();
CREATE TRIGGER "queue_entries_quarantine_write_guard"
  BEFORE UPDATE OR DELETE ON "queue_entries"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();
CREATE TRIGGER "manual_chair_occupancies_quarantine_write_guard"
  BEFORE UPDATE OR DELETE ON "manual_chair_occupancies"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();
CREATE TRIGGER "service_sessions_quarantine_write_guard"
  BEFORE UPDATE OR DELETE ON "service_sessions"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();
CREATE TRIGGER "payments_quarantine_write_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();
CREATE TRIGGER "refunds_quarantine_write_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();
CREATE TRIGGER "customer_ledger_quarantine_write_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "customer_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();
CREATE TRIGGER "platform_subsidy_quarantine_write_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "platform_shop_subsidy_entries"
  FOR EACH ROW EXECUTE FUNCTION "deny_quarantined_salon_related_write"();

-- Defense in depth: do not allow any caller (including a future service that forgets the
-- application preflight) to commit quarantine while an operational/financial obligation exists.
-- The deferred check runs after the salon lock is acquired. Related-write guards above serialize
-- concurrent inserts/updates against that lock, so the final query observes either the committed
-- obligation or the committed tombstone, never a gap between them.
CREATE FUNCTION "assert_no_open_salon_obligations_on_quarantine"() RETURNS trigger AS $$
DECLARE
  has_open_obligation BOOLEAN;
BEGIN
  IF NEW."softDeletedAt" IS NULL OR OLD."softDeletedAt" IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM "bookings" b
      WHERE b."salonId" = NEW.id AND b.status IN ('PENDING_PAYMENT', 'CONFIRMED')
    UNION ALL
    SELECT 1 FROM "queue_entries" q
      WHERE q."salonId" = NEW.id AND q.status IN ('WAITING', 'CALLED', 'IN_SERVICE')
    UNION ALL
    SELECT 1 FROM "service_sessions" ss
      INNER JOIN "queue_entries" q ON q.id = ss."queueEntryId"
      WHERE q."salonId" = NEW.id AND ss.status = 'ACTIVE'
    UNION ALL
    SELECT 1 FROM "manual_chair_occupancies" m
      WHERE m."salonId" = NEW.id AND m."endedAt" IS NULL
    UNION ALL
    SELECT 1 FROM "payments" p
      INNER JOIN "bookings" b ON b.id = p."bookingId"
      WHERE b."salonId" = NEW.id AND p.status IN ('CREATED', 'PENDING')
    UNION ALL
    SELECT 1 FROM "refunds" r
      INNER JOIN "payments" p ON p.id = r."paymentId"
      INNER JOIN "bookings" b ON b.id = p."bookingId"
      WHERE b."salonId" = NEW.id AND r.status = 'INITIATED'
    UNION ALL
    SELECT 1 FROM "customer_ledger_entries" l
      WHERE l."salonId" = NEW.id AND l.status = 'OUTSTANDING'
    UNION ALL
    SELECT 1 FROM "platform_shop_subsidy_entries" s
      WHERE s."salonId" = NEW.id AND s.status = 'OUTSTANDING'
  ) INTO has_open_obligation;

  IF has_open_obligation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHOP_HAS_OPEN_OBLIGATIONS';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "salons_quarantine_obligations_guard"
  AFTER UPDATE OF "softDeletedAt" ON "salons"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_no_open_salon_obligations_on_quarantine"();

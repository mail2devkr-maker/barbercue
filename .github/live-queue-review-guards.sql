-- Runs only against the disposable PostgreSQL service in the certification workflow.
-- The synthetic rows and attempted invalid writes are rolled back as a unit.
BEGIN;

INSERT INTO "users" ("id", "email", "updatedAt") VALUES
  ('ci-owner', 'owner@example.invalid', CURRENT_TIMESTAMP),
  ('ci-customer', 'customer@example.invalid', CURRENT_TIMESTAMP),
  ('ci-other-customer', 'other@example.invalid', CURRENT_TIMESTAMP);

INSERT INTO "cities" ("id", "name", "slug", "countryCode", "state", "country")
VALUES ('ci-city', 'Test City', 'test-city', 'IN', 'Test State', 'Test Country');

INSERT INTO "salons" (
  "id", "ownerUserId", "name", "slug", "cityId", "addressLine", "lat", "lng", "updatedAt"
) VALUES (
  'ci-salon', 'ci-owner', 'Disposable Test Salon', 'disposable-test-salon',
  'ci-city', 'Test address', 0, 0, CURRENT_TIMESTAMP
);

INSERT INTO "services" ("id", "salonId", "name", "durationMinutes", "price", "updatedAt")
VALUES ('ci-service', 'ci-salon', 'Test service', 30, 100, CURRENT_TIMESTAMP);

INSERT INTO "queue_entries" (
  "id", "salonId", "customerId", "serviceId", "source", "tokenNumber", "status",
  "serviceCompletedAt", "updatedAt"
) VALUES
  ('ci-completed-queue', 'ci-salon', 'ci-customer', 'ci-service', 'WALK_IN', 1, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ci-expired-queue', 'ci-salon', 'ci-customer', 'ci-service', 'WALK_IN', 2, 'EXPIRED', NULL, CURRENT_TIMESTAMP),
  ('ci-foreign-queue', 'ci-salon', 'ci-other-customer', 'ci-service', 'WALK_IN', 3, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ci-linked-queue', 'ci-salon', 'ci-customer', 'ci-service', 'APPOINTMENT', 4, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- A verified completed standalone queue visit is a valid target.
INSERT INTO "reviews" (
  "id", "salonId", "customerId", "bookingId", "queueEntryId", "rating", "updatedAt"
) VALUES ('ci-valid-review', 'ci-salon', 'ci-customer', NULL, 'ci-completed-queue', 5, CURRENT_TIMESTAMP);

DO $$
BEGIN
  BEGIN
    INSERT INTO "reviews" (
      "id", "salonId", "customerId", "bookingId", "queueEntryId", "rating", "updatedAt"
    ) VALUES ('ci-duplicate-review', 'ci-salon', 'ci-customer', NULL, 'ci-completed-queue', 4, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'duplicate queue review unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "reviews" (
      "id", "salonId", "customerId", "bookingId", "queueEntryId", "rating", "updatedAt"
    ) VALUES ('ci-expired-review', 'ci-salon', 'ci-customer', NULL, 'ci-expired-queue', 4, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'review of expired queue visit unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "reviews" (
      "id", "salonId", "customerId", "bookingId", "queueEntryId", "rating", "updatedAt"
    ) VALUES ('ci-foreign-review', 'ci-salon', 'ci-customer', NULL, 'ci-foreign-queue', 4, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'cross-customer queue review unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "reviews" (
      "id", "salonId", "customerId", "bookingId", "queueEntryId", "rating", "updatedAt"
    ) VALUES ('ci-linked-review', 'ci-salon', 'ci-customer', NULL, 'ci-linked-queue', 4, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'booking-linked queue review unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "reviews" ("id", "salonId", "customerId", "bookingId", "queueEntryId", "rating", "updatedAt")
    VALUES ('ci-no-target-review', 'ci-salon', 'ci-customer', NULL, NULL, 4, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'review without a visit target unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;

-- Ensure the designated BarberCue primary administrator remains an active PLATFORM_ADMIN.
-- This migration is intentionally narrow and idempotent. It does not create a user, does not
-- alter passwords or TOTP secrets, and does not weaken mandatory MFA.

DO $$
DECLARE
  primary_user_id text;
BEGIN
  SELECT "id"
    INTO primary_user_id
    FROM "users"
   WHERE lower("email") = lower('mail2dev.kr@gmail.com')
   LIMIT 1;

  IF primary_user_id IS NULL THEN
    RAISE EXCEPTION 'PRIMARY_PLATFORM_ADMIN_USER_MISSING';
  END IF;

  UPDATE "users"
     SET "status" = 'ACTIVE',
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE "id" = primary_user_id
     AND "status" <> 'ACTIVE';

  IF NOT EXISTS (
    SELECT 1
      FROM "user_roles"
     WHERE "userId" = primary_user_id
       AND "role" = 'PLATFORM_ADMIN'
  ) THEN
    INSERT INTO "user_roles" ("id", "userId", "role", "salonId", "createdAt")
    VALUES (gen_random_uuid(), primary_user_id, 'PLATFORM_ADMIN', NULL, CURRENT_TIMESTAMP);
  END IF;
END
$$;

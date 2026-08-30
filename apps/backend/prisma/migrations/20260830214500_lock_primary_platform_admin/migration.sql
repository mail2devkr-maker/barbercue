-- BarberCue primary platform-admin safety rail.
--
-- The production admin account below is intentionally protected against accidental
-- demotion, suspension, email reassignment, or deletion. This does NOT weaken MFA:
-- admin login still requires the existing mandatory TOTP checks in AuthService.
-- TOTP/password rotation remains possible so compromised credentials can be recovered;
-- only disabling an already-enabled TOTP factor is blocked here.

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

CREATE OR REPLACE FUNCTION barbercue_protect_primary_admin_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lower(OLD."email") = lower('mail2dev.kr@gmail.com') THEN
      RAISE EXCEPTION 'PRIMARY_PLATFORM_ADMIN_DELETE_BLOCKED';
    END IF;
    RETURN OLD;
  END IF;

  IF lower(OLD."email") = lower('mail2dev.kr@gmail.com') THEN
    IF NEW."email" IS DISTINCT FROM OLD."email" THEN
      RAISE EXCEPTION 'PRIMARY_PLATFORM_ADMIN_EMAIL_CHANGE_BLOCKED';
    END IF;

    IF NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'PRIMARY_PLATFORM_ADMIN_SUSPEND_BLOCKED';
    END IF;

    -- MFA must never be silently disabled once enrolled. Secret rotation is allowed
    -- while twoFactorEnabled remains true, which preserves emergency recovery.
    IF OLD."twoFactorEnabled" = true
       AND (NEW."twoFactorEnabled" = false OR NEW."totpSecret" IS NULL) THEN
      RAISE EXCEPTION 'PRIMARY_PLATFORM_ADMIN_MFA_DISABLE_BLOCKED';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS barbercue_primary_admin_user_guard ON "users";
CREATE TRIGGER barbercue_primary_admin_user_guard
BEFORE UPDATE OR DELETE ON "users"
FOR EACH ROW
EXECUTE FUNCTION barbercue_protect_primary_admin_user();

CREATE OR REPLACE FUNCTION barbercue_protect_primary_admin_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  protected_user_id text;
BEGIN
  SELECT "id"
    INTO protected_user_id
    FROM "users"
   WHERE lower("email") = lower('mail2dev.kr@gmail.com')
   LIMIT 1;

  IF protected_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."userId" = protected_user_id AND OLD."role" = 'PLATFORM_ADMIN' THEN
      RAISE EXCEPTION 'PRIMARY_PLATFORM_ADMIN_ROLE_REMOVAL_BLOCKED';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."userId" = protected_user_id
     AND OLD."role" = 'PLATFORM_ADMIN'
     AND (NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."role" <> 'PLATFORM_ADMIN') THEN
    RAISE EXCEPTION 'PRIMARY_PLATFORM_ADMIN_ROLE_CHANGE_BLOCKED';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS barbercue_primary_admin_role_guard ON "user_roles";
CREATE TRIGGER barbercue_primary_admin_role_guard
BEFORE UPDATE OR DELETE ON "user_roles"
FOR EACH ROW
EXECUTE FUNCTION barbercue_protect_primary_admin_role();

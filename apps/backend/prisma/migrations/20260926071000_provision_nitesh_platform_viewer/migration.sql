-- PLATFORM_VIEWER is a global-only role, same scope shape as PLATFORM_ADMIN.
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_platform_viewer_global"
  CHECK ("role" <> 'PLATFORM_VIEWER' OR "salonId" IS NULL);

-- Provision the owner-approved read-only dashboard account. If this email already belongs to an
-- existing FastQue customer/staff account, preserve that user and add only the new global role.
-- No password, TOTP secret, salon role, or other privilege is created here. First admin-dashboard
-- sign-in must verify this Gmail account with Google and enroll TOTP before any ADMIN session exists.
DO $$
DECLARE
  viewer_user_id text;
BEGIN
  SELECT "id"
    INTO viewer_user_id
    FROM "users"
   WHERE lower("email") = lower('nitesh.khare1987@gmail.com')
   LIMIT 1;

  IF viewer_user_id IS NULL THEN
    INSERT INTO "users" (
      "id",
      "email",
      "status",
      "twoFactorEnabled",
      "preferredLanguage",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      gen_random_uuid(),
      'nitesh.khare1987@gmail.com',
      'ACTIVE',
      false,
      'EN',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING "id" INTO viewer_user_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM "user_roles"
     WHERE "userId" = viewer_user_id
       AND "role" = 'PLATFORM_VIEWER'
       AND "salonId" IS NULL
  ) THEN
    INSERT INTO "user_roles" ("id", "userId", "role", "salonId", "createdAt")
    VALUES (gen_random_uuid(), viewer_user_id, 'PLATFORM_VIEWER', NULL, CURRENT_TIMESTAMP);
  END IF;
END
$$;

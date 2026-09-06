-- Auth security fix: authentication used to sign EVERY role a User row held into every session
-- regardless of which login surface actually authenticated it (customer OTP/Google, staff
-- password/Google, or the TOTP-gated admin flows). A User holding both CUSTOMER and PLATFORM_ADMIN
-- could therefore obtain PLATFORM_ADMIN authority through the ordinary customer login path, with
-- no TOTP involved. See TokenService.issueTokenPair/rotateRefreshToken for the corrected logic that
-- now depends on this migration's new "audience" column.

-- CreateEnum
CREATE TYPE "SessionAudience" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- AlterTable: added nullable first — existing rows need a value before a NOT NULL constraint can
-- be applied below.
ALTER TABLE "refresh_tokens" ADD COLUMN "audience" "SessionAudience";

-- Every refresh token issued before this migration was issued by the unscoped code above — its
-- true intended audience is unknown and must never be guessed or assigned a real privilege level
-- after the fact. Revoke every such row outright; every affected user simply logs in again through
-- the correct flow, which now issues a correctly-scoped session from the start. The literal
-- 'CUSTOMER' placeholder below exists ONLY to satisfy the NOT NULL constraint added immediately
-- after — every row that receives it is revoked in this exact same statement, and
-- TokenService.rotateRefreshToken's atomic claim (`WHERE "revokedAt" IS NULL`) can never select an
-- already-revoked row, so this placeholder value is never read as a privilege decision by any code
-- path, present or future.
UPDATE "refresh_tokens"
   SET "audience" = 'CUSTOMER',
       "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP)
 WHERE "audience" IS NULL;

-- AlterTable: now safe — every existing row was backfilled+revoked above, and every row from this
-- point on is created exclusively by TokenService.issueTokenPair, which always supplies a real
-- audience.
ALTER TABLE "refresh_tokens" ALTER COLUMN "audience" SET NOT NULL;

-- DB-level defense in depth: PLATFORM_ADMIN is a GLOBAL role by product convention (see
-- SalonAccessService's own doc comment) — this makes a salon-scoped PLATFORM_ADMIN row impossible
-- to persist at all, regardless of what application code does. Every other role is completely
-- unconstrained by this (the OR makes the check pass unconditionally for non-PLATFORM_ADMIN rows).
-- Production read-only inspection confirmed the current PLATFORM_ADMIN row already has
-- "salonId" IS NULL, so this does not conflict with any existing valid data.
ALTER TABLE "user_roles" ADD CONSTRAINT "platform_admin_must_be_global" CHECK ("role" != 'PLATFORM_ADMIN' OR "salonId" IS NULL);

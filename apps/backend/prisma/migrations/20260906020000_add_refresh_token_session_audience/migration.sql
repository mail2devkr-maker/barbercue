-- Auth security fix: authentication used to sign EVERY role a User row held into every session
-- regardless of which login surface actually authenticated it (customer OTP/Google, staff
-- password/Google, or the TOTP-gated admin flows). A User holding both CUSTOMER and PLATFORM_ADMIN
-- could therefore obtain PLATFORM_ADMIN authority through the ordinary customer login path, with
-- no TOTP involved. See TokenService.issueTokenPair/rotateRefreshToken for the corrected logic that
-- now depends on this migration's new "audience" column.

-- CreateEnum
CREATE TYPE "SessionAudience" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- AlterTable: Railway runs `prisma migrate deploy` as a PRE-DEPLOY step — this migration lands
-- against production while the OLD backend binary (pre-audience, with no knowledge of this column)
-- is still the one serving traffic, right up until the new binary actually starts. That old binary
-- will keep calling `prisma.refreshToken.create({...})` without an `audience` field for as long as
-- it's still running, so this column CANNOT be a bare NOT NULL with no default — that would turn
-- every one of those in-flight inserts into a hard failure for the remainder of the cutover window,
-- and would also make rolling the binary back after a failed deploy unsafe (the old binary would
-- immediately start failing every login again). A DB-level DEFAULT is the fix: the old binary's
-- inserts keep succeeding, transparently, at read-DEFAULT time.
--
-- CUSTOMER — the lowest-privilege audience that exists — is the only acceptable value for that
-- default. It is never STAFF or ADMIN: if a legacy-shaped insert during the overlap window ever
-- gets re-scoped by the NEW code later (e.g. a rotation after full cutover), the worst case is an
-- over-eager downgrade to a customer-only session (forcing a re-login), never an unearned grant of
-- staff or admin authority. This mirrors the same "fail closed toward the least privilege" rule the
-- rest of this fix already applies everywhere else.
ALTER TABLE "refresh_tokens" ADD COLUMN "audience" "SessionAudience" NOT NULL DEFAULT 'CUSTOMER';

-- Every refresh token that already existed when this migration runs was issued by the unscoped
-- code above (this ADD COLUMN just backfilled all of them to the 'CUSTOMER' default via the
-- statement above) — its true intended audience is unknown and must never be guessed or promoted
-- to a real privilege level after the fact. Revoke every one of them outright; every affected user
-- simply logs in again through the correct flow, which now issues a correctly-scoped session from
-- the start. `prisma migrate deploy` runs this whole file as one transaction, so this UPDATE and
-- the ADD COLUMN above execute atomically — no concurrent insert from the still-running old binary
-- can land "in between" them and escape being revoked here; it either committed before this
-- transaction started or is blocked until after this transaction commits.
UPDATE "refresh_tokens"
   SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP);

-- DB-level defense in depth: PLATFORM_ADMIN is a GLOBAL role by product convention (see
-- SalonAccessService's own doc comment) — this makes a salon-scoped PLATFORM_ADMIN row impossible
-- to persist at all, regardless of what application code does. Every other role is completely
-- unconstrained by this (the OR makes the check pass unconditionally for non-PLATFORM_ADMIN rows).
-- Production read-only inspection confirmed the current PLATFORM_ADMIN row already has
-- "salonId" IS NULL, so this does not conflict with any existing valid data.
ALTER TABLE "user_roles" ADD CONSTRAINT "platform_admin_must_be_global" CHECK ("role" != 'PLATFORM_ADMIN' OR "salonId" IS NULL);

-- NOTE for a later, separate, post-stabilization migration: the 'CUSTOMER' DEFAULT above exists
-- ONLY to keep the old binary's inserts alive during this one cutover. Once no old (pre-audience)
-- binary can ever serve requests again (i.e. this deploy has fully rolled forward with no rollback
-- planned), a follow-up migration should run
--   ALTER TABLE "refresh_tokens" ALTER COLUMN "audience" DROP DEFAULT;
-- so every future insert is required to state its audience explicitly again, exactly as
-- TokenService.issueTokenPair already always does — the default should not linger as a silent
-- fallback for new code paths written after this cutover is long over. This migration deliberately
-- does NOT do that itself, since dropping it too early (before the old binary is fully retired)
-- would reintroduce the exact hard-failure risk this migration exists to avoid.

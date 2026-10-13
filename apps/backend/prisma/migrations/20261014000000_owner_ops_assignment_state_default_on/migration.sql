-- Owner-operations corrective mission (Oct 2026): automatic staff assignment defaults ON, and
-- "assigned to a barber" becomes a state separate from "service started".
--
-- This migration is ADDITIVE. It is a new file on purpose: 20261013000100_owner_ops_foundation is
-- left byte-for-byte as it was, so its checksum stays valid on any database (development, a staging
-- copy, a Neon branch) that already applied it.
--
-- 1. salons.queueAutoAssignEnabled: the column default becomes true. A boolean cannot tell "never
--    chosen" from "explicitly switched off", so existing rows are only moved to ON when the audit
--    trail proves nobody ever chose: the value is false AND the salon has NO
--    QUEUE_AUTO_ASSIGN_ENABLED / QUEUE_AUTO_ASSIGN_DISABLED audit row. Any salon with such a row (an
--    owner interacted with the setting) is left exactly as it is, including a genuine OFF. Every
--    salon moved is recorded with a QUEUE_AUTO_ASSIGN_DEFAULT_APPLIED audit row so the change is
--    traceable and a mistaken one can be reverted per salon.
-- 2. queue_entries.assignedAt: nullable timestamp, no backfill (historical rows were seated and
--    started in one step; they stay interpretable as before).
-- 3. Two PARTIAL unique indexes: while a customer is assigned-but-not-started (status = 'CALLED'
--    with an assigned barber/chair) that barber and that chair cannot be held by a second assigned
--    customer. Before this release no CALLED row ever carried an assigned barber or chair, so the
--    indexes cannot be violated by existing data; they are the database backstop behind the
--    per-salon advisory lock the assignment code already takes. No existing enum value changes
--    meaning and no row is rewritten except the audited default flip in step 1.

ALTER TABLE "salons" ALTER COLUMN "queueAutoAssignEnabled" SET DEFAULT true;

WITH flipped AS (
  UPDATE "salons" AS s
     SET "queueAutoAssignEnabled" = true
   WHERE s."queueAutoAssignEnabled" = false
     AND NOT EXISTS (
       SELECT 1
         FROM "audit_logs" AS a
        WHERE a."entityType" = 'Salon'
          AND a."entityId" = s."id"
          AND a."action" IN ('QUEUE_AUTO_ASSIGN_ENABLED', 'QUEUE_AUTO_ASSIGN_DISABLED')
     )
  RETURNING s."id"
)
INSERT INTO "audit_logs" ("id", "actorUserId", "action", "entityType", "entityId", "metadata", "createdAt")
SELECT gen_random_uuid()::text,
       NULL,
       'QUEUE_AUTO_ASSIGN_DEFAULT_APPLIED',
       'Salon',
       flipped."id",
       jsonb_build_object(
         'from', false,
         'to', true,
         'basis', 'platform default changed to ON; no owner choice was recorded for this shop'
       ),
       CURRENT_TIMESTAMP
  FROM flipped;

ALTER TABLE "queue_entries" ADD COLUMN "assignedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "queue_entries_assigned_staff_hold_key"
  ON "queue_entries" ("assignedStaffId")
  WHERE "status" = 'CALLED' AND "assignedStaffId" IS NOT NULL;

CREATE UNIQUE INDEX "queue_entries_assigned_chair_hold_key"
  ON "queue_entries" ("assignedChairId")
  WHERE "status" = 'CALLED' AND "assignedChairId" IS NOT NULL;

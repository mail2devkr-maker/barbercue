-- Seeds the platform-default CancellationPolicy row (salonId NULL) if one doesn't already exist.
--
-- CancellationPolicyService.getEffectivePolicy() falls back to this row for any salon that hasn't
-- configured its own policy, and hard-throws CANCELLATION_POLICY_MISSING (500) when neither exists
-- — that fallback row has only ever been created by prisma/seed.ts's
-- seedPlatformDefaultCancellationPolicy(), a dev/test convenience that is never invoked by the
-- production deploy pipeline (which only runs `prisma migrate deploy`). Concretely: GET
-- salons/:salonId/booking/cancellation-policy 500s for every salon without its own explicit row —
-- which in production is most of them — breaking both the cancellation-charge preview and the
-- actual POST .../cancel action itself, since bookings.service.ts's cancel() calls the exact same
-- getEffectivePolicy(). This migration is the idempotent, deploy-pipeline-safe fix: it runs
-- automatically on the next `prisma migrate deploy`, same as every other schema change, rather
-- than requiring a manual production data write.
--
-- Values match seed.ts's seedPlatformDefaultCancellationPolicy() exactly, per DATABASE.md's
-- documented V1 platform default (60 min free window, 50% late-cancellation charge, 100% no-show
-- charge). salonId is nullable-UNIQUE, and Postgres treats every NULL as distinct under a unique
-- constraint, so this can't be an ON CONFLICT upsert — the NOT EXISTS guard is what keeps this
-- migration safe to reason about even if a row somehow already exists.
INSERT INTO "cancellation_policies" (
  "id",
  "salonId",
  "freeCancellationWindowMinutes",
  "lateCancellationChargeType",
  "lateCancellationChargeValue",
  "noShowChargeType",
  "noShowChargeValue",
  "appointmentArrivalGraceMinutes",
  "queueCallResponseGraceMinutes",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  NULL,
  60,
  'PERCENTAGE',
  50,
  'PERCENTAGE',
  100,
  10,
  3,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "cancellation_policies" WHERE "salonId" IS NULL
);

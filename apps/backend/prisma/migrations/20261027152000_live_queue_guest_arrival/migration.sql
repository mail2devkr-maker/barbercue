-- Additive, nullable queue guest capability and arrival-alert fields.
-- No changes to existing queue rows, customer accounts, bookings or owner accounts.
ALTER TABLE "queue_entries"
  ADD COLUMN "guestAccessHash" VARCHAR(64),
  ADD COLUMN "guestAccessExpiresAt" TIMESTAMPTZ(6),
  ADD COLUMN "guestExpoPushToken" VARCHAR(255),
  ADD COLUMN "arrivalPromptSentAt" TIMESTAMPTZ(6),
  ADD COLUMN "customerArrivalResponse" BOOLEAN,
  ADD COLUMN "customerArrivalResponseAt" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "queue_entries_guestAccessHash_key"
  ON "queue_entries" ("guestAccessHash");
CREATE INDEX "queue_entries_arrival_prompt_candidates_idx"
  ON "queue_entries" ("status", "estimatedWaitMinutes")
  WHERE "arrivalPromptSentAt" IS NULL AND "arrivedAt" IS NULL;

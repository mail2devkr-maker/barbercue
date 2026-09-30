-- Owner temporary-close state.
-- Keeps an ACTIVE salon discoverable while preventing same-day booking/queue entry.
ALTER TABLE "Salon"
ADD COLUMN "isClosedForToday" BOOLEAN NOT NULL DEFAULT false;

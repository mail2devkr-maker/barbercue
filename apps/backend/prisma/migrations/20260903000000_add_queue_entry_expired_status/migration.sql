-- Issue #13 P0 (stale queue/token regression): additive only, no existing value touched or dropped.
-- Closes the WAITING --> EXPIRED gap: a WAITING queue entry never called/assigned/cancelled had no
-- terminal state to sweep into, so it stayed WAITING forever (visible/actionable in the owner Live
-- Queue indefinitely, and via assertNotAlreadyInQueue's cross-salon check, permanently blocking that
-- customer from ever joining a queue again). See QueueEntryExpiryService.markStaleWaitingExpired.

-- AlterEnum
ALTER TYPE "QueueEntryStatus" ADD VALUE 'EXPIRED';

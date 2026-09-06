-- Part 5 completion (arrival guidance): snapshot the check-in window rules in effect at booking
-- creation time onto the booking itself, so a later change to a salon's CancellationPolicy (or the
-- platform-wide early-check-in constant) never retroactively changes what a past booking's arrival
-- guidance displays. Additive and nullable only -- no existing row's data is touched; a booking
-- created before this migration simply has no snapshot and shows no arrival guidance (never a
-- guess based on the CURRENT policy).

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "checkInOpensMinutesBefore" INTEGER,
ADD COLUMN     "checkInDueGraceMinutes" INTEGER;

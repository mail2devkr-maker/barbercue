-- Notification preferences: a dedicated ARRIVAL_ALERTS category for the time-critical "has the
-- customer arrived?" check, separate from ordinary BOOKING_UPDATES.
--
-- Additive and data-free. This adds an enum VALUE only: it inserts, updates and deletes NO rows,
-- and in particular writes nothing to "notification_preferences". "No stored row" already means
-- "the default" (every category defaults ON), so every existing user - with or without preference
-- rows - stays ON for the new category without us materialising anything. Nothing can be silently
-- turned OFF by this migration.

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'ARRIVAL_ALERTS';

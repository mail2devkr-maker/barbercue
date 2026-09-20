import { NotificationCategory, NotificationChannel } from './enums';

// Notification preferences: the single definition of which categories exist, which the user can
// toggle where, and what happens when they have never configured anything.
//
// The convention this whole feature rests on: a stored NotificationPreference row records only what
// a user explicitly CHANGED. No row means "the default" - it is never materialised, so an existing
// user (and a brand-new one) simply gets the default, and a migration can never silently turn
// anything OFF.

/** Operational categories, in the order settings screens present them. */
export const OPERATIONAL_NOTIFICATION_CATEGORIES = [
  NotificationCategory.BOOKING_UPDATES,
  NotificationCategory.QUEUE_UPDATES,
  NotificationCategory.ARRIVAL_ALERTS,
  NotificationCategory.REMINDERS,
] as const;

/** Every category, operational first, promotional last and kept a separate toggle. */
export const ALL_NOTIFICATION_CATEGORIES = [
  ...OPERATIONAL_NOTIFICATION_CATEGORIES,
  NotificationCategory.PROMOTIONAL,
] as const;

/** The channels a person can actually control in Settings - the two FastQue really delivers on. */
export const SETTINGS_NOTIFICATION_CHANNELS = [
  NotificationChannel.PUSH,
  NotificationChannel.IN_APP,
] as const;

/**
 * What a user who has never touched a category/channel gets. Every category is ON. (PROMOTIONAL is
 * ON only because nothing produces promotional notifications yet, and it is left as it was so this
 * change flips nothing for existing users; making offers opt-in is a separate consent decision.)
 */
export const NOTIFICATION_CATEGORY_DEFAULT_ENABLED: Readonly<Record<NotificationCategory, boolean>> = {
  [NotificationCategory.BOOKING_UPDATES]: true,
  [NotificationCategory.QUEUE_UPDATES]: true,
  [NotificationCategory.ARRIVAL_ALERTS]: true,
  [NotificationCategory.REMINDERS]: true,
  [NotificationCategory.PROMOTIONAL]: true,
};

export function isOperationalNotificationCategory(category: NotificationCategory): boolean {
  return (OPERATIONAL_NOTIFICATION_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Resolves whether a category is enabled on a channel from what is stored (or not). `stored` is the
 * row's `enabled` value, or null/undefined when the user never configured it - in which case the
 * default applies. Server delivery gates and the preferences DTO both go through this, so what a
 * settings screen shows is exactly what delivery does.
 */
export function resolveNotificationPreference(
  stored: boolean | null | undefined,
  category: NotificationCategory,
): boolean {
  return stored ?? NOTIFICATION_CATEGORY_DEFAULT_ENABLED[category];
}

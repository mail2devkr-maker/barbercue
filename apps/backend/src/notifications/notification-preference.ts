import type { Prisma } from '@prisma/client';
import {
  resolveNotificationPreference,
  type NotificationCategory,
  type NotificationChannel,
} from '@barbercue/shared';

/** Anything that can read NotificationPreference rows: PrismaService or a transaction client. */
export interface PreferenceReader {
  notificationPreference: {
    findUnique(args: Prisma.NotificationPreferenceFindUniqueArgs): Promise<{ enabled: boolean } | null>;
  };
}

/**
 * The one place a user's stored preference is turned into "is this category on for this channel".
 * Both delivery gates use it - the in-app Notification Center (NotificationsService) and Expo push
 * (PushDispatchService) - so an OFF preference stops exactly the category+channel it names, and a
 * user who never configured anything (no row) gets the default (ON) rather than silence.
 *
 * It only reads; it never creates a row. OS-level permission, mute and Do-Not-Disturb are applied by
 * the phone after delivery and are deliberately outside this function.
 */
export async function isNotificationEnabled(
  db: PreferenceReader,
  userId: string,
  category: NotificationCategory,
  channel: NotificationChannel,
): Promise<boolean> {
  const row = await db.notificationPreference.findUnique({
    where: { userId_category_channel: { userId, category, channel } },
  });
  return resolveNotificationPreference(row?.enabled, category, channel);
}

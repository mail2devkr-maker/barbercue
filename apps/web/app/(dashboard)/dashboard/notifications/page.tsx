"use client";

import Link from "next/link";
import { uiStringsFor } from "@barbercue/shared";
import { useAuth } from "../../../../lib/auth-context";
import { NotificationPreferencesPanel } from "../../../../components/notifications/NotificationPreferencesPanel";
import styles from "../../../../components/dashboard/dashboard.module.css";

// Owner / staff notification settings. Preferences belong to the person, not to a shop, so this
// lives at the dashboard level rather than under a salon. The panel itself is shared with the
// customer profile page - one implementation, server-side preferences.
export default function DashboardNotificationSettingsPage() {
  const { user } = useAuth();
  const t = uiStringsFor(user?.preferredLanguage ?? "EN");
  return (
    <main className={styles.pageWide}>
      <h1 className={styles.pageTitle}>{t.notificationSettingsTitle}</h1>
      <p className={styles.pageSubtitle}>{t.notificationSettingsIntro}</p>
      <NotificationPreferencesPanel />
      <p>
        <Link href="/dashboard/salons">← Back to your shops</Link>
      </p>
    </main>
  );
}

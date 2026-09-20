"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ALL_NOTIFICATION_CATEGORIES,
  NOTIFICATION_PATHS,
  NotificationCategory,
  NotificationChannel,
  OPERATIONAL_NOTIFICATION_CATEGORIES,
  Role,
  notificationCategoryCopy,
  uiStringsFor,
  type NotificationPreferencesDto,
} from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import styles from "./notification-preferences.module.css";

const PREFERENCES_PATH = `${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.preferences}`;

type Channel = typeof NotificationChannel.PUSH | typeof NotificationChannel.IN_APP;
const CHANNELS: readonly Channel[] = [NotificationChannel.PUSH, NotificationChannel.IN_APP];

function enabledFor(prefs: NotificationPreferencesDto, category: NotificationCategory, channel: Channel): boolean {
  // The server returns every pair; if one is ever missing the default is ON.
  return prefs.categories.find((c) => c.category === category)?.channels.find((c) => c.channel === channel)?.enabled ?? true;
}

/** The critical arrival prompt is mandatory shop operations: shown as "Required", never as a checkbox. */
function requiredFor(prefs: NotificationPreferencesDto, category: NotificationCategory, channel: Channel): boolean {
  return prefs.categories.find((c) => c.category === category)?.channels.find((c) => c.channel === channel)?.required === true;
}

function withEnabled(
  prefs: NotificationPreferencesDto,
  category: NotificationCategory,
  channel: Channel,
  enabled: boolean,
): NotificationPreferencesDto {
  return {
    categories: prefs.categories.map((c) =>
      c.category !== category
        ? c
        : { ...c, channels: c.channels.map((ch) => (ch.channel === channel ? { ...ch, enabled } : ch)) },
    ),
  };
}

/**
 * Notification preferences for the signed-in user (web). Shared by the customer profile page and
 * the owner/staff dashboard so there is exactly one implementation. Every toggle is a real
 * server-side preference: an OFF stops that category on that channel before delivery, and a
 * category the user never touched is ON. It always renders what the server returns and re-reads on
 * mount, so what persists is what shows.
 *
 * The device/OS notification permission, mute and Do Not Disturb still apply to whatever is
 * delivered; nothing here tries to override them.
 */
export function NotificationPreferencesPanel() {
  const { user } = useAuth();
  const t = uiStringsFor(user?.preferredLanguage ?? "EN");
  const isOperator = Boolean(
    user?.roles.some((r) => r === Role.SALON_OWNER || r === Role.SALON_STAFF || r === Role.PLATFORM_ADMIN),
  );

  const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setPrefs(await apiFetch<NotificationPreferencesDto>(PREFERENCES_PATH));
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(category: NotificationCategory, channel: Channel, next: boolean) {
    if (!prefs) return;
    const key = `${category}:${channel}`;
    const before = prefs;
    setSaveError(false);
    setSaving(key);
    setPrefs(withEnabled(before, category, channel, next)); // optimistic, reverted on failure
    try {
      setPrefs(
        await apiFetch<NotificationPreferencesDto>(PREFERENCES_PATH, {
          method: "PUT",
          body: JSON.stringify({ category, channel, enabled: next }),
        }),
      );
    } catch {
      setPrefs(before);
      setSaveError(true);
    } finally {
      setSaving(null);
    }
  }

  // Arrival alerts are an operator concept; customers never receive them, so they are not shown one.
  const operational = OPERATIONAL_NOTIFICATION_CATEGORIES.filter(
    (c) => isOperator || c !== NotificationCategory.ARRIVAL_ALERTS,
  );
  const promotional = ALL_NOTIFICATION_CATEGORIES.filter(
    (c) => !(OPERATIONAL_NOTIFICATION_CATEGORIES as readonly string[]).includes(c),
  );

  function row(category: NotificationCategory) {
    if (!prefs) return null;
    const copy = notificationCategoryCopy(t, category);
    return (
      <div key={category} className={styles.category} role="group" aria-label={copy.title}>
        <div>
          <p className={styles.categoryTitle}>{copy.title}</p>
          <p className={styles.categoryDesc}>{copy.description}</p>
          {category === NotificationCategory.ARRIVAL_ALERTS && (
            <p className={styles.note}>{t.notificationSettingsArrivalNote}</p>
          )}
        </div>
        <div className={styles.toggles}>
          {CHANNELS.map((channel) => {
            const key = `${category}:${channel}`;
            const label = channel === NotificationChannel.PUSH ? t.notificationChannelPush : t.notificationChannelInApp;
            if (requiredFor(prefs, category, channel)) {
              return (
                <span key={key} className={styles.toggle} data-testid={`required-${key}`}>
                  <span>{label}</span>
                  <strong>{t.notificationRequiredBadge}</strong>
                </span>
              );
            }
            return (
              <label key={key} className={styles.toggle}>
                <input
                  type="checkbox"
                  data-testid={`pref-${key}`}
                  aria-label={`${copy.title}: ${label}`}
                  checked={enabledFor(prefs, category, channel)}
                  disabled={saving === key}
                  onChange={(e) => void toggle(category, channel, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <p className={styles.note}>{t.notificationSettingsOsNote}</p>
      <p className={styles.note}>{t.notificationSettingsPushNote}</p>

      {loadError && (
        <p className={styles.error} role="alert">
          {t.notificationSettingsLoadFailed}{" "}
          <button type="button" className={styles.retry} onClick={() => void load()}>
            {t.notificationSettingsRetry}
          </button>
        </p>
      )}
      {saveError && (
        <p className={styles.error} role="alert">
          {t.notificationSettingsSaveFailed}
        </p>
      )}

      {prefs === null && !loadError && <p className={styles.note}>Loading…</p>}

      {prefs && (
        <>
          <h3 className={styles.heading}>{t.notificationSettingsOperationalHeading}</h3>
          {operational.map((category) => row(category))}

          <h3 className={styles.heading}>{t.notificationSettingsPromoHeading}</h3>
          <p className={styles.note}>{t.notificationSettingsPromoNote}</p>
          {promotional.map((category) => row(category))}
        </>
      )}
    </div>
  );
}

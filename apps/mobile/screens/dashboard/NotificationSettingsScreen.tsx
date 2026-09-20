import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  ALL_NOTIFICATION_CATEGORIES,
  NOTIFICATION_PATHS,
  NotificationCategory,
  NotificationChannel,
  OPERATIONAL_NOTIFICATION_CATEGORIES,
  notificationCategoryCopy,
  type NotificationPreferencesDto,
} from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, lineHeightFor, space } from '../../lib/theme';
import { Button, Card, InlineError, Screen, SectionHeader } from '../../components/ui';

const PREFERENCES_PATH = `${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.preferences}`;

type Channel = typeof NotificationChannel.PUSH | typeof NotificationChannel.IN_APP;

function isEnabled(prefs: NotificationPreferencesDto, category: NotificationCategory, channel: Channel): boolean {
  const row = prefs.categories.find((c) => c.category === category)?.channels.find((c) => c.channel === channel);
  // The server always returns every pair; if one is somehow missing the default is ON.
  return row?.enabled ?? true;
}

function isAvailable(prefs: NotificationPreferencesDto, category: NotificationCategory, channel: Channel): boolean {
  return prefs.categories.find((c) => c.category === category)?.channels.find((c) => c.channel === channel)?.available ?? true;
}

/** Same result with one category+channel flipped - used for the optimistic update. */
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
 * Settings -> Notifications for owners and staff. Every toggle is a real, server-side preference:
 * an OFF stops that category on that channel before anything is delivered, and a category the user
 * never touched is simply ON. This screen never guesses - it always renders what the server says,
 * and re-reads it on open, so what persists is what shows.
 *
 * The phone's own notification permission, mute and Do Not Disturb always win over anything chosen
 * here; this screen never tries to work around them (it only tells the user when the OS has
 * notifications turned off, and offers to open the phone's settings).
 */
export default function NotificationSettingsScreen() {
  const { t } = useLanguage();
  const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [osDenied, setOsDenied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPrefs(await apiFetch<NotificationPreferencesDto>(PREFERENCES_PATH));
    } catch {
      setLoadError(t.notificationSettingsLoadFailed);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    Notifications.getPermissionsAsync()
      .then((permission) => {
        if (!cancelled) setOsDenied(permission.status === 'denied');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(category: NotificationCategory, channel: Channel, next: boolean) {
    if (!prefs) return;
    const key = `${category}:${channel}`;
    const before = prefs;
    setSaveError(null);
    setSaving(key);
    setPrefs(withEnabled(before, category, channel, next)); // optimistic, reverted on failure
    try {
      // The server's answer is the source of truth for what was actually stored.
      setPrefs(
        await apiFetch<NotificationPreferencesDto>(PREFERENCES_PATH, {
          method: 'PUT',
          body: JSON.stringify({ category, channel, enabled: next }),
        }),
      );
    } catch {
      setPrefs(before);
      setSaveError(t.notificationSettingsSaveFailed);
    } finally {
      setSaving(null);
    }
  }

  function row(category: NotificationCategory) {
    if (!prefs) return null;
    const copy = notificationCategoryCopy(t, category);
    return (
      <View key={category} style={styles.categoryBlock}>
        <Text style={styles.categoryTitle}>{copy.title}</Text>
        <Text style={styles.categoryDesc}>{copy.description}</Text>
        {category === NotificationCategory.ARRIVAL_ALERTS && (
          <Text style={styles.categoryNote}>{t.notificationSettingsArrivalNote}</Text>
        )}
        {([NotificationChannel.PUSH, NotificationChannel.IN_APP] as const).map((channel) => {
          const key = `${category}:${channel}`;
          const label = channel === NotificationChannel.PUSH ? t.notificationChannelPush : t.notificationChannelInApp;
          return (
            <View key={key} style={styles.switchRow}>
              <Text style={styles.switchLabel}>{label}</Text>
              <Switch
                testID={`switch-${key}`}
                accessibilityLabel={`${copy.title}: ${label}`}
                value={isEnabled(prefs, category, channel)}
                disabled={saving === key || !isAvailable(prefs, category, channel)}
                onValueChange={(next) => void toggle(category, channel, next)}
                trackColor={{ true: color.accent, false: color.border }}
              />
            </View>
          );
        })}
      </View>
    );
  }

  const promotional = ALL_NOTIFICATION_CATEGORIES.filter(
    (c) => !(OPERATIONAL_NOTIFICATION_CATEGORIES as readonly string[]).includes(c),
  );

  return (
    <Screen>
      <SectionHeader title={t.notificationSettingsTitle} subtitle={t.notificationSettingsIntro} />

      <Card style={styles.card}>
        <Text style={styles.osNote}>{t.notificationSettingsOsNote}</Text>
        {osDenied && (
          <View style={styles.osDenied}>
            <Text style={styles.osDeniedText}>{t.notificationSettingsOsDenied}</Text>
            <Button title={t.notificationSettingsOpenOs} variant="outline" onPress={() => void Linking.openSettings()} />
          </View>
        )}
      </Card>

      {loadError && (
        <>
          <InlineError message={loadError} />
          <Button title={t.notificationSettingsRetry} variant="outline" onPress={() => void load()} />
        </>
      )}
      {saveError && <InlineError message={saveError} />}

      {prefs && (
        <>
          <Card style={styles.card}>
            <Text style={styles.sectionHeading}>{t.notificationSettingsOperationalHeading}</Text>
            {OPERATIONAL_NOTIFICATION_CATEGORIES.map((category) => row(category))}
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionHeading}>{t.notificationSettingsPromoHeading}</Text>
            <Text style={styles.categoryNote}>{t.notificationSettingsPromoNote}</Text>
            {promotional.map((category) => row(category))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[3] },
  osNote: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted },
  osDenied: { marginTop: space[3], gap: space[2] },
  osDeniedText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
  sectionHeading: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), color: color.ink, marginBottom: space[2] },
  categoryBlock: { paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.border },
  categoryTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.ink },
  categoryDesc: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted, marginTop: space[1] },
  categoryNote: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: space[1] },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  switchLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
});

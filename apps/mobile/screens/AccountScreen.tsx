import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AUTH_PATHS,
  LANGUAGE_LABELS,
  Language,
  PREMIUM_PATHS,
  Role,
  type AuthSession,
  type MeResponse,
  type PremiumEntitlementDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button } from '../components/ui';
import { InlineError } from '../components/ui/ErrorState';
import type { AccountStackParamList, TabParamList } from '../navigation/types';

const ROLE_LABELS: Record<string, string> = {
  [Role.CUSTOMER]: 'Customer',
  [Role.SALON_STAFF]: 'Salon Staff',
  [Role.SALON_OWNER]: 'Salon Owner',
  [Role.PLATFORM_ADMIN]: 'Platform Admin',
};

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<AccountStackParamList, 'Account'>,
  BottomTabNavigationProp<TabParamList>
>;

// Fields shown are exactly what MeResponse carries (id, roles, phone, email) — the same set web's
// own /account/profile page shows. There is no general profile-edit endpoint on the backend (web's
// page is read-only too); the one exception is preferredLanguage (Phase 14), which has its own
// dedicated PATCH auth/language endpoint and switcher below, mirroring web's profile page.
export default function AccountScreen() {
  const navigation = useNavigation<Nav>();
  const { user, logout, refreshMe } = useAuth();

  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);

  const [premium, setPremium] = useState<PremiumEntitlementDto | null>(null);

  async function changeLanguage(language: Language) {
    if (language === user?.preferredLanguage || savingLanguage) return;
    setSavingLanguage(true);
    try {
      await apiFetch<MeResponse>(`auth/${AUTH_PATHS.language}`, {
        method: 'PATCH',
        body: JSON.stringify({ language }),
      });
      await refreshMe();
    } catch {
      /* the buttons below just keep reflecting whatever preferredLanguage actually saved */
    } finally {
      setSavingLanguage(false);
    }
  }

  const loadSessions = useCallback(async () => {
    setSessionsError(null);
    try {
      const result = await apiFetch<AuthSession[]>(`auth/${AUTH_PATHS.sessions}`);
      setSessions(result);
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.message : 'Could not load your sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSessions();
      apiFetch<PremiumEntitlementDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.me}`)
        .then(setPremium)
        .catch(() => setPremium(null));
    }, [loadSessions]),
  );

  async function revokeSession(id: string) {
    setRevokingId(id);
    setSessionsError(null);
    try {
      await apiFetch(`auth/${AUTH_PATHS.sessions}/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.message : 'Could not sign out that session.');
    } finally {
      setRevokingId(null);
    }
  }

  async function revokeOtherSessions() {
    const others = sessions.filter((s) => !s.current);
    if (others.length === 0) return;
    setRevokingOthers(true);
    setSessionsError(null);
    try {
      await Promise.all(others.map((s) => apiFetch(`auth/${AUTH_PATHS.sessions}/${s.id}`, { method: 'DELETE' })));
      setSessions((prev) => prev.filter((s) => s.current));
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.message : 'Could not sign out other sessions.');
    } finally {
      setRevokingOthers(false);
    }
  }

  const otherSessionCount = sessions.filter((s) => !s.current).length;

  return (
    <Screen>
      <SectionHeader eyebrow="Account" title="Your account" subtitle="Contact details, security, and shortcuts." />

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Account details</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Email</Text>
          <Text style={styles.fieldValue}>{user?.email ?? 'Not set'}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Phone</Text>
          <Text style={styles.fieldValue}>{user?.phone ?? 'Not set'}</Text>
        </View>
        <View style={[styles.fieldRow, styles.fieldRowLast]}>
          <Text style={styles.fieldLabel}>Account type</Text>
          <Text style={styles.fieldValue}>{user?.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') ?? '—'}</Text>
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Language</Text>
        <Text style={styles.noteText}>Also controls voice announcements read aloud on this device.</Text>
        <View style={styles.languageRow}>
          {Object.values(Language).map((lang) => (
            <Pressable
              key={lang}
              onPress={() => void changeLanguage(lang)}
              disabled={savingLanguage}
              style={[styles.languagePill, user?.preferredLanguage === lang && styles.languagePillActive]}
            >
              <Text style={[styles.languagePillText, user?.preferredLanguage === lang && styles.languagePillTextActive]}>
                {LANGUAGE_LABELS[lang]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <View style={styles.shortcutGrid}>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('BookingsTab', { screen: 'MyBookings' })}>
          <Text style={styles.shortcutTitle}>My bookings</Text>
        </Pressable>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('QueueTab', { screen: 'QueueHome' })}>
          <Text style={styles.shortcutTitle}>Live queue</Text>
        </Pressable>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('StyleAdvisor')}>
          <Text style={styles.shortcutTitle}>AI Style Advisor</Text>
        </Pressable>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('Notifications')}>
          <Text style={styles.shortcutTitle}>Notifications</Text>
        </Pressable>
        <View style={styles.shortcutCard}>
          <Text style={styles.shortcutTitle}>Premium</Text>
          <Text style={styles.shortcutMeta}>
            {premium === null ? '—' : premium.isPremium ? 'Active' : 'Not subscribed — manage on web'}
          </Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Signed-in devices</Text>
        {sessionsLoading && <ActivityIndicator color={color.muted} style={styles.sessionsLoading} />}
        {!sessionsLoading &&
          sessions.map((session, index) => (
            <View key={session.id} style={[styles.sessionRow, index === sessions.length - 1 && styles.fieldRowLast]}>
              <View style={styles.sessionInfo}>
                <View style={styles.sessionDeviceRow}>
                  <Text style={styles.sessionDevice}>{session.deviceInfo ?? 'Unknown device'}</Text>
                  {session.current && (
                    <View style={styles.currentBadge}>
                      <Text style={styles.currentBadgeText}>This device</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.sessionMeta}>Signed in {new Date(session.createdAt).toLocaleDateString()}</Text>
              </View>
              {!session.current && (
                <Pressable onPress={() => void revokeSession(session.id)} disabled={revokingId === session.id || revokingOthers}>
                  <Text style={styles.revokeText}>{revokingId === session.id ? 'Signing out…' : 'Sign out'}</Text>
                </Pressable>
              )}
            </View>
          ))}
        {!sessionsLoading && sessions.length === 0 && !sessionsError && (
          <Text style={styles.noteText}>No active sessions were returned for this account.</Text>
        )}
        {sessionsError && <InlineError message={sessionsError} />}
        {otherSessionCount > 0 && (
          <Button
            title={revokingOthers ? 'Signing out…' : `Sign out of ${otherSessionCount} other session${otherSessionCount === 1 ? '' : 's'}`}
            variant="outline"
            onPress={() => void revokeOtherSessions()}
            disabled={revokingOthers}
            style={styles.revokeAllButton}
          />
        )}
      </Card>

      <Button title="Log out of this device" variant="secondary" onPress={() => void logout()} style={styles.logoutButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink, marginBottom: space[3] },

  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  fieldRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  fieldLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.muted },
  fieldValue: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },

  languageRow: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  languagePill: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  languagePillActive: { backgroundColor: color.ink, borderColor: color.ink },
  languagePillText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  languagePillTextActive: { color: color.accentContrast },

  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginBottom: space[4] },
  shortcutCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[4],
    minHeight: 64,
    justifyContent: 'center',
  },
  shortcutTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  shortcutMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },

  sessionsLoading: { marginVertical: space[2] },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  sessionInfo: { flex: 1, marginRight: space[3] },
  sessionDeviceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
  sessionDevice: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  currentBadge: { backgroundColor: color.goldSoft, borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 2 },
  currentBadgeText: { fontFamily: font.bodyBold, fontSize: 10, color: color.gold, textTransform: 'uppercase', letterSpacing: 0.5 },
  sessionMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  revokeText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent },
  noteText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted },
  revokeAllButton: { marginTop: space[3] },

  logoutButton: { marginTop: space[2] },
});

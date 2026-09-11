import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AUTH_PATHS,
  LANGUAGE_LABELS,
  Language,
  PREMIUM_PATHS,
  Role,
  type AuthSession,
  type PremiumEntitlementDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { dateLocaleFor } from '../lib/date-locale';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button } from '../components/ui';
import { InlineError } from '../components/ui/ErrorState';
import type { AccountStackParamList, TabParamList } from '../navigation/types';

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
  // Issue 9 (mobile launch mission) — this pill row and the direct pre-auth/Home switcher
  // (components/ui/LanguageSwitcher) both read/write the exact same LanguageProvider state now,
  // so a change here is also what a signed-out visitor's earlier choice already set, and vice
  // versa; setLanguage still calls the identical PATCH auth/language this used to call inline.
  const { t, language, setLanguage } = useLanguage();
  const ROLE_LABELS: Record<string, string> = {
    [Role.CUSTOMER]: t.roleCustomerLabel,
    [Role.SALON_STAFF]: t.roleStaffLabel,
    [Role.SALON_OWNER]: t.roleOwnerLabel,
    [Role.PLATFORM_ADMIN]: t.roleAdminLabel,
  };

  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const [premium, setPremium] = useState<PremiumEntitlementDto | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletionConfirming, setDeletionConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsError(null);
    try {
      const result = await apiFetch<AuthSession[]>(`auth/${AUTH_PATHS.sessions}`);
      setSessions(result);
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.message : t.couldNotLoadSessions);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadPremium = useCallback(() => {
    return apiFetch<PremiumEntitlementDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.me}`)
      .then(setPremium)
      .catch(() => setPremium(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSessions();
      void loadPremium();
    }, [loadSessions, loadPremium]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadSessions(), loadPremium(), refreshMe().catch(() => undefined)]);
    setRefreshing(false);
  }

  async function revokeSession(id: string) {
    setRevokingId(id);
    setSessionsError(null);
    try {
      await apiFetch(`auth/${AUTH_PATHS.sessions}/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setSessionsError(err instanceof ApiError ? err.message : t.couldNotSignOutSession);
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
      setSessionsError(err instanceof ApiError ? err.message : t.couldNotSignOutOtherSessions);
    } finally {
      setRevokingOthers(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeletionError(null);
    try {
      await apiFetch(`auth/${AUTH_PATHS.accountDeletion}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      // The server has already revoked every session and stripped credentials. logout() still
      // clears this device's secure storage even when its best-effort server call is rejected.
      await logout();
    } catch (err) {
      setDeletionError(err instanceof ApiError ? err.message : 'Could not delete your account. Please try again.');
      setDeleting(false);
    }
  }

  async function openPrivacyPolicy() {
    await Linking.openURL('https://fastque.com/privacy-policy');
  }

  const otherSessionCount = sessions.filter((s) => !s.current).length;
  const isCustomerOnly = user?.roles.length === 1 && user.roles[0] === Role.CUSTOMER;

  return (
    <Screen refreshing={refreshing} onRefresh={() => void handleRefresh()}>
      <SectionHeader eyebrow={t.tabAccount} title={t.yourAccount} subtitle={t.contactDetailsSubtitle} />

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t.accountDetailsCard}</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t.email}</Text>
          <Text style={styles.fieldValue}>{user?.email ?? t.notSet}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t.phone}</Text>
          <Text style={styles.fieldValue}>{user?.phone ?? t.notSet}</Text>
        </View>
        <View style={[styles.fieldRow, styles.fieldRowLast]}>
          <Text style={styles.fieldLabel}>{t.accountType}</Text>
          <Text style={styles.fieldValue}>{user?.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') ?? '—'}</Text>
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t.language}</Text>
        <Text style={styles.noteText}>{t.voiceHint}</Text>
        <View style={styles.languageRow}>
          {Object.values(Language).map((lang) => (
            <Pressable
              key={lang}
              onPress={() => setLanguage(lang)}
              style={[styles.languagePill, language === lang && styles.languagePillActive]}
            >
              <Text style={[styles.languagePillText, language === lang && styles.languagePillTextActive]}>
                {LANGUAGE_LABELS[lang]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t.listYourShopCta}</Text>
        <Text style={styles.noteText}>{t.registerShopSubtitle}</Text>
        <Button
          title={t.listYourShopCta}
          variant="outline"
          onPress={() => navigation.navigate('RegisterShop')}
          style={styles.revokeAllButton}
        />
      </Card>

      <View style={styles.shortcutGrid}>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('BookingsTab', { screen: 'MyBookings' })}>
          <Text style={styles.shortcutTitle}>{t.myBookings}</Text>
        </Pressable>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('QueueTab', { screen: 'QueueHome' })}>
          <Text style={styles.shortcutTitle}>{t.liveQueue}</Text>
        </Pressable>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('StyleAdvisor')}>
          <Text style={styles.shortcutTitle}>{t.aiStyleAdvisor}</Text>
        </Pressable>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('Notifications')}>
          <Text style={styles.shortcutTitle}>{t.notifications}</Text>
        </Pressable>
        <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate('CreditsHistory')}>
          <Text style={styles.shortcutTitle}>{t.fastQueCreditsLabel}</Text>
        </Pressable>
        <View style={styles.shortcutCard}>
          <Text style={styles.shortcutTitle}>{t.premiumLabel}</Text>
          <Text style={styles.shortcutMeta}>
            {premium === null ? '—' : premium.isPremium ? t.premiumActive : t.premiumInactive}
          </Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t.signedInDevices}</Text>
        {sessionsLoading && <ActivityIndicator color={color.muted} style={styles.sessionsLoading} />}
        {!sessionsLoading &&
          sessions.map((session, index) => (
            <View key={session.id} style={[styles.sessionRow, index === sessions.length - 1 && styles.fieldRowLast]}>
              <View style={styles.sessionInfo}>
                <View style={styles.sessionDeviceRow}>
                  <Text style={styles.sessionDevice}>{session.deviceInfo ?? t.unknownDevice}</Text>
                  {session.current && (
                    <View style={styles.currentBadge}>
                      <Text style={styles.currentBadgeText}>{t.thisDevice}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.sessionMeta}>{t.signedInOnPrefix}{new Date(session.createdAt).toLocaleDateString(dateLocaleFor(language))}</Text>
              </View>
              {!session.current && (
                <Pressable onPress={() => void revokeSession(session.id)} disabled={revokingId === session.id || revokingOthers}>
                  <Text style={styles.revokeText}>{revokingId === session.id ? t.signingOut : t.signOut}</Text>
                </Pressable>
              )}
            </View>
          ))}
        {!sessionsLoading && sessions.length === 0 && !sessionsError && (
          <Text style={styles.noteText}>{t.noActiveSessions}</Text>
        )}
        {sessionsError && <InlineError message={sessionsError} />}
        {otherSessionCount > 0 && (
          <Button
            title={revokingOthers ? t.signingOut : `${t.signOutOtherSessions} (${otherSessionCount})`}
            variant="outline"
            onPress={() => void revokeOtherSessions()}
            disabled={revokingOthers}
            style={styles.revokeAllButton}
          />
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Privacy</Text>
        <Text style={styles.noteText}>Read how FastQue handles account, booking, location and notification information.</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open FastQue Privacy Policy"
          onPress={() => void openPrivacyPolicy()}
          style={styles.privacyLink}
        >
          <Text style={styles.revokeText}>Open Privacy Policy</Text>
        </Pressable>
      </Card>

      {isCustomerOnly && (
        <Card style={styles.deleteCard}>
          <Text style={styles.cardTitle}>Delete account</Text>
          {!deletionConfirming ? (
            <>
              <Text style={styles.noteText}>
                Permanently remove this account&apos;s sign-in details and revoke active sessions. Some de-identified booking,
                review, credit and security records may be retained where required.
              </Text>
              <Button title="Delete my account" variant="outline" onPress={() => setDeletionConfirming(true)} style={styles.deleteButton} />
            </>
          ) : (
            <>
              <Text style={styles.deleteWarning}>
                This cannot be undone. Your email or phone sign-in and linked Google sign-in will be removed, and active sessions will be revoked.
              </Text>
              {deletionError && <InlineError message={deletionError} />}
              <Button
                title={deleting ? 'Deleting account…' : 'Permanently delete my account'}
                onPress={() => void deleteAccount()}
                disabled={deleting}
                style={styles.deleteButton}
              />
              <Pressable disabled={deleting} onPress={() => { setDeletionConfirming(false); setDeletionError(null); }}>
                <Text style={styles.cancelDeletion}>Keep my account</Text>
              </Pressable>
            </>
          )}
        </Card>
      )}

      <Button title={t.signOutThisDevice} variant="secondary" onPress={() => void logout()} style={styles.logoutButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink, marginBottom: space[3] },
  privacyLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: space[2] },

  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  fieldRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  fieldLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted },
  fieldValue: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },

  languageRow: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  languagePill: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  languagePillActive: { backgroundColor: color.ink, borderColor: color.ink },
  languagePillText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
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
  shortcutTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
  shortcutMeta: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.muted,
    marginTop: space[1],
  },

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
  currentBadge: {
    minHeight: 20,
    justifyContent: 'center',
    backgroundColor: color.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    lineHeight: lineHeightFor(10),
    color: color.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  revokeText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent },
  noteText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted },
  revokeAllButton: { marginTop: space[3] },

  deleteCard: { marginTop: space[2], marginBottom: space[4] },
  deleteButton: { marginTop: space[3] },
  deleteWarning: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.accent, lineHeight: lineHeightFor(fontSize.sm) },
  cancelDeletion: { marginTop: space[3], textAlign: 'center', fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },

  logoutButton: { marginTop: space[2] },
});

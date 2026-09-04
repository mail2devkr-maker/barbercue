import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AUTH_PATHS, Role, type AuthSession, type UiStrings } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { dateLocaleFor } from '../../lib/date-locale';
import { useAuth } from '../../lib/auth-context';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, InlineError, LanguageSwitcher } from '../../components/ui';

function roleLabel(t: UiStrings, role: string): string {
  const labels: Record<string, string> = {
    [Role.CUSTOMER]: t.roleCustomerLabel,
    [Role.SALON_STAFF]: t.roleStaffLabel,
    [Role.SALON_OWNER]: t.roleOwnerLabel,
    [Role.PLATFORM_ADMIN]: t.roleAdminLabel,
  };
  return labels[role] ?? role;
}

// Same read-only auth/me + auth/sessions pattern as the customer AccountScreen — MeResponse and
// the sessions endpoints are role-agnostic, so this is genuinely the same account underneath.
//
// Build 9 physical-device root cause fix: this screen — the ONLY Account surface an owner or
// staff member ever reaches (see DashboardAccountStack) — previously had no language switcher at
// all. The customer-only AccountScreen was the sole place PATCH auth/language was ever reachable,
// so an owner had no durable way to select Hindi; the voice/push code downstream was already
// correctly reading user.preferredLanguage, it just could never become anything but the default.
export default function DashboardAccountScreen() {
  const { user, logout } = useAuth();
  const { t, language } = useLanguage();
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    return apiFetch<AuthSession[]>(`auth/${AUTH_PATHS.sessions}`)
      .then(setSessions)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your sessions.'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function revokeSession(id: string) {
    setRevokingId(id);
    try {
      await apiFetch(`auth/${AUTH_PATHS.sessions}/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign out that session.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void load(true)}>
      <View style={styles.headerRow}>
        <SectionHeader eyebrow={t.tabAccount} title={t.yourAccount} />
        <LanguageSwitcher />
      </View>

      <Card style={styles.card}>
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
          <Text style={styles.fieldValue}>{user?.roles.map((r) => roleLabel(t, r)).join(', ') ?? '—'}</Text>
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t.signedInDevices}</Text>
        {loading && <ActivityIndicator color={color.muted} style={styles.spinner} />}
        {!loading &&
          sessions.map((session) => (
            <View key={session.id} style={styles.sessionRow}>
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionDevice}>
                  {session.deviceInfo ?? t.unknownDevice} {session.current ? `(${t.thisDevice})` : ''}
                </Text>
                <Text style={styles.sessionMeta}>{t.signedInOnPrefix}{new Date(session.createdAt).toLocaleDateString(dateLocaleFor(language))}</Text>
              </View>
              {!session.current && (
                <Pressable onPress={() => void revokeSession(session.id)} disabled={revokingId === session.id}>
                  <Text style={styles.revokeText}>{revokingId === session.id ? t.signingOut : t.signOut}</Text>
                </Pressable>
              )}
            </View>
          ))}
        {error && <InlineError message={error} />}
      </Card>

      <Button title={t.signOutThisDevice} variant="secondary" onPress={() => void logout()} style={styles.logoutButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[2] },
  card: { marginBottom: space[4] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink, marginBottom: space[3] },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: color.border },
  fieldRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  fieldLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.muted },
  fieldValue: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  spinner: { marginVertical: space[2] },
  sessionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: color.border },
  sessionInfo: { flex: 1, marginRight: space[3] },
  sessionDevice: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  sessionMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  revokeText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent },
  logoutButton: { marginTop: space[2] },
});

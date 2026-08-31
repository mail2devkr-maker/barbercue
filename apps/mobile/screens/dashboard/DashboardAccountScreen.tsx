import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { AUTH_PATHS, Role, type AuthSession } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { color, font, fontSize, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, InlineError } from '../../components/ui';
import { getVoiceBookingAnnouncementsEnabled, setVoiceBookingAnnouncementsEnabled } from '../../lib/push-notifications';
import type { DashboardAccountStackParamList } from '../../navigation/types';

const ROLE_LABELS: Record<string, string> = {
  [Role.CUSTOMER]: 'Customer',
  [Role.SALON_STAFF]: 'Salon Staff',
  [Role.SALON_OWNER]: 'Salon Owner',
  [Role.PLATFORM_ADMIN]: 'Platform Admin',
};

// Same read-only auth/me + auth/sessions pattern as the customer AccountScreen — MeResponse and
// the sessions endpoints are role-agnostic, so this is genuinely the same account underneath.
export default function DashboardAccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<DashboardAccountStackParamList, 'DashboardAccount'>>();
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [voiceAnnouncements, setVoiceAnnouncements] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return apiFetch<AuthSession[]>(`auth/${AUTH_PATHS.sessions}`)
      .then(setSessions)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your sessions.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void getVoiceBookingAnnouncementsEnabled().then(setVoiceAnnouncements);
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
    <Screen>
      <SectionHeader eyebrow="Account" title="Your account" />

      <Card style={styles.card}>
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
        <Pressable style={styles.actionRow} onPress={() => navigation.navigate('Notifications')} accessibilityRole="button">
          <View style={styles.actionText}>
            <Text style={styles.cardTitle}>Notifications</Text>
            <Text style={styles.fieldLabel}>Booking, appointment and live queue updates</Text>
          </View>
          <Text style={styles.actionArrow}>›</Text>
        </Pressable>
        <View style={styles.voiceRow}>
          <View style={styles.actionText}>
            <Text style={styles.fieldValue}>Voice booking announcements</Text>
            <Text style={styles.fieldLabel}>Foreground only; never reads customer details aloud.</Text>
          </View>
          <Switch
            value={voiceAnnouncements}
            onValueChange={(enabled) => {
              setVoiceAnnouncements(enabled);
              void setVoiceBookingAnnouncementsEnabled(enabled);
            }}
            trackColor={{ false: color.border, true: color.accentSoft }}
            thumbColor={voiceAnnouncements ? color.accent : color.muted}
            accessibilityLabel="Voice booking announcements"
          />
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Signed-in devices</Text>
        {loading && <ActivityIndicator color={color.muted} style={styles.spinner} />}
        {!loading &&
          sessions.map((session) => (
            <View key={session.id} style={styles.sessionRow}>
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionDevice}>
                  {session.deviceInfo ?? 'Unknown device'} {session.current ? '(this device)' : ''}
                </Text>
                <Text style={styles.sessionMeta}>Signed in {new Date(session.createdAt).toLocaleDateString()}</Text>
              </View>
              {!session.current && (
                <Pressable onPress={() => void revokeSession(session.id)} disabled={revokingId === session.id}>
                  <Text style={styles.revokeText}>{revokingId === session.id ? 'Signing out…' : 'Sign out'}</Text>
                </Pressable>
              )}
            </View>
          ))}
        {error && <InlineError message={error} />}
      </Card>

      <Button title="Log out of this device" variant="secondary" onPress={() => void logout()} style={styles.logoutButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink, marginBottom: space[3] },
  actionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionText: { flex: 1, paddingRight: space[3] },
  actionArrow: { fontFamily: font.bodyRegular, fontSize: 28, color: color.accent },
  voiceRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: color.border, paddingTop: space[3], marginTop: space[3] },
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { EMPLOYEE_PATHS, type EmployeeCrmDashboardDto, type EmployeeProfileDto } from '@barbercue/shared';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AssistantEntry } from '../../components/assistant/AssistantEntry';
import type { EmployeeStackParamList } from '../../navigation/EmployeeNavigator';
import { useLanguage } from '../../lib/language-context';
import { fastQue, font, fontSize, space } from '../../lib/theme';
import { PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader } from '../../components/ui';

const DASHBOARD_PATH = `${EMPLOYEE_PATHS.employee}/${EMPLOYEE_PATHS.dashboard}`;
const EMPLOYEE_ME_PATH = `${EMPLOYEE_PATHS.employee}/${EMPLOYEE_PATHS.me}`;
const EMPLOYEE_PORTAL_URL = 'https://fastque.com/employee/login';

async function fetchEmployeeDashboard(): Promise<EmployeeCrmDashboardDto> {
  const [profile, dashboard] = await Promise.all([
    apiFetch<EmployeeProfileDto>(EMPLOYEE_ME_PATH),
    apiFetch<EmployeeCrmDashboardDto>(DASHBOARD_PATH),
  ]);
  if (profile.id !== dashboard.profile.id || profile.employeeCode !== dashboard.profile.employeeCode) {
    throw new Error('Employee profile and dashboard did not match.');
  }
  return { ...dashboard, profile };
}

export default function EmployeeDashboardScreen() {
  const { logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<EmployeeStackParamList>>();
  const { t } = useLanguage();
  const [dashboard, setDashboard] = useState<EmployeeCrmDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const requestVersion = useRef(0);

  const loadDashboard = useCallback(async (refresh = false) => {
    const requestId = ++requestVersion.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fetchEmployeeDashboard();
      if (requestId === requestVersion.current) setDashboard(result);
    } catch (err) {
      if (requestId === requestVersion.current) {
        setError(err instanceof ApiError ? err.message : t.employeeDashboardUnavailable);
      }
    } finally {
      if (requestId === requestVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void loadDashboard();
    return () => { requestVersion.current += 1; };
  }, [loadDashboard]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void loadDashboard(true)} contentStyle={styles.content}>
      <View style={styles.topRow}>
        <View style={styles.heading}>
          <PremiumSectionHeader eyebrow={t.employeeLoginEyebrow} title={t.employeeDashboardTitle} subtitle={t.employeeDashboardSubtitle} />
        </View>
        <Pressable onPress={() => void handleSignOut()} disabled={signingOut} accessibilityRole="button" accessibilityLabel={t.signOut} style={styles.signOut}>
          <Text style={styles.signOutText}>{signingOut ? '…' : t.signOut}</Text>
        </Pressable>
      </View>

      <AssistantEntry onPress={() => navigation.navigate('Assistant')} />

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {loading && !dashboard ? (
        <View style={styles.loading}><ActivityIndicator color={fastQue.pink} size="large" /><Text style={styles.secondary}>{t.employeeDashboardLoading}</Text></View>
      ) : dashboard ? (
        <>
          <PremiumCard strong>
            <Text style={styles.name}>{dashboard.profile.fullName}</Text>
            <Text style={styles.secondary}>{t.employeeCodeLabel} · {dashboard.profile.employeeCode}</Text>
            {dashboard.profile.territory ? <Text style={styles.secondary}>{t.employeeTerritory} · {dashboard.profile.territory}</Text> : null}
          </PremiumCard>

          <PremiumSectionHeader title={t.employeeActivity} subtitle={t.employeeDashboardSubtitle} />
          <View style={styles.metrics}>
            <Metric label={t.employeeAssignedLeads} value={dashboard.counts.leads} />
            <Metric label={t.employeeShopsOnboarded} value={dashboard.counts.onboarded} />
            <Metric label={t.employeeVisitsLast30Days} value={dashboard.counts.visitsLast30Days} />
            <Metric label={t.employeeOpenFollowUps} value={dashboard.counts.openFollowUps} />
          </View>
          {dashboard.counts.overdueFollowUps > 0 ? (
            <PremiumCard>
              <Text style={styles.overdue}>{dashboard.counts.overdueFollowUps} · {t.employeeOverdueFollowUps}</Text>
            </PremiumCard>
          ) : null}

          <PremiumCard>
            <Text style={styles.cardTitle}>{t.employeeRecentLeads}</Text>
            {dashboard.recentLeads.length ? dashboard.recentLeads.map((lead) => (
              <View key={lead.id} style={styles.listRow}>
                <Text style={styles.primary}>{lead.shopName}</Text>
                <Text style={styles.secondary}>{[lead.city, lead.status.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}</Text>
              </View>
            )) : <Text style={styles.secondary}>{t.employeeNoLeads}</Text>}
          </PremiumCard>

          <PremiumCard>
            <Text style={styles.cardTitle}>{t.employeeUpcomingFollowUps}</Text>
            {dashboard.upcomingFollowUps.length ? dashboard.upcomingFollowUps.map((followUp) => (
              <View key={followUp.id} style={styles.listRow}>
                <Text style={styles.primary}>{followUp.leadShopName}</Text>
                <Text style={styles.secondary}>{new Date(followUp.dueAt).toLocaleString()}</Text>
              </View>
            )) : <Text style={styles.secondary}>{t.employeeNoFollowUps}</Text>}
          </PremiumCard>

          <PremiumCard>
            <Text style={styles.cardTitle}>{t.employeeRecentVisits}</Text>
            {dashboard.recentVisits.length ? dashboard.recentVisits.map((visit) => (
              <View key={visit.id} style={styles.listRow}>
                <Text style={styles.primary}>{visit.shopName}</Text>
                <Text style={styles.secondary}>{new Date(visit.visitedAt).toLocaleDateString()} · {visit.outcome.replace(/_/g, ' ').toLowerCase()}</Text>
              </View>
            )) : <Text style={styles.secondary}>{t.employeeNoVisits}</Text>}
          </PremiumCard>
          <Text style={styles.secondary}>{t.employeePortalHandoff}</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => { void Linking.openURL(EMPLOYEE_PORTAL_URL).catch(() => setError(t.employeeDashboardUnavailable)); }}
            style={styles.portalLink}
          >
            <Text style={styles.portalLinkText}>{t.employeePortalAction}</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.retry}>
          <Text style={styles.secondary}>{t.employeeDashboardUnavailable}</Text>
          <PremiumButton title={t.employeeTryAgain} variant="secondary" onPress={() => void loadDashboard()} />
        </View>
      )}
    </PremiumScreen>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <PremiumCard style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space[4] },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  heading: { flex: 1 },
  signOut: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[2] },
  signOutText: { color: fastQue.pink, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  portalLink: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  portalLinkText: { color: fastQue.pink, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  name: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg, marginBottom: space[1] },
  secondary: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 22 },
  primary: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  metric: { flexBasis: '47%', flexGrow: 1, minHeight: 94, justifyContent: 'center' },
  metricValue: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.xl },
  metricLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[1] },
  cardTitle: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: fontSize.base, marginBottom: space[2] },
  listRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border, paddingVertical: space[3] },
  overdue: { color: fastQue.warning, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  error: { color: fastQue.error, fontFamily: font.bodyMedium, fontSize: fontSize.sm, marginBottom: space[3] },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: space[3] },
  retry: { gap: space[3], marginTop: space[4] },
});

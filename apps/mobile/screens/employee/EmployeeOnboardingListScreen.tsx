import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  EMPLOYEE_PATHS,
  ONBOARDING_BUCKET_LABELS,
  ONBOARDING_STATUS_LABELS,
  type OnboardingApplicationDto,
  type OnboardingBucket,
  type OnboardingCountsDto,
  type OnboardingListItemDto,
} from '@barbercue/shared';
import { ApiError, apiFetch } from '../../lib/api';
import { EMPLOYEE_ONBOARDING } from '../../lib/onboarding';
import { PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, PremiumTextField } from '../../components/ui';
import { font, fontSize, radius, space } from '../../lib/theme';
import { useThemedStyles, type ThemeTokens } from '../../lib/theme-mode';
import type { EmployeeStackParamList } from '../../navigation/EmployeeNavigator';

const BUCKETS = Object.keys(ONBOARDING_BUCKET_LABELS) as OnboardingBucket[];

/** Website parity: apps/web/components/onboarding/EmployeeOnboardingTab.tsx + onboarding/new. */
export default function EmployeeOnboardingListScreen() {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<EmployeeStackParamList>>();
  const [bucket, setBucket] = useState<OnboardingBucket>('drafts');
  const [counts, setCounts] = useState<OnboardingCountsDto | null>(null);
  const [items, setItems] = useState<OnboardingListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [salonName, setSalonName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const [nextCounts, nextItems] = await Promise.all([
        apiFetch<OnboardingCountsDto>(`${EMPLOYEE_ONBOARDING}/${EMPLOYEE_PATHS.counts}`),
        apiFetch<OnboardingListItemDto[]>(`${EMPLOYEE_ONBOARDING}?bucket=${bucket}`),
      ]);
      setCounts(nextCounts);
      setItems(nextItems);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load onboarding applications.');
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, [bucket]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);
  // Coming back from the wizard: refresh counts and status.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<OnboardingApplicationDto>(EMPLOYEE_ONBOARDING, {
        method: 'POST',
        body: JSON.stringify({
          salonName,
          ...(ownerName.trim() ? { ownerName } : {}),
          ...(ownerPhone.trim() ? { ownerPhone } : {}),
        }),
      });
      setCreating(false);
      setSalonName('');
      setOwnerName('');
      setOwnerPhone('');
      navigation.navigate('EmployeeOnboardingWizard', { applicationId: created.id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the application.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(true)} contentStyle={styles.content}>
      <PremiumSectionHeader title="Salon Onboarding" subtitle="Fill in a salon's details in steps and submit them for review." />
      {creating ? (
        <PremiumCard>
          <Text style={styles.cardTitle}>New salon onboarding</Text>
          <Text style={styles.hint}>Starts a draft you can finish in steps. A CRM lead is created for you.</Text>
          <Text style={styles.label}>Salon name *</Text>
          <PremiumTextField value={salonName} onChangeText={setSalonName} maxLength={160} accessibilityLabel="Salon name" />
          <Text style={styles.label}>Owner&apos;s name</Text>
          <PremiumTextField value={ownerName} onChangeText={setOwnerName} accessibilityLabel="Owner's name" />
          <Text style={styles.label}>Owner&apos;s mobile</Text>
          <PremiumTextField value={ownerPhone} onChangeText={setOwnerPhone} keyboardType="phone-pad" placeholder="10-digit mobile" accessibilityLabel="Owner's mobile" />
          <View style={styles.row}>
            <PremiumButton title="Start onboarding" onPress={() => void start()} loading={busy} disabled={!salonName.trim()} style={styles.flex} />
            <PremiumButton title="Cancel" variant="secondary" onPress={() => setCreating(false)} style={styles.flex} />
          </View>
        </PremiumCard>
      ) : (
        <PremiumButton title="+ New onboarding" onPress={() => setCreating(true)} />
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {BUCKETS.map((b) => (
          <Pressable key={b} accessibilityRole="tab" accessibilityState={{ selected: bucket === b }} onPress={() => setBucket(b)} style={[styles.tab, bucket === b && styles.tabActive]}>
            <Text style={[styles.tabText, bucket === b && styles.tabTextActive]}>
              {ONBOARDING_BUCKET_LABELS[b]} · {counts ? counts[b] : '…'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {items === null ? <Text style={styles.hint}>Loading…</Text> : null}
      {items !== null && items.length === 0 && !error ? (
        <Text style={styles.hint}>
          {bucket === 'drafts' ? 'No drafts. Start a new onboarding above.' : `Nothing in ${ONBOARDING_BUCKET_LABELS[bucket]}.`}
        </Text>
      ) : null}
      {(items ?? []).map((item) => (
        <Pressable key={item.id} accessibilityRole="button" onPress={() => navigation.navigate('EmployeeOnboardingWizard', { applicationId: item.id })}>
          <PremiumCard style={styles.item}>
            <Text style={styles.cardTitle}>{item.salonName}</Text>
            <Text style={styles.hint}>
              {item.reference} · {[item.locality, item.city].filter(Boolean).join(', ') || 'No address yet'}
            </Text>
            <Text style={item.status === 'CHANGES_REQUESTED' || item.status === 'REJECTED' ? styles.warn : styles.badge}>
              {ONBOARDING_STATUS_LABELS[item.status]}
            </Text>
            <Text style={styles.hint}>
              {item.serviceCount} services · {item.photoCount} photos
              {item.missingCount > 0 && ['DRAFT', 'CHANGES_REQUESTED'].includes(item.status) ? ` · ${item.missingCount} to complete` : ''}
            </Text>
          </PremiumCard>
        </Pressable>
      ))}
    </PremiumScreen>
  );
}

const makeStyles = ({ fastQue }: ThemeTokens) => StyleSheet.create({
  content: { paddingHorizontal: space[4], gap: space[3] },
  cardTitle: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: fontSize.base, marginBottom: space[1] },
  label: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, marginTop: space[3], marginBottom: space[1] },
  hint: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 20 },
  error: { color: fastQue.error, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  row: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  flex: { flex: 1 },
  tabs: { gap: space[2], paddingVertical: space[2] },
  tab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border },
  tabActive: { borderColor: fastQue.pink, backgroundColor: fastQue.glassStrong },
  tabText: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  tabTextActive: { color: fastQue.text, fontFamily: font.bodySemiBold },
  item: { gap: space[1] },
  badge: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  warn: { color: fastQue.warning, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
});

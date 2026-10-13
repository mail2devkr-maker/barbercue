import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  SHOP_CLOSED_TODAY_MESSAGE,
  SalonSetupErrorCode,
  SalonStatus,
  type SalonStatusResultDto,
  type SalonSetupReadinessDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useUnreadNotificationCount } from '../../lib/notifications';
import { useLanguage } from '../../lib/language-context';
import { fastQue, font, fontSize, lineHeightFor, premiumShadow, radius, space } from '../../lib/theme';
import { EmptyState, Skeleton, InlineError, NotificationBell, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader } from '../../components/ui';
import { OwnerOverviewPanel, type OwnerOverviewActions } from '../../components/owner/OwnerOverviewPanel';
import type { OwnerTabParamList } from '../../navigation/OwnerNavigator';

// Salon status is read from SalonWorkplaceDto (via useSalon) rather than re-fetched here — the
// workplaces list already carries it, and PATCH .../status returns the fresh value which this
// screen applies locally, matching the pattern the rest of the app uses (no redundant re-fetch).
export default function OwnerDashboardScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<OwnerTabParamList>>();
  const { workplaces, loading, error, selectedSalonId, selectedSalon, selectSalon, reload } = useSalon();
  const [status, setStatus] = useState<string | null>(null);
  const [closedForToday, setClosedForToday] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<SalonSetupReadinessDto | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const overviewRefresh = useRef<(() => Promise<void>) | null>(null);
  const unreadCount = useUnreadNotificationCount();
  const { t } = useLanguage();

  useFocusEffect(
    useCallback(() => {
      setStatus(selectedSalon?.status ?? null);
      setClosedForToday(selectedSalon?.isClosedForToday ?? false);
      setReadiness(null);
      setActionError(null);
    }, [selectedSalon]),
  );

  const registerRefresh = useCallback((refresh: (() => Promise<void>) | null) => {
    overviewRefresh.current = refresh;
  }, []);

  // Pull-to-refresh reloads the workplaces/status and the overview figures together.
  async function handleRefresh() {
    setRefreshing(true);
    reload();
    await overviewRefresh.current?.();
    setRefreshing(false);
  }

  async function toggleStatus(next: 'ACTIVE' | 'SUSPENDED') {
    if (!selectedSalonId) return;
    setUpdating(true);
    setActionError(null);
    setReadiness(null);
    try {
      const result = await apiFetch<SalonStatusResultDto>(
        `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${selectedSalonId}/${DASHBOARD_PATHS.status}`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) },
      );
      setStatus(result.status);
      setClosedForToday(result.isClosedForToday ?? false);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === SalonSetupErrorCode.SALON_SETUP_INCOMPLETE) {
        setReadiness((err.details as SalonSetupReadinessDto | undefined) ?? null);
        setActionError(err.message);
      } else {
        setActionError(err instanceof ApiError ? err.message : 'Could not update shop status.');
      }
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <PremiumScreen>
        <Skeleton style={styles.skeleton} />
      </PremiumScreen>
    );
  }
  if (error) {
    return (
      <PremiumScreen scroll={false}>
        <InlineError message={error} />
      </PremiumScreen>
    );
  }
  if (workplaces.length === 0) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.noShopsYetTitle} message={t.registerShopHint} />
      </PremiumScreen>
    );
  }

  const actions: OwnerOverviewActions = {
    onNewQueueCustomer: () => navigation.navigate('OwnerQueueTab', { newCustomer: true }),
    onNewAppointment: () => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerInShopAppointment' }),
    onOpenQueue: () => navigation.navigate('OwnerQueueTab'),
    onOpenBookings: () => navigation.navigate('OwnerBookingsTab', undefined),
    onOpenInvoices: () => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerInvoices' }),
    onOpenCancellations: () => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerCancellations' }),
    onOpenStaff: () => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerStaff' }),
    onOpenAnalytics: () => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerAnalytics' }),
  };

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void handleRefresh()}>
      <View style={styles.headerRow}>
        <PremiumSectionHeader eyebrow={t.ownerEyebrow} title={t.dashboardTitle} />
        <NotificationBell
          unreadCount={unreadCount}
          onPress={() => navigation.navigate('OwnerAccountTab', { screen: 'Notifications' })}
        />
      </View>

      {workplaces.length > 1 && (
        <View style={styles.pickerRow}>
          {workplaces.map((w) => (
            <Pressable
              key={w.id}
              style={[styles.pickerChip, w.id === selectedSalonId && styles.pickerChipActive]}
              onPress={() => selectSalon(w.id)}
            >
              <Text style={[styles.pickerChipText, w.id === selectedSalonId && styles.pickerChipTextActive]}>{w.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {workplaces.length > 1 && !selectedSalonId && (
        <EmptyState title={t.selectShopTitle} message={t.pickShopToContinueHint} />
      )}

      {selectedSalon && (
        <PremiumCard strong style={styles.card}>
          <Text style={styles.salonName}>{selectedSalon.name}</Text>
          <Text style={styles.salonStatus}>
            {t.statusPrefix}{closedForToday ? SHOP_CLOSED_TODAY_MESSAGE : status ?? selectedSalon.status}
          </Text>

          {actionError && <InlineError message={actionError} />}
          {readiness && (
            <View style={styles.readinessList}>
              <Text style={styles.readinessItem}>{readiness.hasActiveService ? '✓' : '○'} {t.activeService}</Text>
              <Text style={styles.readinessItem}>{readiness.hasActiveChair ? '✓' : '○'} {t.activeChair}</Text>
              <Text style={styles.readinessItem}>{readiness.hasActiveStaff ? '✓' : '○'} {t.activeBarber}</Text>
            </View>
          )}

          {(status ?? selectedSalon.status) === SalonStatus.ACTIVE && !closedForToday ? (
            <PremiumButton title={t.closeShop} variant="secondary" onPress={() => void toggleStatus('SUSPENDED')} loading={updating} style={styles.actionButton} />
          ) : (
            <PremiumButton title={t.openShop} onPress={() => void toggleStatus('ACTIVE')} loading={updating} style={styles.actionButton} />
          )}
        </PremiumCard>
      )}

      {selectedSalonId && (
        <OwnerOverviewPanel salonId={selectedSalonId} actions={actions} registerRefresh={registerRefresh} />
      )}

      <View style={styles.quickLinks}>
        <Pressable style={styles.quickLink} onPress={actions.onOpenBookings}>
          <Text style={styles.quickLinkText}>{t.tabBookings}</Text>
        </Pressable>
        <Pressable style={styles.quickLink} onPress={actions.onOpenQueue}>
          <Text style={styles.quickLinkText}>{t.liveQueue}</Text>
        </Pressable>
        <Pressable testID="dashboard-link-analytics" style={styles.quickLink} onPress={actions.onOpenAnalytics}>
          <Text style={styles.quickLinkText}>{t.ownerSectionAnalytics}</Text>
        </Pressable>
        <Pressable testID="dashboard-link-settings" style={styles.quickLink} onPress={() => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerSettings' })}>
          <Text style={styles.quickLinkText}>{t.ownerSectionSettings}</Text>
        </Pressable>
        <Pressable testID="dashboard-link-reviews" style={styles.quickLink} onPress={() => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerReviews' })}>
          <Text style={styles.quickLinkText}>{t.ownerSectionReviews}</Text>
        </Pressable>
        <Pressable testID="dashboard-link-manage" style={styles.quickLink} onPress={() => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerShop' })}>
          <Text style={styles.quickLinkText}>{t.manageShop}</Text>
        </Pressable>
      </View>
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[2] },
  skeleton: { height: 140, borderRadius: radius.lg },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  pickerChip: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: fastQue.border,
  },
  pickerChipActive: { borderColor: fastQue.borderStrong, backgroundColor: 'rgba(242,41,125,0.14)' },
  pickerChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted },
  pickerChipTextActive: { color: fastQue.pink },
  card: { marginBottom: space[4] },
  salonName: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
  salonStatus: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.textSecondary, marginTop: space[1], marginBottom: space[3] },
  readinessList: { marginBottom: space[3] },
  readinessItem: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textSecondary, marginBottom: 2 },
  actionButton: { marginTop: space[1] },
  quickLinks: { gap: space[2] },
  quickLink: { backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.sm, padding: space[4], ...premiumShadow },
  quickLinkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
});

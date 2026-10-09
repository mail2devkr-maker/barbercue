import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  DISCOVERY_PATHS,
  type RegisterSalonResultDto,
  type SalonChairDto,
  type SalonPaymentQrDto,
  type SalonServiceDto,
  type SalonSetupReadinessDto,
  type SalonStaffDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { computeReadiness, statusLabel } from '../../lib/owner/settings';
import { fastQue, font, fontSize, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import { PaymentQrSection, scope } from '../../components/owner/ShopSetupSections';
import { OwnerVoiceSettingsCard } from '../../components/owner/OwnerVoiceSettingsCard';
import { SalonSwitcher } from '../../components/owner/SalonSwitcher';
import { ProfileSection, QueueQrSection, ShopStatusSection, TimezoneSection } from '../../components/owner/SettingsSections';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

/**
 * Native Shop Settings — the website's Settings page: identity (shop ID, status, page address),
 * profile, payment QR, setup readiness + open/close, time zone, voice alerts and the queue QR. All
 * of it uses the website's own endpoints and rules; opening a shop is still refused by the server
 * until its readiness gate passes, and the screen shows exactly what is missing.
 */
export default function OwnerSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OwnerShopStackParamList>>();
  const { selectedSalonId, selectedSalon, reload } = useSalon();
  const { t } = useLanguage();
  const [salon, setSalon] = useState<RegisterSalonResultDto | null>(null);
  const [readiness, setReadiness] = useState<SalonSetupReadinessDto | null>(null);
  const [paymentQr, setPaymentQr] = useState<SalonPaymentQrDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (salonId: string, isRefresh: boolean) => {
      const request = ++requestRef.current;
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const [detail, services, chairs, staff, qr] = await Promise.all([
          apiFetch<RegisterSalonResultDto>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.mine}/${encodeURIComponent(salonId)}`),
          apiFetch<SalonServiceDto[]>(scope(salonId, DASHBOARD_PATHS.services)),
          apiFetch<SalonChairDto[]>(scope(salonId, DASHBOARD_PATHS.chairs)),
          apiFetch<SalonStaffDto[]>(scope(salonId, DASHBOARD_PATHS.staff)),
          apiFetch<SalonPaymentQrDto>(scope(salonId, DASHBOARD_PATHS.paymentQr)).catch(() => null),
        ]);
        if (request !== requestRef.current) return;
        setSalon(detail);
        setReadiness(computeReadiness(services, chairs, staff));
        setPaymentQr(qr);
      } catch (err) {
        if (request !== requestRef.current) return;
        setError(err instanceof ApiError ? err.message : t.settingsLoadFailed);
      } finally {
        if (request === requestRef.current) setRefreshing(false);
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      // Never show one shop's settings while another's load.
      setSalon(null);
      setReadiness(null);
      setPaymentQr(null);
      if (selectedSalonId) void load(selectedSalonId, false);
      else requestRef.current += 1;
    }, [selectedSalonId, load]),
  );

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </PremiumScreen>
    );
  }

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(selectedSalonId, true)}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name ?? t.ownerEyebrow} title={t.settingsTitle} />
      <SalonSwitcher />
      {error ? <InlineError message={error} /> : null}
      {!salon && !error ? <Skeleton style={styles.skeleton} /> : null}

      {salon ? (
        <>
          <PremiumCard strong style={styles.identity} testID="settings-identity">
            <Row label={t.settingsShopId} value={salon.publicId} mono testID="settings-public-id" />
            <Row label={t.settingsStatus} value={statusLabel(salon.status, Boolean(salon.isClosedForToday), t)} testID="settings-status-label" />
            <Row label={t.settingsPageAddress} value={`/book/${salon.slug}`} />
          </PremiumCard>

          <ProfileSection salonId={selectedSalonId} onSaved={() => reload()} />
          <PaymentQrSection salonId={selectedSalonId} paymentQr={paymentQr} onChanged={() => void load(selectedSalonId, false)} />
          <ShopStatusSection
            salonId={selectedSalonId}
            salon={salon}
            readiness={readiness}
            onChanged={(next) => {
              setSalon((previous) => (previous ? { ...previous, status: next.status, isClosedForToday: next.isClosedForToday } : previous));
              reload();
            }}
            onContinueSetup={() => navigation.navigate('OwnerServices')}
          />
          <TimezoneSection salonId={selectedSalonId} />
          <OwnerVoiceSettingsCard />
          <QueueQrSection salonId={selectedSalonId} salonName={salon.name} />
        </>
      ) : null}
    </PremiumScreen>
  );
}

function Row({ label, value, mono, testID }: { label: string; value: string; mono?: boolean; testID?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text testID={testID} style={[styles.rowValue, mono && styles.mono]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 120, borderRadius: 16 },
  identity: { marginBottom: space[4], gap: space[2] },
  row: { marginBottom: space[1] },
  rowLabel: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: fastQue.textMuted },
  rowValue: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: fastQue.text },
  mono: { fontFamily: 'monospace' },
});

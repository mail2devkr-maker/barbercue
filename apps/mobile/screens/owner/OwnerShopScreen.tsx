import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native';
import {
  DASHBOARD_PATHS,
  type OperatingHoursDto,
  type PhotoDto,
  type SalonChairDto,
  type SalonPaymentQrDto,
  type SalonStaffDto,
  type ServiceDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';
import {
  scope,
  ServiceRow,
  AddServiceForm,
  ChairRow,
  AddChairForm,
  AddStaffForm,
  HoursEditor,
  PhotosSection,
  PaymentQrSection,
  styles as sectionStyles,
} from '../../components/owner/ShopSetupSections';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

// Owner's day-to-day shop management (post-onboarding). Every form here is shared with
// OwnerOnboardingScreen (Mobile Shop Owner Onboarding mission) via ShopSetupSections — this
// screen only composes them for an already-established shop, it does not own their logic.
export default function OwnerShopScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OwnerShopStackParamList>>();
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [chairs, setChairs] = useState<SalonChairDto[]>([]);
  const [staff, setStaff] = useState<SalonStaffDto[]>([]);
  const [hours, setHours] = useState<OperatingHoursDto[]>([]);
  const [photos, setPhotos] = useState<PhotoDto[]>([]);
  const [paymentQr, setPaymentQr] = useState<SalonPaymentQrDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((isRefresh = false) => {
    if (!selectedSalonId) return Promise.resolve();
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    return Promise.all([
      apiFetch<ServiceDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.services)),
      apiFetch<SalonChairDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.chairs)),
      apiFetch<SalonStaffDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.staff)),
      apiFetch<OperatingHoursDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.operatingHours)),
      apiFetch<PhotoDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.photos)),
      apiFetch<SalonPaymentQrDto>(scope(selectedSalonId, DASHBOARD_PATHS.paymentQr)),
    ])
      .then(([s, c, st, h, p, qr]) => {
        setServices(s);
        setChairs(c);
        setStaff(st);
        setHours(h);
        setPhotos(p);
        setPaymentQr(qr);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your shop.'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [selectedSalonId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </Screen>
    );
  }
  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false}>
        <InlineError message={error} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screenContent} refreshing={refreshing} onRefresh={() => void load(true)}>
      <SectionHeader eyebrow={t.ownerEyebrow} title={selectedSalon?.name ?? t.tabShop} subtitle={t.shopSubtitle} />

      <Text style={sectionStyles.sectionTitle}>{t.servicesLabel}</Text>
      <Card style={sectionStyles.card}>
        {services.length === 0 ? (
          <Text style={sectionStyles.emptyText}>{t.noServicesYet}</Text>
        ) : (
          services.map((s) => <ServiceRow key={s.id} salonId={selectedSalonId} service={s} onChanged={() => void load()} />)
        )}
      </Card>
      <AddServiceForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={sectionStyles.sectionTitle}>{t.chairsLabel}</Text>
      <Card style={sectionStyles.card}>
        {chairs.length === 0 ? (
          <Text style={sectionStyles.emptyText}>{t.noChairsYet}</Text>
        ) : (
          chairs.map((c) => <ChairRow key={c.id} salonId={selectedSalonId} chair={c} onChanged={() => void load()} />)
        )}
      </Card>
      <AddChairForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={sectionStyles.sectionTitle}>{t.staffLabel}</Text>
      <Card style={sectionStyles.card}>
        {staff.length === 0 ? (
          <Text style={sectionStyles.emptyText}>{t.noBarbersYet}</Text>
        ) : (
          staff.map((member) => (
            <View key={member.id} style={sectionStyles.row}>
              <View style={sectionStyles.rowBody}>
                <Text style={sectionStyles.rowTitle}>{member.displayName}</Text>
                <Text style={sectionStyles.rowMeta}>
                  {member.status} {member.hasPassword ? '' : t.invitePendingSuffix}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>
      <AddStaffForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={sectionStyles.sectionTitle}>{t.hoursLabel}</Text>
      <Card style={sectionStyles.card}>
        <HoursEditor salonId={selectedSalonId} hours={hours} onSaved={setHours} />
      </Card>

      <PhotosSection salonId={selectedSalonId} photos={photos} onChanged={() => void load()} />

      <PaymentQrSection salonId={selectedSalonId} paymentQr={paymentQr} onChanged={() => void load()} />

      <Text style={sectionStyles.sectionTitle}>{t.customersLabel}</Text>
      <Text style={sectionStyles.hint}>{t.customersHint}</Text>
      <Button title={t.viewCustomers} variant="outline" onPress={() => navigation.navigate('OwnerCustomers')} style={sectionStyles.addButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeleton: { height: 100, borderRadius: radius.lg, marginBottom: space[3] },
});

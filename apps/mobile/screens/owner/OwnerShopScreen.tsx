import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  type OperatingHoursDto,
  type PhotoDto,
  type SalonChairDto,
  type SalonPaymentQrDto,
  type SalonServiceCategoryDto,
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
  EditStaffProfile,
  styles as sectionStyles,
} from '../../components/owner/ShopSetupSections';
import { StaffWorkingHoursEditor } from '../../components/owner/StaffWorkingHoursEditor';
import { canPermanentlyDelete, StaffManageActions } from '../../components/owner/StaffAdmin';
import { ChairBulkRemoval, ChairDeleteAction } from '../../components/owner/ChairTools';
import { ShopLocationPanel } from '../../components/owner/ShopLocationPanel';
import { ServiceCategoryManager } from '../../components/owner/ServiceCategoryManager';
import { useAuth } from '../../lib/auth-context';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

// Owner's day-to-day shop management (post-onboarding). Every form here is shared with
// OwnerOnboardingScreen (Mobile Shop Owner Onboarding mission) via ShopSetupSections — this
// screen only composes them for an already-established shop, it does not own their logic.
export default function OwnerShopScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OwnerShopStackParamList>>();
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t, language } = useLanguage();
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [serviceCategories, setServiceCategories] = useState<SalonServiceCategoryDto[]>([]);
  const [chairs, setChairs] = useState<SalonChairDto[]>([]);
  const [staff, setStaff] = useState<SalonStaffDto[]>([]);
  const [hours, setHours] = useState<OperatingHoursDto[]>([]);
  const [photos, setPhotos] = useState<PhotoDto[]>([]);
  const [paymentQr, setPaymentQr] = useState<SalonPaymentQrDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffNotice, setStaffNotice] = useState<string | null>(null);
  const [showLocation, setShowLocation] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const { user } = useAuth();
  const mayDelete = canPermanentlyDelete(user?.roles);

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
      apiFetch<SalonServiceCategoryDto[]>(scope(selectedSalonId, 'service-categories')).catch((): SalonServiceCategoryDto[] => []),
    ])
      .then(([s, c, st, h, p, qr, taxonomy]) => {
        setServices(s);
        setServiceCategories(Array.isArray(taxonomy) ? taxonomy : []);
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

      <Button
        title="Business reports and tools"
        variant="secondary"
        onPress={() => navigation.navigate('OwnerBusiness')}
        style={sectionStyles.addButton}
      />
      <Button
        title={language === 'HI' ? 'दुकान की सेटिंग' : 'Shop settings'}
        variant="outline"
        onPress={() => navigation.navigate('OwnerSettings')}
        style={sectionStyles.addButton}
      />

      <Text style={sectionStyles.sectionTitle}>{language === Language.HI ? 'इन्वेंटरी' : 'Inventory'}</Text>
      <Text style={sectionStyles.hint}>{language === Language.HI ? 'इस दुकान का स्टॉक और कम-स्टॉक उत्पाद प्रबंधित करें।' : 'Track stock, low-stock products, purchases and adjustments for this shop.'}</Text>
      <Button title={language === Language.HI ? 'इन्वेंटरी प्रबंधित करें' : 'Manage inventory'} variant="outline" onPress={() => navigation.navigate('OwnerInventory')} style={sectionStyles.addButton} />

      <Text style={sectionStyles.sectionTitle}>{t.servicesLabel}</Text>
      <Card style={sectionStyles.card}>
        {services.length === 0 ? (
          <Text style={sectionStyles.emptyText}>{t.noServicesYet}</Text>
        ) : (
          services.map((s) => <ServiceRow key={s.id} salonId={selectedSalonId} service={s} categories={serviceCategories} onChanged={() => void load()} />)
        )}
      </Card>
      <AddServiceForm salonId={selectedSalonId} categories={serviceCategories} onAdded={() => void load()} />
      <Button title={showCategories ? (language === Language.HI ? 'श्रेणियाँ छिपाएँ' : 'Hide categories') : (language === Language.HI ? 'सेवा श्रेणियाँ प्रबंधित करें' : 'Manage service categories')} variant="outline" onPress={() => setShowCategories(!showCategories)} style={sectionStyles.addButton} />
      {showCategories && <Card style={sectionStyles.card}><ServiceCategoryManager salonId={selectedSalonId} onChanged={() => void load()} /></Card>}

      <Text style={sectionStyles.sectionTitle}>{t.chairsLabel}</Text>
      <Card style={sectionStyles.card}>
        {chairs.length === 0 ? (
          <Text style={sectionStyles.emptyText}>{t.noChairsYet}</Text>
        ) : (
          chairs.map((c) => (
            <View key={c.id}>
              <ChairRow salonId={selectedSalonId} chair={c} onChanged={() => void load()} />
              {mayDelete && <ChairDeleteAction salonId={selectedSalonId} chair={c} language={language} onDeleted={() => { setStaffNotice(language === Language.HI ? `${c.label} स्थायी रूप से हटाई गई।` : `${c.label} was permanently deleted.`); void load(); }} />}
            </View>
          ))
        )}
        <ChairBulkRemoval salonId={selectedSalonId} chairs={chairs} language={language} onChanged={() => void load()} />
      </Card>
      <AddChairForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={sectionStyles.sectionTitle}>{t.staffLabel}</Text>
      {staffNotice && <Text style={sectionStyles.hint}>{staffNotice}</Text>}
      <Card style={sectionStyles.card}>
        {staff.length === 0 ? (
          <Text style={sectionStyles.emptyText}>{t.noBarbersYet}</Text>
        ) : (
          staff.map((member) => (
            <View key={member.id}>
              <View style={sectionStyles.row}>
                <View style={sectionStyles.rowBody}>
                  <Text style={sectionStyles.rowTitle}>{member.displayName}</Text>
                  <Text style={sectionStyles.rowMeta}>
                    {member.status} {member.hasPassword ? '' : t.invitePendingSuffix}
                  </Text>
                  {member.bio ? <Text style={sectionStyles.rowMeta}>{member.bio}</Text> : null}
                </View>
              </View>
              <StaffManageActions salonId={selectedSalonId} member={member} language={language} canDelete={mayDelete} onChanged={(m) => { setStaffNotice(m); void load(); }} />
              <EditStaffProfile salonId={selectedSalonId} staff={member} onSaved={() => void load()} />
              <StaffWorkingHoursEditor salonId={selectedSalonId} staffId={member.id} />
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

      <Text style={sectionStyles.sectionTitle}>{language === Language.HI ? 'नक्शे पर दुकान का स्थान' : 'Shop location on the map'}</Text>
      <Button title={showLocation ? (language === Language.HI ? 'छिपाएँ' : 'Hide') : (language === Language.HI ? 'स्थान देखें / प्रस्तावित करें' : 'View or propose location')} variant="outline" onPress={() => setShowLocation(!showLocation)} style={sectionStyles.addButton} />
      {showLocation && <ShopLocationPanel salonId={selectedSalonId} language={language} />}

      <Text style={sectionStyles.sectionTitle}>{language === Language.HI ? 'दुकान का QR पोस्टर' : 'Public shop QR poster'}</Text>
      <Text style={sectionStyles.hint}>
        {language === Language.HI
          ? 'अपनी दुकान के सार्वजनिक FastQue पेज का QR पूर्वावलोकन करें या लिंक साझा करें।'
          : 'Preview the QR and share your shop’s canonical public FastQue link.'}
      </Text>
      <Button
        title={language === Language.HI ? 'QR पोस्टर खोलें' : 'Open QR poster'}
        variant="outline"
        onPress={() => navigation.navigate('OwnerQrPoster')}
        style={sectionStyles.addButton}
      />

      <PaymentQrSection salonId={selectedSalonId} paymentQr={paymentQr} onChanged={() => void load()} />

      <Text style={sectionStyles.sectionTitle}>{t.customersLabel}</Text>
      <Text style={sectionStyles.hint}>{t.customersHint}</Text>
      <Button title={t.viewCustomers} variant="outline" onPress={() => navigation.navigate('OwnerCustomers')} style={sectionStyles.addButton} />

      <Text style={sectionStyles.sectionTitle}>Billing</Text>
      <Text style={sectionStyles.hint}>Review issued invoices and payment records. Payments are never inferred from a QR code.</Text>
      <Button title="Shop invoices" variant="outline" onPress={() => navigation.navigate('OwnerBusiness', { initialPanel: 'invoices' })} style={sectionStyles.addButton} />

      <Text style={sectionStyles.sectionTitle}>{language === 'HI' ? 'ऑफ़र और प्रचार' : 'Offers & promotions'}</Text>
      <Text style={sectionStyles.hint}>{language === 'HI' ? 'ऑनलाइन बुकिंग के लिए ड्राफ़्ट, दैनिक डील और प्रकाशित ऑफ़र प्रबंधित करें।' : 'Create drafts, daily deals and published offers for online bookings.'}</Text>
      <Button title={language === 'HI' ? 'ऑफ़र प्रबंधित करें' : 'Manage offers'} variant="outline" onPress={() => navigation.navigate('OwnerBusiness', { initialPanel: 'offers' })} style={sectionStyles.addButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeleton: { height: 100, borderRadius: radius.lg, marginBottom: space[3] },
});


import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  type OperatingHoursDto,
  type PhotoDto,
  type SalonChairDto,
  type SalonStaffDto,
  type ServiceDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { radius, space } from '../../lib/theme';
import { Card, EmptyState, InlineError, Skeleton } from '../../components/ui';
import { PremiumScreen, PremiumSectionHeader } from '../../components/ui';
import {
  AddChairForm,
  AddServiceForm,
  AddStaffForm,
  ChairRow,
  HoursEditor,
  PhotosSection,
  ServiceRow,
  scope,
  styles as sectionStyles,
} from '../../components/owner/ShopSetupSections';
import { SalonSwitcher } from '../../components/owner/SalonSwitcher';

type SectionKind = 'services' | 'chairs' | 'staff' | 'hours' | 'photos';

const RESOURCE: Record<SectionKind, string> = {
  services: DASHBOARD_PATHS.services,
  chairs: DASHBOARD_PATHS.chairs,
  staff: DASHBOARD_PATHS.staff,
  hours: DASHBOARD_PATHS.operatingHours,
  photos: DASHBOARD_PATHS.photos,
};

/**
 * One management section of the owner's shop, on its own screen. Each reuses the very same forms
 * the onboarding wizard and the old combined Shop screen used (ShopSetupSections), so add / edit /
 * deactivate behave exactly as before — this only gives every section a discoverable home and loads
 * just the one resource it needs, for the currently selected shop.
 */
function OwnerShopSectionScreen({ kind }: { kind: SectionKind }) {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  const [data, setData] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (salonId: string, isRefresh: boolean) => {
      const request = ++requestRef.current;
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const result = await apiFetch<unknown[]>(scope(salonId, RESOURCE[kind]));
        if (request === requestRef.current) setData(result);
      } catch (err) {
        if (request === requestRef.current) setError(err instanceof ApiError ? err.message : 'Could not load your shop.');
      } finally {
        if (request === requestRef.current) setRefreshing(false);
      }
    },
    [kind],
  );

  useFocusEffect(
    useCallback(() => {
      setData(null);
      if (selectedSalonId) void load(selectedSalonId, false);
      else requestRef.current += 1;
    }, [selectedSalonId, load]),
  );

  const title: Record<SectionKind, string> = {
    services: t.servicesLabel,
    chairs: t.chairsLabel,
    staff: t.ownerSectionStaff,
    hours: t.hoursLabel,
    photos: t.photosLabel,
  };

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </PremiumScreen>
    );
  }

  const reload = () => void load(selectedSalonId, false);

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(selectedSalonId, true)}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name ?? t.ownerEyebrow} title={title[kind]} />
      <SalonSwitcher />
      {error ? <InlineError message={error} /> : null}
      {!data && !error ? <Skeleton style={styles.skeleton} /> : null}

      {data && kind === 'services' ? (
        <>
          <Card style={sectionStyles.card}>
            {data.length === 0 ? (
              <Text style={sectionStyles.emptyText}>{t.noServicesYet}</Text>
            ) : (
              (data as ServiceDto[]).map((service) => <ServiceRow key={service.id} salonId={selectedSalonId} service={service} onChanged={reload} />)
            )}
          </Card>
          <AddServiceForm salonId={selectedSalonId} onAdded={reload} />
        </>
      ) : null}

      {data && kind === 'chairs' ? (
        <>
          <Card style={sectionStyles.card}>
            {data.length === 0 ? (
              <Text style={sectionStyles.emptyText}>{t.noChairsYet}</Text>
            ) : (
              (data as SalonChairDto[]).map((chair) => <ChairRow key={chair.id} salonId={selectedSalonId} chair={chair} onChanged={reload} />)
            )}
          </Card>
          <AddChairForm salonId={selectedSalonId} onAdded={reload} />
        </>
      ) : null}

      {data && kind === 'staff' ? (
        <>
          <Card style={sectionStyles.card}>
            {data.length === 0 ? (
              <Text style={sectionStyles.emptyText}>{t.noBarbersYet}</Text>
            ) : (
              (data as SalonStaffDto[]).map((member) => (
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
          <AddStaffForm salonId={selectedSalonId} onAdded={reload} />
        </>
      ) : null}

      {data && kind === 'hours' ? (
        <Card style={sectionStyles.card}>
          <HoursEditor salonId={selectedSalonId} hours={data as OperatingHoursDto[]} onSaved={(hours) => setData(hours)} />
        </Card>
      ) : null}

      {data && kind === 'photos' ? <PhotosSection salonId={selectedSalonId} photos={data as PhotoDto[]} onChanged={reload} /> : null}
    </PremiumScreen>
  );
}

export const OwnerServicesScreen = () => <OwnerShopSectionScreen kind="services" />;
export const OwnerChairsScreen = () => <OwnerShopSectionScreen kind="chairs" />;
export const OwnerStaffScreen = () => <OwnerShopSectionScreen kind="staff" />;
export const OwnerHoursScreen = () => <OwnerShopSectionScreen kind="hours" />;
export const OwnerPhotosScreen = () => <OwnerShopSectionScreen kind="photos" />;

const styles = StyleSheet.create({
  skeleton: { height: 100, borderRadius: radius.lg, marginBottom: space[3] },
});

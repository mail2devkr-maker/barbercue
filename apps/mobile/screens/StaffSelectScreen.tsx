import { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { StaffOptionDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, InlineError } from '../components/ui';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'StaffSelect'>;

// A per-barber initial (not a generic brand mark) reads better here — kept as its own small
// component with real onError handling so a broken photoUrl degrades to the same initial-letter
// placeholder shown when there was never a photo at all, not a permanently-broken image icon.
function StaffPhoto({ url, displayName }: { url: string | null; displayName: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.cardPhoto}
        accessibilityLabel={displayName}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder]}>
      <Text style={styles.cardPhotoInitial}>{displayName.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function StaffSelectScreen({ route, navigation }: Props) {
  const { t } = useLanguage();
  const { salonId, serviceId, ...rest } = route.params;
  const [options, setOptions] = useState<StaffOptionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<StaffOptionDto[]>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.staff}?serviceId=${serviceId}`,
    )
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t.couldNotLoadStaff);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, serviceId]);

  function choose(preferredStaffId: string | null, preferredStaffName: string | null) {
    navigation.navigate('DateSelect', { salonId, serviceId, ...rest, preferredStaffId, preferredStaffName });
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader
        eyebrow={t.bookingTitle}
        title={t.chooseABarberTitle}
        subtitle={t.staffSelectHint}
      />
      {loading && (
        <>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </>
      )}
      {error && <InlineError message={error} />}
      {!loading && !error && (
        <FlatList
          data={options}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Pressable style={styles.card} onPress={() => choose(null, null)}>
              <Text style={styles.cardTitle}>{t.anyStaffOption}</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => choose(item.id, item.displayName)}>
              <View style={styles.cardRow}>
                <StaffPhoto url={item.photoUrl} displayName={item.displayName} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.displayName}</Text>
                  {item.yearsExperience !== null && (
                    <Text style={styles.cardMeta}>
                      {item.yearsExperience} {t.yearsExperienceWord}
                    </Text>
                  )}
                  {item.bio && (
                    <Text style={styles.cardBio} numberOfLines={2}>{item.bio}</Text>
                  )}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletonCard: { height: 60, borderRadius: radius.md, marginBottom: space[3] },
  listContent: { paddingTop: space[3] },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[4],
    marginBottom: space[3],
  },
  cardTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  cardPhoto: { width: 44, height: 44, borderRadius: radius.pill },
  cardPhotoPlaceholder: { backgroundColor: color.goldSoft, alignItems: 'center', justifyContent: 'center' },
  cardPhotoInitial: { fontFamily: font.displaySemiBold, fontSize: fontSize.sm, color: color.gold },
  cardMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  cardBio: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2, lineHeight: 16 },
});

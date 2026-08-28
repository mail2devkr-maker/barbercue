import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { StaffOptionDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, InlineError } from '../components/ui';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'StaffSelect'>;

export default function StaffSelectScreen({ route, navigation }: Props) {
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
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load staff.');
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
        eyebrow="Booking"
        title="Choose a barber"
        subtitle="This is a preference, not a guarantee — the salon assigns the actual barber and chair when you check in."
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
              <Text style={styles.cardTitle}>Any Staff</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => choose(item.id, item.displayName)}>
              <Text style={styles.cardTitle}>{item.displayName}</Text>
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
});

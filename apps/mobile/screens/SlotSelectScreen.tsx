import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { AvailabilitySlotDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, InlineError, EmptyState } from '../components/ui';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SlotSelect'>;

export default function SlotSelectScreen({ route, navigation }: Props) {
  const { salonId, serviceId, preferredStaffId, date, ...rest } = route.params;
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ serviceId, date });
    if (preferredStaffId) params.set('staffId', preferredStaffId);
    apiFetch<AvailabilitySlotDto[]>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`,
    )
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load available times.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, serviceId, preferredStaffId, date]);

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow="Booking" title="Choose a time" />
      {loading && (
        <>
          <Skeleton style={styles.skeletonRow} />
          <Skeleton style={styles.skeletonRow} />
        </>
      )}
      {error && <InlineError message={error} />}
      {!loading && !error && slots.length === 0 && <EmptyState title="No slots on this day" message="Try a different date." />}
      {!loading && !error && slots.length > 0 && (
        <FlatList
          data={slots}
          keyExtractor={(item) => item.slotStart}
          numColumns={3}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.slot, !item.available && styles.slotDisabled]}
              disabled={!item.available}
              onPress={() =>
                navigation.navigate('ConfirmBooking', {
                  salonId,
                  serviceId,
                  preferredStaffId,
                  ...rest,
                  slotStart: item.slotStart,
                  slotEnd: item.slotEnd,
                })
              }
            >
              <Text style={[styles.slotText, !item.available && styles.slotTextDisabled]}>
                {new Date(item.slotStart).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletonRow: { height: 44, borderRadius: radius.sm, marginBottom: space[2] },
  listContent: { paddingTop: space[2] },
  slot: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingVertical: space[3],
    alignItems: 'center',
    flex: 1,
    margin: space[1],
  },
  slotDisabled: { opacity: 0.35 },
  slotText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
  slotTextDisabled: { color: color.muted },
});

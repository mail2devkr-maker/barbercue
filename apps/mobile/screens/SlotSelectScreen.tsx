import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS } from '@barbercue/shared';
import type { AvailabilitySlotDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Button, Screen, SectionHeader, Skeleton, InlineError, EmptyState } from '../components/ui';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SlotSelect'>;

export default function SlotSelectScreen({ route, navigation }: Props) {
  const { salonId, serviceId, preferredStaffId, date, ...rest } = route.params;
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ serviceId, date });
    if (preferredStaffId) params.set('staffId', preferredStaffId);
    apiFetch<AvailabilitySlotDto[]>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`,
    )
      .then((result) => {
        if (cancelled) return;
        setSlots(result);
        setSelectedSlot((current) => {
if (!current) return null;
const latest = result.find((slot) => slot.slotStart === current.slotStart);
return latest && latest.available && latest.state !== 'OCCUPIED' ? latest : null;
        });
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

  // Re-fetch whenever this screen regains focus. A completed booking or a competing
  // customer winning the last capacity must immediately turn that time black/disabled.
  useFocusEffect(useCallback(() => loadSlots(), [loadSlots]));

  const continueWithSelection = useCallback(() => {
    if (!selectedSlot) return;
    navigation.navigate('ConfirmBooking', {
      salonId,
      serviceId,
      preferredStaffId,
      ...rest,
      slotStart: selectedSlot.slotStart,
      slotEnd: selectedSlot.slotEnd,
    });
  }, [navigation, preferredStaffId, rest, salonId, selectedSlot, serviceId]);

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
        <>
<Text style={styles.legend} accessibilityLabel="Time availability legend">
  <Text style={styles.legendAvailable}>● Available</Text>{'  '}
  <Text style={styles.legendSelected}>● Your selection</Text>{'  '}
  <Text style={styles.legendOccupied}>● Occupied</Text>
</Text>
<FlatList
  data={slots}
  keyExtractor={(item) => item.slotStart}
  numColumns={3}
  contentContainerStyle={styles.listContent}
  renderItem={({ item }) => {
    const occupied = item.state === 'OCCUPIED' || !item.available;
    const selected = !occupied && selectedSlot?.slotStart === item.slotStart;
    return (
      <Pressable
        style={[
          styles.slot,
          occupied ? styles.slotOccupied : selected ? styles.slotSelected : styles.slotAvailable,
        ]}
        disabled={occupied}
        accessibilityRole="button"
        accessibilityState={{ disabled: occupied, selected }}
        accessibilityLabel={`${new Date(item.slotStart).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}, ${selected ? 'your selection' : occupied ? 'occupied' : 'available'}`}
        onPress={() => setSelectedSlot(item)}
      >
        <Text style={[styles.slotText, (occupied || selected) && styles.slotTextInverse]}>
          {new Date(item.slotStart).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </Pressable>
    );
  }}
  ListFooterComponent={
    <Button
      title="Continue with selected time"
      disabled={!selectedSlot}
      onPress={continueWithSelection}
      style={styles.continueButton}
    />
  }
/>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletonRow: { height: 44, borderRadius: radius.sm, marginBottom: space[2] },
  listContent: { paddingTop: space[2], paddingBottom: space[5] },
  slot: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space[3],
    alignItems: 'center',
    flex: 1,
    margin: space[1],
  },
  slotAvailable: { backgroundColor: '#E5E7EB', borderColor: '#D1D5DB' },
  slotSelected: { backgroundColor: '#2F7D4A', borderColor: '#2F7D4A' },
  slotOccupied: { backgroundColor: '#111111', borderColor: '#111111' },
  slotText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
  slotTextInverse: { color: '#FFFFFF' },
  legend: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[2] },
  legendAvailable: { color: '#6B7280' },
  legendSelected: { color: '#2F7D4A' },
  legendOccupied: { color: '#111111' },
  continueButton: { marginTop: space[4], marginHorizontal: space[1] },
});

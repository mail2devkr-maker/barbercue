import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS, formatZonedDateTime } from '@barbercue/shared';
import type { AvailabilitySlotDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { dateLocaleFor } from '../lib/date-locale';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Skeleton, InlineError, EmptyState } from '../components/ui';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SlotSelect'>;

export default function SlotSelectScreen({ route, navigation }: Props) {
  const { t, language } = useLanguage();
  const { salonId, serviceId, preferredStaffId, salonTimezone, date, ...rest } = route.params;
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
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
        if (!cancelled) setSlots(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t.couldNotLoadTimes);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, serviceId, preferredStaffId, date]);

  // Re-fetch when returning from confirmation. A successful booking or a competing customer
  // winning the last slot must not leave the previous grid looking selectable.
  useFocusEffect(useCallback(() => loadSlots(), [loadSlots]));

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.bookingTitle} title={t.chooseATimeTitle} />
      {loading && (
        <>
          <Skeleton style={styles.skeletonRow} />
          <Skeleton style={styles.skeletonRow} />
        </>
      )}
      {error && <InlineError message={error} />}
      {!loading && !error && slots.length === 0 && <EmptyState title={t.noSlotsTitle} message={t.noSlotsHint} />}
      {!loading && !error && slots.length > 0 && (
        <>
          <Text style={styles.legend} accessibilityLabel={t.timeAvailabilityLegend}>
            <Text style={styles.legendAvailable}>{t.availableLegend}</Text>{'  '}
            <Text style={styles.legendOccupied}>{t.occupiedLegend}</Text>
          </Text>
          <FlatList
            data={slots}
            keyExtractor={(item) => item.slotStart}
            numColumns={3}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const occupied = item.state === 'OCCUPIED' || !item.available;
              return (
                <Pressable
                  style={[styles.slot, occupied ? styles.slotOccupied : styles.slotAvailable]}
                  disabled={occupied}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: occupied }}
                  accessibilityLabel={`${formatZonedDateTime(item.slotStart, salonTimezone, dateLocaleFor(language), { hour: '2-digit', minute: '2-digit' })}, ${occupied ? t.occupiedWord : t.availableWord}`}
                  onPress={() =>
                    navigation.navigate('ConfirmBooking', {
                      salonId,
                      serviceId,
                      preferredStaffId,
                      salonTimezone,
                      ...rest,
                      slotStart: item.slotStart,
                      slotEnd: item.slotEnd,
                    })
                  }
                >
                  <Text style={[styles.slotText, occupied && styles.slotTextOccupied]}>
                    {formatZonedDateTime(item.slotStart, salonTimezone, dateLocaleFor(language), { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </Pressable>
              );
            }}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletonRow: { height: 44, borderRadius: radius.sm, marginBottom: space[2] },
  listContent: { paddingTop: space[2] },
  slot: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingVertical: space[3],
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    margin: space[1],
  },
  slotAvailable: { backgroundColor: color.surface },
  slotOccupied: { backgroundColor: color.ink, borderColor: color.ink },
  slotText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.ink },
  slotTextOccupied: { color: '#ffffff' },
  legend: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[2] },
  legendAvailable: { color: color.muted },
  legendOccupied: { color: color.ink },
});

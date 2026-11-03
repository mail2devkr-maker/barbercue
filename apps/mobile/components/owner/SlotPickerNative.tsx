import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DISCOVERY_PATHS, SALON_BOOKING_INFO_PATHS, type AvailabilitySlotDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { formatShopTime } from '../../lib/owner/ops';
import { addDays, formatDateHeading, todayInZone } from '../../lib/owner/schedule';
import { fastQue, font, fontSize, space } from '../../lib/theme';
import { Chip, ChipRow, FieldLabel, Hint } from './ops-ui';

const DAYS_AHEAD = 14;

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${d}`;
}

/**
 * Date + time picker backed by the real booking availability endpoint - the same one the customer
 * flow uses, so an in-shop appointment can never be placed in a slot a customer could not book.
 */
export function SlotPickerNative({
  salonId,
  serviceIds,
  staffId,
  timeZone,
  value,
  onChange,
}: {
  salonId: string;
  serviceIds: string[];
  staffId?: string;
  timeZone: string | null;
  value: string | null;
  onChange: (slotStart: string | null) => void;
}) {
  const zone = timeZone ?? 'Asia/Kolkata';
  const today = useMemo(() => {
    try {
      return todayInZone(zone);
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, [zone]);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<AvailabilitySlotDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = serviceIds.join(',');

  useEffect(() => {
    setDate(today);
  }, [today]);

  useEffect(() => {
    if (!key) {
      setSlots(null);
      return undefined;
    }
    let cancelled = false;
    setSlots(null);
    setError(null);
    const params = new URLSearchParams({ serviceIds: key, date });
    if (staffId) params.set('staffId', staffId);
    apiFetch<AvailabilitySlotDto[]>(`${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`)
      .then((list) => {
        if (cancelled) return;
        setSlots(list);
        // A previously chosen time that is no longer offered for this date/barber must not linger.
        if (value && !list.some((s) => s.slotStart === value && s.available)) onChange(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load available times.');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `value`/`onChange` are only used to drop a stale choice
  }, [salonId, key, date, staffId]);

  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  const open = (slots ?? []).filter((s) => s.available);

  return (
    <View>
      <FieldLabel>Date</FieldLabel>
      <ChipRow>
        {days.map((day, index) => (
          <Chip
            key={day}
            testID={`slot-day-${day}`}
            label={index === 0 ? 'Today' : dayLabel(day)}
            selected={day === date}
            onPress={() => {
              setDate(day);
              onChange(null);
            }}
          />
        ))}
      </ChipRow>
      <FieldLabel>Time</FieldLabel>
      {!key ? (
        <Hint>Choose at least one service to see free times.</Hint>
      ) : error ? (
        <Hint tone="warn">{error}</Hint>
      ) : slots === null ? (
        <Hint>Loading free times…</Hint>
      ) : open.length === 0 ? (
        <Text style={styles.none} testID="slot-none">
          No free times on {formatDateHeading(date, 'en-IN')}. Try another day or barber.
        </Text>
      ) : (
        <ChipRow>
          {open.map((slot) => (
            <Chip key={slot.slotStart} testID={`slot-${slot.slotStart}`} label={formatShopTime(slot.slotStart, timeZone)} selected={value === slot.slotStart} onPress={() => onChange(slot.slotStart)} />
          ))}
        </ChipRow>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  none: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.warning, marginTop: space[1] },
});

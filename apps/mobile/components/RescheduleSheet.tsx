import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  type AvailabilitySlotDto,
  type BookingDetailDto,
  type Language,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { dateLocaleFor } from '../lib/date-locale';
import { newIdempotencyKey } from '../lib/idempotency';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Button, Card, InlineError } from './ui';

const DAYS_AHEAD = 14;

function nextDays(language: Language): { date: string; label: string }[] {
  const result: { date: string; label: string }[] = [];
  const locale = dateLocaleFor(language);
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    result.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
    });
  }
  return result;
}

// Only the slot moves — same salon/service/preferred barber as the original booking. Same
// "server is authoritative, don't pre-grey days" approach as apps/web's RescheduleBookingDialog:
// no operatingHours fetch here, an unavailable day just comes back with an empty slot list.
export function RescheduleSheet({
  booking,
  onRescheduled,
  onClose,
}: {
  booking: BookingDetailDto;
  onRescheduled: (updated: BookingDetailDto) => void;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlotDto | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = nextDays(language);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setSlotsLoading(true);
    const params = new URLSearchParams({ serviceId: booking.serviceId, date: selectedDate });
    if (booking.preferredStaffId) params.set('staffId', booking.preferredStaffId);
    apiFetch<AvailabilitySlotDto[]>(
      `${DISCOVERY_PATHS.salons}/${booking.salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params}`,
    )
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, booking.salonId, booking.serviceId, booking.preferredStaffId]);

  async function handleConfirm() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<BookingDetailDto>(
        `${BOOKING_PATHS.bookings}/${booking.id}/${BOOKING_PATHS.reschedule}`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey() },
          body: JSON.stringify({ slotStart: selectedSlot.slotStart }),
        },
      );
      onRescheduled(updated);
    } catch (err) {
      // Same race the web dialog guards against: the slot grid is advisory, the reschedule
      // transaction is authoritative. Drop the stale selection and reload the grid so a
      // concurrently-taken slot shows disabled instead of staying selectable.
      if (err instanceof ApiError && err.code === 'SLOT_FULL' && selectedDate) {
        setSelectedSlot(null);
        const params = new URLSearchParams({ serviceId: booking.serviceId, date: selectedDate });
        if (booking.preferredStaffId) params.set('staffId', booking.preferredStaffId);
        void apiFetch<AvailabilitySlotDto[]>(
          `${DISCOVERY_PATHS.salons}/${booking.salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params}`,
        )
          .then(setSlots)
          .catch(() => undefined);
      }
      setError(err instanceof ApiError ? err.message : t.couldNotRescheduleBooking);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t.rescheduleBookingTitle}</Text>
      <Text style={styles.subtitle}>
        {t.currentlyPrefix}{new Date(booking.slotStart).toLocaleString(dateLocaleFor(language))}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScroll}>
        {days.map((day) => (
          <Pressable
            key={day.date}
            style={[styles.dateChip, day.date === selectedDate && styles.dateChipActive]}
            onPress={() => {
              setSelectedDate(day.date);
              setSelectedSlot(null);
            }}
          >
            <Text style={[styles.dateChipText, day.date === selectedDate && styles.dateChipTextActive]}>
              {day.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {selectedDate && (
        <View style={styles.slotWrap}>
          {slotsLoading && <ActivityIndicator color={color.muted} />}
          {!slotsLoading && slots.length === 0 && <Text style={styles.subtitle}>{t.noSlotsOnThisDay}</Text>}
          {!slotsLoading && slots.length > 0 && (
            <View style={styles.slotGrid}>
              {slots.map((slot) => (
                <Pressable
                  key={slot.slotStart}
                  disabled={!slot.available}
                  style={[
                    styles.slotChip,
                    selectedSlot?.slotStart === slot.slotStart && styles.slotChipActive,
                    !slot.available && styles.slotChipDisabled,
                  ]}
                  onPress={() => setSelectedSlot(slot)}
                >
                  <Text
                    style={[
                      styles.slotChipText,
                      selectedSlot?.slotStart === slot.slotStart && styles.slotChipTextActive,
                    ]}
                  >
                    {new Date(slot.slotStart).toLocaleTimeString(dateLocaleFor(language), { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {error && <InlineError message={error} />}

      <View style={styles.actionsRow}>
        <Button title={t.keepCurrentTimeAction} variant="outline" onPress={onClose} disabled={submitting} style={styles.actionButton} />
        <Button
          title={submitting ? t.reschedulingEllipsis : t.confirmNewTimeAction}
          onPress={() => void handleConfirm()}
          disabled={submitting || !selectedSlot}
          style={styles.actionButton}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space[3] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.ink, marginBottom: space[1] },
  subtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted },
  dateScroll: { marginTop: space[3] },
  dateChip: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    marginRight: space[2],
  },
  dateChipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  dateChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted },
  dateChipTextActive: { color: color.accent },
  slotWrap: { marginTop: space[3] },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  slotChip: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
  },
  slotChipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  slotChipDisabled: { opacity: 0.4 },
  slotChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.ink },
  slotChipTextActive: { color: color.accent },
  actionsRow: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
  actionButton: { flex: 1 },
});

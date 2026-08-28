import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, EmptyState, Skeleton, InlineError } from '../../components/ui';
import { LiveQueuePanel } from '../../components/dashboard/LiveQueuePanel';

// Same queue data and actions as Owner's Queue tab (see LiveQueuePanel's own doc comment for why
// — the backend authorizes staff and owner identically here). What staff does NOT get is a
// Dashboard tab (shop open/close) or a Shop tab (services/chairs/staff/hours management) — those
// stay owner-only by simply not existing in StaffNavigator's tab set.
export default function StaffTodayScreen() {
  const { workplaces, loading, error, selectedSalonId, selectedSalon, selectSalon } = useSalon();

  if (loading) {
    return (
      <Screen>
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
  if (workplaces.length === 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="No shop yet" message="Ask your shop owner to add you as staff on the BarberCue web dashboard." />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader eyebrow="Today" title={selectedSalon?.name ?? "Today's queue"} />

      {workplaces.length > 1 && (
        <View style={styles.pickerRow}>
          {workplaces.map((w) => (
            <Pressable
              key={w.id}
              style={[styles.pickerChip, w.id === selectedSalonId && styles.pickerChipActive]}
              onPress={() => selectSalon(w.id)}
            >
              <Text style={[styles.pickerChipText, w.id === selectedSalonId && styles.pickerChipTextActive]}>{w.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {selectedSalonId && <LiveQueuePanel salonId={selectedSalonId} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 140, borderRadius: radius.lg },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  pickerChip: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  pickerChipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  pickerChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  pickerChipTextActive: { color: color.accent },
});

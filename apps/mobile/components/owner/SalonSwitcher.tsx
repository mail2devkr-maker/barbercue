import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSalon } from '../../lib/salon-context';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';

/**
 * One row of chips to switch between the owner's shops, shown only when there is more than one.
 * Every management screen reads `selectedSalonId` from the same SalonProvider, so changing it here
 * re-keys that screen's data load: nothing loaded for one shop can be shown under another.
 */
export function SalonSwitcher() {
  const { workplaces, selectedSalonId, selectSalon } = useSalon();
  if (workplaces.length < 2) return null;
  return (
    <ScrollView
      testID="salon-switcher"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      {workplaces.map((workplace) => {
        const active = workplace.id === selectedSalonId;
        return (
          <Pressable
            key={workplace.id}
            testID={`salon-chip-${workplace.id}`}
            onPress={() => selectSalon(workplace.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
              {workplace.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginBottom: space[3] },
  row: { gap: space[2] },
  chip: {
    paddingHorizontal: space[4],
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: fastQue.border,
    backgroundColor: fastQue.card,
    maxWidth: 220,
  },
  chipActive: { borderColor: fastQue.pink, backgroundColor: 'rgba(242,10,131,0.14)' },
  chipText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.textSecondary },
  chipTextActive: { color: fastQue.pink },
});

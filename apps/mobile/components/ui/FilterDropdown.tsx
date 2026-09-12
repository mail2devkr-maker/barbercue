import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { FilterSheet } from './FilterSheet';

export interface FilterDropdownOption {
  id: string;
  label: string;
}

interface FilterDropdownProps {
  /** Small caption above the trigger, e.g. "Distance". Also the bottom-sheet title. */
  label: string;
  /** Current selection's display text, e.g. "Any distance" or "Beard". */
  valueLabel: string;
  options: FilterDropdownOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  closeLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Compact "Distance ▼" / "Service ▼" style trigger that opens a scrollable bottom sheet of
 * options — replaces the old horizontally-scrolling chip row. Price uses its own composition
 * (PriceFilterDropdown in SalonSearchScreen.tsx) since it also needs a Custom min/max form, not
 * just a flat option list, but shares this same trigger visual language.
 */
export function FilterDropdown({ label, valueLabel, options, selectedId, onSelect, disabled, closeLabel, style }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.root, style]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${valueLabel}`}
      >
        <Text style={styles.triggerValue} numberOfLines={1}>{valueLabel}</Text>
        <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">⌄</Text>
      </Pressable>
      <FilterSheet visible={open} title={label} onClose={() => setOpen(false)} closeLabel={closeLabel}>
        <ScrollView contentContainerStyle={styles.optionList} keyboardShouldPersistTaps="handled">
          {options.map((option) => {
            const selected = option.id === selectedId;
            return (
              <Pressable
                key={option.id}
                style={styles.option}
                onPress={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                {selected && <Text style={styles.optionCheck}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </FilterSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexBasis: '31%', flexGrow: 1, minWidth: 96 },
  label: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: fastQue.textMuted,
    marginBottom: space[1],
  },
  trigger: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[1],
    paddingHorizontal: space[3],
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    backgroundColor: fastQue.card,
  },
  triggerDisabled: { opacity: 0.55 },
  triggerValue: { flexShrink: 1, minWidth: 0, fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.text },
  chevron: { flexShrink: 0, color: fastQue.pink, fontSize: 16, fontFamily: font.bodyBold },
  optionList: { paddingHorizontal: space[3], paddingTop: space[2] },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
  },
  optionText: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: fastQue.textSecondary },
  optionTextSelected: { color: fastQue.pink, fontFamily: font.bodyBold },
  optionCheck: { color: fastQue.pink, fontFamily: font.bodyBold, fontSize: fontSize.base },
});
